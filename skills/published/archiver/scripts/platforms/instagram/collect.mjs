/**
 * collect.mjs — the listing passes. Enumerate, diff, report, download nothing.
 *
 * gallery-dl prints one row per file; this reads those rows as they arrive,
 * folds them into posts, and decides when it has seen enough. The stopping rule
 * is ours rather than gallery-dl's `skip: abort:N`, which does not run in a
 * listing pass at all — and having it here is what lets the block report both
 * how much of the account exists and how much of it is already on disk.
 *
 * **Two passes, not one.** A profile's posts and its reels are two extractors,
 * and they are enumerated separately so that each can stop early on its own. A
 * single invocation covering both would be one stream, and the early stop would
 * land in the posts half — leaving every reel uncollected on every re-run, which
 * is the silent shortfall this skill exists not to have.
 *
 * The price is that a post appearing in both feeds arrives twice. That costs
 * nothing to put right: the shortcode already keys the fold, so a duplicate
 * collapses the same way a carousel's rows do.
 */
import { spawn } from 'node:child_process';
import readline from 'node:readline';

import { outstanding } from '../../shared/landed.mjs';
import { makeStopper } from '../../shared/run.mjs';
import { toolPath } from '../../shared/paths.mjs';
import { TOOL, classifyFailure, parseRow } from './gallerydl.mjs';
import { listArgs } from '../../shared/gallerydl.mjs';
import { feedUrl } from './target.mjs';

/**
 * How far a re-run keeps going after it starts recognising posts. Its only job
 * is to outlast how far Instagram can reorder its own feeds, so the number is a
 * claim about Instagram and nothing else.
 *
 * Instagram pins up to **three** posts to the top of the profile grid regardless
 * of their age, and that is the largest block either feed puts in front of a
 * sweep — the reels tab has no pinning of its own, it is chronological. Add the
 * recent posts an edit can move and 20 clears the block several times over.
 * Everything below it is strictly older, so a longer streak buys reassurance
 * rather than posts, and here it is paid for twice: once per feed, at six to
 * twelve seconds a request. A number above a feed's own length never fires at
 * all, and reels feeds are short.
 *
 * **One number for both feeds.** A second would defend the same claim about the
 * same platform's reordering, and the overlap cuts the other way anyway — a reel
 * already landed from the `posts` sweep counts toward the `reels` streak, so the
 * second feed retires sooner than its length suggests.
 *
 * X has its own constant. Should the two ever read the same, that is two claims
 * about two platforms landing on one number rather than a constant wanting to
 * move to `shared/` — either is free to change without the other.
 */
export const DEFAULT_ABORT = 20;

/** The feeds a run enumerates, in the order it enumerates them. */
export const CATEGORIES = ['posts', 'reels'];

/**
 * Runs gallery-dl over one feed and returns `{ rows, account, stoppedEarly, failure }`.
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
   * profile, or a cached response, and the process is gone while the read loop
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
        // gallery-dl calls the display name `fullname`; everything downstream of
        // here — the plan, the block, account.json — calls it `nickname`, the
        // same word the other platforms use. This line is the one boundary.
        account = {
          id: row.user.id,
          username: row.user.name,
          nickname: row.user.nick,
        };
        if (onAccount) shouldStop = (await onAccount(account)) ?? shouldStop;
      }

      if (!seen.has(row.shortcode)) {
        seen.add(row.shortcode);
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
 * Both feeds, in order, as one set of rows and one sweep record per pass.
 *
 * `onAccount` fires on the first row of whichever pass names the account first —
 * which is not always the posts pass, because an account can have reels and no
 * feed posts. It answers with `{ archive, incremental }` rather than with a
 * stopper, and the stopper is built here, once per pass: the consecutive counter
 * is per feed, and one shared between them would carry a streak off the end of
 * the posts feed into the first row of the reels feed and stop it before it had
 * begun.
 *
 * A pass that fails ends the collection. The alternative is a plan whose counts
 * compare the archive against half a listing, which reads as an account being
 * up to date when a whole feed was never read.
 */
export async function collectFeeds({
  url,
  cookies,
  onAccount,
  threshold = DEFAULT_ABORT,
  bin = toolPath('gallery-dl'),
  spawnImpl = spawn,
  collectImpl = collect,
}) {
  const rows = [];
  const sweeps = [];
  let account = null;
  let stopRule = null;

  // Fired on the first row of every pass; the real `onAccount` runs only the
  // first time, because resolving the folder and reading the archive again
  // would be the same work for the same answer.
  const perPass = async (found) => {
    if (!account) {
      account = found;
      stopRule = (await onAccount?.(found)) ?? null;
    }
    if (!stopRule) return undefined;
    // The caller found something about this account it will not archive under —
    // an id that cannot be a folder name. Ending the pass here rather than
    // throwing, because a throw inside the row loop surfaces as an unexplained
    // stream failure rather than as the refusal it is.
    if (stopRule.stopNow) return () => true;
    const stop = makeStopper({ archive: stopRule.archive, threshold, enabled: stopRule.incremental });
    return (row) => stop(row.shortcode);
  };

  for (const category of CATEGORIES) {
    const result = await collectImpl({
      url: feedUrl(url, category),
      cookies,
      bin,
      spawnImpl,
      onAccount: perPass,
    });

    if (result.failure) {
      return { rows, account, sweeps, failure: result.failure, stderr: result.stderr, code: result.code };
    }

    // Stamped from the pass that ran rather than read back out of the
    // extractor's own subcategory: which feed was asked for is the one thing
    // about a row that cannot be wrong.
    for (const row of result.rows) rows.push({ ...row, category });
    sweeps.push({ category, stoppedEarly: result.stoppedEarly });
  }

  return { rows, account, sweeps, failure: null, stderr: '', code: 0 };
}

// ---- rows into posts -------------------------------------------------------
// gallery-dl reports one row per *file*; everything downstream counts posts.
// Folding them lives here, beside the passes that produced them, rather than in
// the plan — what a plan means is the same on every platform, and this is not.

const VIDEO_EXT = new Set(['mp4', 'm4v', 'mov', 'webm', 'mkv', 'ts']);

/**
 * The per-file rows the listing passes emit, folded into one row per post.
 *
 * The shortcode is the key, so a post that both feeds reported folds into one
 * and a carousel's twenty rows fold into one post carrying twenty files. Order
 * is preserved as enumerated, because that is the order `--go` fetches in and a
 * run stopped partway should have got the recent things.
 *
 * A post either feed called a reel is a reel. The posts feed is the one that
 * can carry it without saying so, so `reels` winning is the answer that cannot
 * undercount.
 */
export function groupFiles(rows) {
  const posts = new Map();
  for (const row of rows) {
    const id = String(row.shortcode);
    let post = posts.get(id);
    if (!post) {
      post = {
        shortcode: id,
        date: row.date || '',
        content: row.content || '',
        username: row.user?.name || '',
        category: row.category || 'posts',
        files: [],
      };
      posts.set(id, post);
    }
    if (row.category === 'reels') post.category = 'reels';

    // A file this fold has already seen is the same file reported by the other
    // pass, not a second copy of it: `num` is the post's own ordering, so it is
    // what says whether two rows are one file.
    if (!post.files.some((file) => file.num === row.num)) {
      post.files.push({
        num: row.num,
        ext: row.ext || '',
        // Already in the shape post.json's media list wants, so the plan's file
        // records are handed to buildPost unchanged.
        url: row.url || '',
        type: row.type || '',
        id: row.mediaId || '',
      });
    }
  }
  return [...posts.values()];
}

/**
 * Images versus videos, and how many of the posts are reels, for the one line of
 * the block that says what you are getting.
 *
 * The first two count *files* — a carousel of twenty is twenty — and `reels`
 * counts posts, because a reel is one video and the number a user could check
 * against their own profile is the post count.
 */
export function classify(posts) {
  let images = 0;
  let videos = 0;
  let reels = 0;
  for (const post of posts) {
    if (post.category === 'reels') reels++;
    for (const file of post.files) {
      if (VIDEO_EXT.has(String(file.ext).toLowerCase())) videos++;
      else images++;
    }
  }
  return { images, videos, reels };
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
