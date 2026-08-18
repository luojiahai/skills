/**
 * fetch.mjs — everything said to yt-dlp, and the download loop.
 *
 * One invocation per post, into a directory this module chose. yt-dlp is never
 * asked to name a folder: `collect.mjs` supplies the timestamp, `naming.mjs`
 * turns it into `<date>_<id>`, and yt-dlp is pointed straight at it. That is
 * what keeps folder naming in one place with a test beside it, rather than split
 * between a regex here and an output template that has to keep agreeing with it.
 *
 * `post.json` is written *before* the media, and the ordering is exact rather
 * than approximate. yt-dlp's `--print` fires after extraction and before the
 * download begins, so the media filename — the one field only yt-dlp can know,
 * because it picks the container — arrives in time for `post.json` to be
 * complete and written first. A post whose download then fails leaves a folder
 * that still says what it was, and whose media list tells the next run what is
 * still missing.
 *
 * `--print` implies `--simulate`, which would download nothing at all, so
 * `--no-simulate` is not optional here.
 */
import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';

import { outstanding as outstandingIn, postDirFor } from '../shared/landed.mjs';
import { buildPost, writePost } from '../shared/post.mjs';
import { toTimestamp } from '../shared/naming.mjs';
import { toolPath } from '../shared/paths.mjs';
import { postIdKeyFor } from '../shared/platforms.mjs';
import { httpStatus, runTool } from '../shared/subprocess.mjs';
import { permalink } from './target.mjs';

const POST_ID_KEY = postIdKeyFor('douyin');

/**
 * Douyin rate-limits hard; an unthrottled batch starts failing partway through
 * and can get the session challenged. The pauses are the reason a long run
 * finishes at all — do not remove them to make a test faster.
 */
export const THROTTLE = [
  '--sleep-requests', '2',
  '--sleep-interval', '3',
  '--max-sleep-interval', '8',
  '--retries', '3',
];

/**
 * The media filename, spelled exactly as the `-o` template spells it.
 *
 * `playlist_index` is unset for a lone video, so the default is what makes it
 * `1.mp4`; a post yielding several files numbers them by position instead. The
 * two spellings are identical character for character on purpose: what is
 * printed has to be what is written, and a hardcoded `1` here would silently
 * stop matching if a post ever yielded more than one file.
 */
const MEDIA_NAME = '%(playlist_index|1)s.%(ext)s';

/**
 * What that template resolves to, so a stray line of yt-dlp output cannot be
 * mistaken for a filename. `--print` implies `--quiet`, so stdout should carry
 * nothing else — this is the check that keeps "should" from becoming a
 * `post.json` listing a progress bar as its media.
 */
const MEDIA_LINE = /^\d+\.[A-Za-z0-9]+$/;

/** What yt-dlp is told for a post whose folder is already known. */
export function fetchArgs({ url, dir, cookies }) {
  return [
    ...cookieArgs(cookies),
    ...THROTTLE,
    // Keys on the resolved path, so deleting a post's folder re-downloads it —
    // unlike --download-archive, which keys on ids and goes on claiming a
    // deleted post is done.
    '--no-overwrites',
    '--embed-metadata',
    '--no-simulate',
    '--print', MEDIA_NAME,
    '-o', path.join(dir, MEDIA_NAME),
    url,
  ];
}

/**
 * What yt-dlp is told for a post the listing pass could not describe.
 *
 * The date has to be known before the folder can be named, so a post the feed
 * responses missed costs one extra request to place. Rare by construction —
 * the responses are the same ones that rendered the cards — and reported when
 * it happens rather than quietly filing the post as `undated`.
 */
export function metadataArgs({ url, cookies }) {
  return [
    ...cookieArgs(cookies),
    ...THROTTLE,
    '--skip-download',
    '--print', '%(timestamp|)s\t%(description,title|)s',
    url,
  ];
}

function cookieArgs(cookies) {
  return cookies ? ['--cookies', cookies] : [];
}

/**
 * Whether the output says the session has gone stale, rather than the post being
 * unavailable. yt-dlp asks for "Fresh cookies" by name when Douyin turns it
 * away, and that is the one failure a retry can fix.
 *
 * A boolean rather than a refusal code, because it is answered inside the
 * download loop, where the remedy is to re-mint the cookies and try the post
 * again. Only a re-mint that does not help becomes a refusal.
 */
export function saysSessionStale(output) {
  return /Fresh cookies/i.test(String(output ?? ''));
}

/**
 * What a yt-dlp failure was, as the refusal code that names it, or null for one
 * that is this post's own business.
 *
 * The distinction is whether the next post would hit it too. A post that is
 * private, deleted or region-locked is stepped over and counted — one of them
 * must not end an 800-post run. A rate limit is the opposite: every remaining
 * post would meet it, and carrying on means 750 more invocations, each with
 * `--retries 3`, hammering a rate limiter with the user's own session. The
 * consequence there is the account, not the archive.
 */
export function classifyFailure(output) {
  // Read off the lines yt-dlp marked as problems, and nowhere else. It prints
  // resolved filenames and video titles to the same streams, and a post whose
  // caption happens to read 访问频繁 must not stop the run — `session-rejected`
  // also throws the cached session away, so a false one costs a sign-in.
  const text = String(output ?? '')
    .split('\n')
    .filter((line) => /^\s*(?:ERROR|WARNING)\b|\[(?:error|warning)\]/i.test(line))
    .join('\n');
  if (!text) return null;

  if (
    httpStatus(429, 'Too\\s+Many\\s+Requests').test(text) ||
    /\brate.?limit|too many requests|too frequent|访问(?:过于)?频繁|操作(?:过于)?频繁/i.test(text)
  ) {
    return 'rate-limited';
  }

  if (
    httpStatus(403, 'Forbidden').test(text) ||
    /\brisk control\b|\bcaptcha\b|滑块|验证码/i.test(text)
  ) {
    return 'session-rejected';
  }

  return null;
}

/**
 * Failures that end the run rather than the post: the ones the next post would
 * meet too.
 *
 * Each platform has its own set rather than sharing one, because what is fatal
 * depends on what the platform says and when. X's includes `suspended` and
 * `protected`, which its listing pass can report mid-download; Douyin answers
 * both of those long before here, with a grid that renders nothing.
 */
export const FATAL = new Set(['rate-limited', 'session-rejected']);

/** The posts that still need fetching, in the order they were collected. */
export const outstanding = (posts, archive) => outstandingIn(posts, archive, POST_ID_KEY);

/**
 * Where one post lives, named from what the listing pass knew about it. Douyin's
 * posts spell the moment `createTime` and the id `id`.
 */
export const postDir = (accountDir, post) =>
  postDirFor(accountDir, { date: post.createTime, postId: post.id });

/**
 * Downloads each post, writing its `post.json` before its media.
 *
 * `refreshCookies` is called at most once, and only when yt-dlp says the session
 * was rejected — the common path costs no browser launch. A post that fails for
 * any other reason is counted and the run carries on, because what landed is on
 * disk and a re-run picks up exactly what is still missing.
 *
 * A failure the *next* post would meet too is the exception: the run stops with
 * the code that names it. Returns `stopped` for that, and `sessionStale` for a
 * session the re-mint could not rescue, so the caller can discard the cached
 * cookies rather than read the same dead token back next time.
 */
export async function fetchPosts({
  accountDir,
  posts,
  cookies,
  refreshCookies,
  log = () => {},
  bin = toolPath('yt-dlp'),
  spawnImpl = spawn,
}) {
  let activeCookies = cookies;
  let refreshed = false;
  let fetched = 0;
  let failed = 0;
  let undescribed = 0;
  let undated = 0;
  let stopped = null;
  let sessionStale = false;

  for (const post of posts) {
    let described = post;

    // Placing the post comes before fetching it: without a date there is no
    // folder name, and `undated_<id>` for a post that has a perfectly good
    // timestamp would be an archive telling a small lie about itself.
    if (described.createTime === null || described.createTime === undefined) {
      undescribed += 1;
      described = await describe(post, { cookies: activeCookies, bin, spawnImpl });
      // The fallback can fail too, and a post that lands in `undated_<id>` is
      // filed under a date the archive does not actually know. It is still
      // fetched — an undated post is better than a missing one — but it is
      // counted and said out loud rather than left to be noticed in a listing.
      if (described.createTime === null || described.createTime === undefined) undated += 1;
    }

    const dir = postDir(accountDir, described);
    await mkdir(dir, { recursive: true });

    const attempt = async () => {
      // Every filename yt-dlp prints, not just the first. `MEDIA_NAME` numbers a
      // post's files by position precisely because a post can yield several, and
      // a post.json listing one of three is satisfied by that one file forever —
      // so the other two stay missing, silently and permanently.
      const files = [];
      let writing = null;

      // Rewritten as each name arrives rather than once at the end, because
      // yt-dlp prints a file's name before it downloads that file: the list is
      // still ahead of every byte it describes, which is the rule post.json
      // exists to keep.
      const record = () =>
        writePost(
          dir,
          buildPost({
            id: post.id,
            permalink: permalink(post.id),
            timestamp: toTimestamp(described.createTime),
            text: described.text ?? '',
            media: files.map((file) => ({ file, type: 'video' })),
          }),
        );

      const result = await runTool(
        bin,
        fetchArgs({ url: permalink(post.id), dir, cookies: activeCookies }),
        {
          spawnImpl,
          onLine: (line) => {
            if (!MEDIA_LINE.test(line) || files.includes(line)) return;
            files.push(line);
            // Chained, never concurrent. Two writes racing on one path let
            // whichever finishes last decide the list, and a shorter list
            // winning is a post that reads as complete without its later files.
            writing = writing ? writing.then(record) : record();
          },
        },
      );

      if (!files.length) return { ...result, code: result.code || 1 };
      try {
        await writing;
      } catch (error) {
        return { ...result, code: 1, output: `${result.output}\n${error.message}` };
      }
      return result;
    };

    let result = await attempt();

    if (result.code !== 0 && saysSessionStale(result.output) && !refreshed && refreshCookies) {
      log('[douyin] session cookies rejected — re-minting and retrying once…');
      refreshed = true;
      activeCookies = await refreshCookies();
      result = await attempt();
    }

    if (result.code === 0) {
      fetched += 1;
      log(`[douyin] ${fetched}/${posts.length} — ${path.basename(dir)}`, { progress: true });
      continue;
    }

    // A failure the next post would meet too stops the run and says which one.
    // Counting it as one failed post and carrying on is how a rate limit
    // becomes hundreds more requests into the limiter that just said no.
    const kind = classifyFailure(result.output);
    if (kind && FATAL.has(kind)) {
      stopped = kind;
      log(`[douyin] stopping: ${kind}`);
      break;
    }

    failed += 1;
    log(`[douyin] failed: ${permalink(post.id)}`);

    // A stale session the re-mint could not fix. Reported so the run throws the
    // cached cookies away rather than reading the same dead token back next time.
    if (saysSessionStale(result.output)) sessionStale = true;
  }

  if (undescribed) {
    log(
      `[douyin] note: ${undescribed} post(s) needed an extra request to date — ` +
        'the profile feed did not describe them',
    );
  }

  if (undated) {
    log(
      `[douyin] note: ${undated} post(s) could not be dated at all, and are filed ` +
        'under undated_<id>',
    );
  }

  return { fetched, failed, undescribed, undated, stopped, sessionStale };
}

/** One post's timestamp and caption, asked of yt-dlp because the feed did not say. */
async function describe(post, { cookies, bin, spawnImpl }) {
  const { code, lines } = await runTool(bin, metadataArgs({ url: permalink(post.id), cookies }), {
    spawnImpl,
  });
  if (code !== 0 || !lines.length) return post;

  const [timestamp, ...rest] = lines[0].split('\t');
  const seconds = Number(timestamp);
  return {
    ...post,
    createTime: Number.isFinite(seconds) && seconds > 0 ? seconds : null,
    text: post.text ?? (rest.join('\t') || ''),
  };
}
