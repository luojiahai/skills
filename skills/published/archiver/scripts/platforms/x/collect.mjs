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

import { isLanded, outstanding } from '../../shared/landed.mjs';
import { toolPath } from '../../shared/paths.mjs';
import { TOOL, classifyFailure, parseRow } from './gallerydl.mjs';
import { listArgs } from '../../shared/gallerydl.mjs';

/**
 * How far a re-run keeps going after it starts recognising posts. Its only job
 * is to outlast how far X can reorder its own timeline, so the number is a claim
 * about X and nothing else.
 *
 * X pins exactly **one** post to the top of a timeline regardless of its age,
 * and Premium buys a Highlights tab rather than a second pin — a tab this sweep
 * does not walk. Add the handful of recent posts an edit can move and the block
 * to clear is single digits, which 20 clears several times over. Everything
 * below it is strictly older, so a longer streak buys reassurance rather than
 * posts and pays for it in paginated calls against a rate limiter. A number
 * above an account's own post count never fires at all.
 *
 * Instagram has its own constant. Should the two ever read the same, that is
 * two claims about two platforms landing on one number rather than a constant
 * wanting to move to `shared/` — either is free to change without the other.
 */
export const DEFAULT_ABORT = 20;

/**
 * Runs gallery-dl and returns `{ rows, account, stoppedEarly, failure }`.
 *
 * `shouldStop` is asked once per newly-seen post, never per file: stopping
 * halfway through a post's files would write a plan claiming fewer files than
 * the post has, and the count the user approved would then be wrong.
 */
export async function collect({
  url,
  cookies,
  shouldStop,
  onAccount,
  bin = toolPath('gallery-dl'),
  spawnImpl = spawn,
}) {
  const child = spawnImpl(bin, listArgs(TOOL, { url, cookies }), {
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
      failure: 'downloader-unavailable',
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
        // gallery-dl calls the display name `nick`; everything downstream of
        // here — the plan, the block, account.json — calls it `nickname`, the
        // same word the Douyin platform uses. This line is the one boundary.
        // The avatar and banner URLs ride on the same row, so an account's
        // assets cost no request of their own — they are already here by the
        // time the folder is known.
        account = {
          id: row.user.id,
          handle: row.user.name,
          nickname: row.user.nick,
          avatar: row.user.avatar || '',
          banner: row.user.banner || '',
        };
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
  const failure = stoppedEarly ? null : code === 0 ? null : (classifyFailure(stderr) ?? 'collect-failed');
  return { rows, account, stoppedEarly, failure, stderr, code };
}

/**
 * The stopping rule: N consecutive posts, in enumeration order, already complete.
 *
 * "Complete" is landed.mjs's one definition, so a post whose media is half here
 * breaks the streak rather than counting toward it — which is what stops a sweep
 * retiring early over posts it would then have had to fetch anyway.
 */
export function makeStopper({ archive, threshold, enabled }) {
  let consecutive = 0;
  return (row) => {
    if (!enabled) return false;
    if (isLanded(archive.get(row.tweetId))) {
      consecutive += 1;
      return consecutive >= threshold;
    }
    consecutive = 0;
    return false;
  };
}

// ---- rows into posts -------------------------------------------------------
// gallery-dl reports one row per *file*; everything downstream counts posts.
// Folding them lives here, beside the pass that produced them, rather than in
// the plan — what a plan means is the same on every platform, and this is not.

const VIDEO_EXT = new Set(['mp4', 'm4v', 'mov', 'webm', 'mkv', 'ts']);

/**
 * The per-file rows the listing pass emits, folded into one row per post.
 *
 * Order is preserved as enumerated — newest first — because that is the order
 * `--go` fetches in, and a run stopped partway should have got the recent
 * things rather than an arbitrary slice.
 */
export function groupFiles(rows) {
  const posts = new Map();
  for (const row of rows) {
    const id = String(row.tweetId);
    let post = posts.get(id);
    if (!post) {
      post = {
        tweetId: id,
        date: row.date || '',
        content: row.content || '',
        replyId: row.replyId || '',
        handle: row.user?.name || '',
        files: [],
      };
      posts.set(id, post);
    }
    post.files.push({
      num: row.num,
      ext: row.ext || '',
      // Already in the shape post.json's media list wants, so the plan's file
      // records are handed to buildPost unchanged. `id` is blank for anything
      // whose basename is not an identity — parseRow decides that, so the rule
      // lives in one place.
      url: row.url || '',
      type: row.type || '',
      id: row.mediaId || '',
    });
  }
  return [...posts.values()];
}

/** Images versus videos, for the one line of the block that says what you are getting. */
export function classify(posts) {
  let images = 0;
  let videos = 0;
  for (const post of posts) {
    for (const file of post.files) {
      if (VIDEO_EXT.has(String(file.ext).toLowerCase())) videos++;
      else images++;
    }
  }
  return { images, videos };
}

/**
 * What is missing: every enumerated post whose folder does not already hold all
 * of its files. Incomplete counts as missing, so a run that died mid-post is
 * finished rather than abandoned.
 *
 * Asked through `landed.mjs`'s `outstanding`, which is the same call `--go` makes
 * to decide what it hands the fetcher. That shared call is the whole of the rule:
 * a second predicate here, on top of it, is what makes a block promise a number
 * the download then disagrees with — the plan offers a hundred posts, the fetch
 * asks the shared question and skips every one, and the run reports zero
 * downloaded against a hundred approved.
 */
export function diff(posts, archive, postIdKey) {
  const toFetch = outstanding(posts, archive, postIdKey);

  const foundFiles = posts.reduce((n, p) => n + p.files.length, 0);
  const onDisk = posts.length - toFetch.length;

  return {
    toFetch,
    counts: {
      foundPosts: posts.length,
      foundFiles,
      onDiskPosts: onDisk,
      fetchPosts: toFetch.length,
      fetchFiles: toFetch.reduce((n, p) => n + p.files.length, 0),
      ...classify(toFetch),
    },
  };
}
