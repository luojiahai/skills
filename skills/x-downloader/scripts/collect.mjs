/**
 * collect.mjs — the listing pass. Enumerates, diffs, reports, downloads nothing.
 *
 * gallery-dl prints one row per file; this reads those rows as they arrive,
 * folds them into posts, and decides when it has seen enough. The stopping rule
 * is ours rather than gallery-dl's `skip: abort:N`, which does not run in a
 * listing pass at all — and having it here is what lets the block report both
 * how much of the account exists and how much of it is already on disk.
 *
 * Enumeration is the expensive half of this skill: it is paginated API calls
 * against a rate limiter, and a decade-old account is thousands of posts. So a
 * re-run stops once it has passed enough consecutive posts it already has,
 * unless asked for a full sweep. The first run has nothing to stop at and
 * sweeps the lot.
 */
import { spawn } from 'node:child_process';
import readline from 'node:readline';

import { isPostComplete } from './archive.mjs';
import { classifyFailure, listArgs, parseRow } from './gallerydl.mjs';

/**
 * Generous on purpose. X pins a post to the top of a timeline regardless of its
 * age, and a handful of recent posts can be edited or reordered, so a small
 * threshold is a stop-at-the-first-thing-you-recognise rule wearing a number.
 */
export const DEFAULT_ABORT = 100;


/**
 * Runs gallery-dl and returns `{ rows, account, stoppedEarly, failure }`.
 *
 * `shouldStop` is asked once per newly-seen post, never per file: stopping
 * halfway through a post's files would write a plan claiming fewer files than
 * the post has, and the count the user approved would then be wrong.
 */
export async function collect({ url, cookies, shouldStop, onAccount, bin = 'gallery-dl' }) {
  const child = spawn(bin, listArgs({ url, cookies }), {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const rows = [];
  const seen = new Set();
  let account = null;
  let stoppedEarly = false;
  let stderr = '';
  let spawnError = null;

  // A listener from the outset: an 'error' with none is an uncaught exception
  // rather than something this function can report.
  child.on('error', (error) => {
    spawnError ??= error;
  });

  /**
   * The exit status, captured now rather than awaited later.
   *
   * gallery-dl can finish before this function has drained its stdout — a short
   * timeline, or a cached response, and the process is gone while the read loop
   * is still going. An 'exit' listener attached after that loop would be
   * attached after the event it is waiting for had already fired, and the run
   * would hang forever on a promise nothing could ever settle.
   *
   * 'exit', not 'close', for the other half of the same problem: 'close'
   * additionally waits for every stdio pipe to be closed, and gallery-dl's own
   * children can inherit stdout and hold it open after gallery-dl itself is
   * gone.
   */
  const exited = new Promise((resolve) => {
    child.once('exit', (code) => resolve(code));
    child.once('error', () => resolve(-1));
  });

  child.stderr.on('data', (chunk) => {
    stderr += chunk;
    // Keep the tail only: a long run's warnings are unbounded, and only the
    // last of them explains why it ended.
    if (stderr.length > 64_000) stderr = stderr.slice(-32_000);
  });

  // Settled before anything is read. A spawn that fails leaves stdout open but
  // never-ending — it emits neither data nor 'end' — so the read loop below
  // would wait on it forever and a missing gallery-dl would hang the run
  // instead of reporting itself.
  const started = await new Promise((resolve) => {
    child.once('spawn', () => resolve(true));
    child.once('error', () => resolve(false));
  });

  if (!started) {
    return {
      rows,
      account,
      stoppedEarly: false,
      failure: 'unavailable',
      stderr: spawnError?.message ?? 'could not start gallery-dl',
      code: -1,
    };
  }

  const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });

  try {
    for await (const line of lines) {
      const row = parseRow(line);
      if (!row) continue;

      // The first row is where the account's numeric id arrives, and the id is
      // what says which folder this archive is really in — a renamed account is
      // already filed under its old handle. Everything that depends on knowing
      // the folder, the archive included, waits for this and is settled here.
      if (!account && row.user?.id) {
        account = { id: row.user.id, handle: row.user.name, nick: row.user.nick };
        if (onAccount) shouldStop = (await onAccount(account)) ?? shouldStop;
      }

      if (!seen.has(row.tweetId)) {
        seen.add(row.tweetId);
        if (shouldStop && shouldStop(row)) {
          stoppedEarly = true;
          break;
        }
      }
      rows.push(row);
    }
  } catch (error) {
    // A stream that died mid-read is the process dying; the exit code and
    // stderr below say what actually happened.
    spawnError ??= error;
  }

  lines.close();

  // Only when we are the ones ending it. A sweep that ran to the end is already
  // finishing on its own, and signalling it there would turn a complete listing
  // into a truncated one that exited non-zero.
  let hardKill;
  if (stoppedEarly) {
    child.kill('SIGTERM');
    // A process that will not go would otherwise hang a listing pass that
    // already has everything it needs.
    hardKill = setTimeout(() => child.kill('SIGKILL'), 5_000);
    hardKill.unref?.();
  }

  const code = await exited;
  clearTimeout(hardKill);

  // Nothing more is read from these, and leaving them attached keeps the event
  // loop alive when a grandchild still holds the write end.
  child.stdout.destroy();
  child.stderr.destroy();

  // A non-zero exit we caused by killing it is not a failure.
  const failure = stoppedEarly ? null : code === 0 ? null : (classifyFailure(stderr) ?? 'unknown');
  return { rows, account, stoppedEarly, failure, stderr, code };
}

/** The stopping rule: N consecutive posts, in enumeration order, already complete. */
export function makeStopper({ archive, threshold, enabled }) {
  let consecutive = 0;
  return (row) => {
    if (!enabled) return false;
    const have = archive.get(row.tweetId);
    if (have && isPostComplete(have.mediaCount, row.count)) {
      consecutive += 1;
      return consecutive >= threshold;
    }
    consecutive = 0;
    return false;
  };
}

