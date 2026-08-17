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
import readline from 'node:readline';

import { POSTS_DIR, isLanded } from '../shared/landed.mjs';
import { buildPost, writePost } from '../shared/post.mjs';
import { postFolderName, toTimestamp } from '../shared/naming.mjs';
import { permalink } from './target.mjs';

export const YT_DLP = 'yt-dlp';

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
 * Whether the output says the session was rejected, rather than the post being
 * unavailable. yt-dlp asks for "Fresh cookies" by name when Douyin turns it
 * away, and that is the one failure a retry can fix.
 */
export function classifyFailure(output) {
  return /Fresh cookies/i.test(String(output ?? '')) ? 'unauthorized' : null;
}

/** The posts that still need fetching, in the order they were collected. */
export function outstanding(posts, archive) {
  return posts.filter((post) => !isLanded(archive.get(post.id)));
}

/** Where one post lives, named from what the listing pass knew about it. */
export function postDir(accountDir, post) {
  return path.join(
    accountDir,
    POSTS_DIR,
    postFolderName({ date: post.createTime, postId: post.id }),
  );
}

/**
 * Runs yt-dlp once, streaming stdout so a line can be acted on while the
 * process is still going. Resolves `{ code, lines, output }`.
 */
function runYtDlp(args, { bin = YT_DLP, spawnImpl = spawn, onLine = () => {} } = {}) {
  return new Promise((resolve) => {
    const child = spawnImpl(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const lines = [];
    const output = [];

    // Attached before anything is read, so a spawn that fails immediately is
    // still answered rather than hanging the run.
    child.on('error', (error) => resolve({ code: 1, lines, output: String(error.message) }));

    child.stderr?.on('data', (chunk) => output.push(String(chunk)));

    const reader = readline.createInterface({ input: child.stdout });
    reader.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      lines.push(trimmed);
      output.push(trimmed);
      onLine(trimmed);
    });

    child.on('close', (code) => resolve({ code: code ?? 1, lines, output: output.join('\n') }));
  });
}

/**
 * Downloads each post, writing its `post.json` before its media.
 *
 * `refreshCookies` is called at most once, and only when yt-dlp says the session
 * was rejected — the common path costs no browser launch. A post that fails for
 * any other reason is counted and the run carries on, because what landed is on
 * disk and a re-run picks up exactly what is still missing.
 */
export async function fetchPosts({
  accountDir,
  posts,
  cookies,
  refreshCookies,
  log = () => {},
  bin = YT_DLP,
  spawnImpl = spawn,
}) {
  let activeCookies = cookies;
  let refreshed = false;
  let fetched = 0;
  let failed = 0;
  let undescribed = 0;
  let undated = 0;

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
      // Started the moment the filename is printed — which is before the
      // download begins — and awaited once the process ends, so a write that
      // failed is a failed post rather than a silent one.
      let writing = null;
      const result = await runYtDlp(
        fetchArgs({ url: permalink(post.id), dir, cookies: activeCookies }),
        {
          bin,
          spawnImpl,
          onLine: (line) => {
            if (writing || !MEDIA_LINE.test(line)) return;
            writing = writePost(
              dir,
              buildPost({
                id: post.id,
                permalink: permalink(post.id),
                timestamp: toTimestamp(described.createTime),
                text: described.text ?? '',
                media: [{ file: line, type: 'video' }],
              }),
            );
          },
        },
      );

      if (!writing) return { ...result, code: result.code || 1 };
      try {
        await writing;
      } catch (error) {
        return { ...result, code: 1, output: `${result.output}\n${error.message}` };
      }
      return result;
    };

    let result = await attempt();

    if (result.code !== 0 && classifyFailure(result.output) === 'unauthorized' && !refreshed && refreshCookies) {
      log('[douyin] session cookies rejected — re-minting and retrying once…');
      refreshed = true;
      activeCookies = await refreshCookies();
      result = await attempt();
    }

    if (result.code === 0) {
      fetched += 1;
      log(`[douyin] ${fetched}/${posts.length} — ${path.basename(dir)}`, { progress: true });
    } else {
      failed += 1;
      log(`[douyin] failed: ${permalink(post.id)}`);
    }
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

  return { fetched, failed, undescribed, undated };
}

/** One post's timestamp and caption, asked of yt-dlp because the feed did not say. */
async function describe(post, { cookies, bin, spawnImpl }) {
  const { code, lines } = await runYtDlp(metadataArgs({ url: permalink(post.id), cookies }), {
    bin,
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
