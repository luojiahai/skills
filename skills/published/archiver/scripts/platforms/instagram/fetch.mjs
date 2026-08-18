/**
 * fetch.mjs — downloads the posts the plan listed, and nothing else.
 *
 * One gallery-dl invocation per post, by permalink. That costs a process and an
 * API call per post where re-walking the profile would cost one call per page —
 * and it buys the two things the design turns on. What is fetched is exactly the
 * list the user approved, with no chance of a post published since the plan
 * slipping in unapproved; and the destination is an exact path, so naming.mjs
 * owns the folder layout rather than it being re-expressed as a gallery-dl
 * format string that nothing tests.
 *
 * What is still missing is re-derived from the files on disk every time, so a
 * run stopped partway is resumed by running it again, and nothing about
 * progress has to be remembered between runs.
 */
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';

import { outstanding as outstandingIn, postDirFor } from '../../shared/landed.mjs';
import { toolPath } from '../../shared/paths.mjs';
import { postIdKeyFor } from '../../shared/platforms.mjs';
import { SPAWN_FAILED, runTool } from '../../shared/subprocess.mjs';
import { classifyFailure, fetchArgs } from './gallerydl.mjs';
import { permalink } from './target.mjs';
import { buildPost, toTimestamp, writePost } from '../../shared/post.mjs';

const POST_ID_KEY = postIdKeyFor('instagram');

/**
 * Failures that end the run rather than the post.
 *
 * `checkpoint-required` is here for a reason the others are not: every
 * remaining post would meet the same challenge, and going on hammering at it is
 * what turns a challenge into a locked account.
 */
export const FATAL = new Set([
  'rate-limited',
  'checkpoint-required',
  'session-rejected',
  'protected',
  'downloader-unavailable',
]);

/** The posts in a plan that are not yet fully on disk. */
export const outstanding = (posts, archive) => outstandingIn(posts, archive, POST_ID_KEY);

/** Where one post's folder is. Instagram's rows spell the id `shortcode`. */
export const postDir = (accountDir, post) =>
  postDirFor(accountDir, { date: post.date, postId: post.shortcode });

/**
 * How long to wait between posts.
 *
 * gallery-dl's `--sleep-request`/`--sleep` are per-process state, and this loop
 * spawns one process per post — so every post starts with its budget reset and
 * the configured throttle paces nothing at all above the level of a single
 * post's files. The pause has to be here, in the only place that outlives a
 * process.
 *
 * Matched to the low end of the listing pause rather than to X's two seconds:
 * Instagram answers a client going too fast by challenging the user's own
 * account, and a download loop is the longest-running thing this skill does.
 */
export const POST_INTERVAL_MS = 6000;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fetch a list of posts, stopping at the first failure that would repeat.
 *
 * A dead-media 404 is counted and stepped over — it will 404 every time, and one
 * of them must not end a thousand-post run. A rate limit, a rejected session or
 * a checkpoint is the opposite: every remaining post would hit it too, so the
 * run stops and says so, and the files already on disk make the retry cheap.
 *
 * `onPost` is called once per post with `({ post, ok }, done)` — `done` being
 * how many have been attempted — so the caller can say something on stderr. A
 * run of hours that says nothing is indistinguishable from a hang.
 */
export async function fetchPosts({
  accountDir,
  posts,
  cookies,
  bin = toolPath('gallery-dl'),
  spawnImpl = spawn,
  onPost,
  intervalMs = POST_INTERVAL_MS,
  sleepImpl = wait,
}) {
  const fetched = { posts: 0, files: 0 };
  let failed = 0;
  let stopped = null;
  let done = 0;

  for (const post of posts) {
    // Before the request rather than after it, so the pause is skipped for the
    // first post and paid before every one that follows — including after a
    // failure, which is exactly when slowing down matters.
    if (done > 0 && intervalMs > 0) await sleepImpl(intervalMs);
    done += 1;

    const url = permalink(post.shortcode);
    const dir = postDir(accountDir, post);

    await mkdir(dir, { recursive: true });

    // Written before the first byte of media, and written for every post
    // including one with no caption. It is the post's description, not a
    // receipt: a post whose fourth image 404s still got three, and a folder
    // holding that media with nothing saying what it was would be anonymous
    // rubble. Its media list is also what lets the next run see that the fourth
    // is still missing.
    //
    // A folder whose post.json could not be written reads as not-landed and is
    // retried, so the post is counted failed here rather than downloaded into a
    // folder that will never satisfy the completeness check.
    try {
      await writePost(
        dir,
        buildPost({
          id: post.shortcode,
          permalink: url,
          timestamp: toTimestamp(post.date),
          text: post.content,
          // Instagram has no reply-to for a post: a comment is not a post, and
          // nothing in the extractor's metadata names a parent.
          replyTo: '',
          media: post.files,
        }),
      );
    } catch {
      failed += 1;
      onPost?.({ post, ok: false }, done);
      continue;
    }

    const result = await runTool(bin, fetchArgs({ url, directory: dir, cookies }), { spawnImpl });

    const kind =
      result.code === 0
        ? null
        : (classifyFailure(result.output) ?? (result.code === SPAWN_FAILED ? 'downloader-unavailable' : null));
    if (kind && FATAL.has(kind)) {
      stopped = kind;
      break;
    }

    if (result.code !== 0) {
      failed += 1;
      onPost?.({ post, ok: false }, done);
      continue;
    }

    fetched.posts += 1;
    fetched.files += post.files?.length || post.count || 0;
    onPost?.({ post, ok: true }, done);
  }

  return { fetched, failed, stopped };
}
