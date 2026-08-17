/**
 * fetch.mjs — downloads the posts the plan listed, and nothing else.
 *
 * One gallery-dl invocation per post, by permalink. That costs a process and an
 * API call per post where re-walking the timeline would cost one call per page —
 * and it buys the two things the design turns on. What is fetched is exactly
 * the list the user approved, with no chance of a post published since the plan
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
import path from 'node:path';

import { POSTS_DIR, isMissing } from '../shared/landed.mjs';
import { classifyFailure, fetchArgs } from './gallerydl.mjs';
import { postFolderName } from '../shared/naming.mjs';
import { permalink } from './target.mjs';
import { buildPost, toTimestamp, writePost } from '../shared/post.mjs';

/** Failures that end the run rather than the post. */
export const FATAL = new Set(['rate-limited', 'unauthorized', 'suspended', 'protected', 'unavailable']);

function run(bin, args) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const take = (chunk) => {
      output += chunk;
      if (output.length > 32_000) output = output.slice(-16_000);
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.on('close', (code) => resolve({ code, output }));
    child.on('error', (error) => resolve({ code: -1, output: `unavailable: ${error.message}` }));
  });
}

/**
 * The posts in a plan that are not yet fully on disk.
 *
 * Derived, never stored. A remembered "still to do" list would be a second
 * account of what has downloaded sitting beside the files, free to disagree
 * with them after a run that died at the wrong moment.
 */
export function outstanding(posts, archive) {
  return posts.filter((post) => isMissing(post, archive));
}

/** Where one post's folder is, by the rules naming.mjs owns. */
export function postDir(accountDir, post) {
  return path.join(
    accountDir,
    POSTS_DIR,
    postFolderName({ date: post.date, postId: post.tweetId }),
  );
}

/**
 * Fetch a list of posts, stopping at the first failure that would repeat.
 *
 * A dead-media 404 is counted and stepped over — it will 404 every time, and
 * one of them must not end a 2,000-post run. A rate limit or a rejected session
 * is the opposite: every remaining post would hit it too, so the run stops and
 * says so, and the files already on disk make the retry cheap.
 */
export async function fetchPosts({
  accountDir,
  posts,
  handle,
  cookies,
  bin = 'gallery-dl',
  onPost,
}) {
  const fetched = { posts: 0, files: 0 };
  let failed = 0;
  let stopped = null;

  for (const post of posts) {
    const url = permalink(post.handle || handle, post.tweetId);
    const dir = postDir(accountDir, post);

    await mkdir(dir, { recursive: true });

    // Written before the first byte of media, and written for every post
    // including one with no words. It is the post's description, not a receipt:
    // a post whose fourth image 404s still got three, and a folder holding that
    // media with nothing saying what it was would be anonymous rubble. Its media
    // list is also what lets the next run see that the fourth is still missing.
    //
    // A folder whose post.json could not be written reads as not-landed and is
    // retried, so the post is counted failed here rather than downloaded into a
    // folder that will never satisfy the completeness check.
    try {
      await writePost(
        dir,
        buildPost({
          id: post.tweetId,
          permalink: url,
          timestamp: toTimestamp(post.date),
          text: post.content,
          replyTo: post.replyId ? permalink('i/web', post.replyId) : '',
          media: post.files,
        }),
      );
    } catch {
      failed += 1;
      onPost?.({ post, ok: false });
      continue;
    }

    const result = await run(bin, fetchArgs({ url, directory: dir, cookies }));

    const kind = result.code === 0 ? null : (classifyFailure(result.output) ?? (result.code === -1 ? 'unavailable' : null));
    if (kind && FATAL.has(kind)) {
      stopped = kind;
      break;
    }

    if (result.code !== 0) {
      failed += 1;
      onPost?.({ post, ok: false });
      continue;
    }

    fetched.posts += 1;
    fetched.files += post.files?.length || post.count || 0;
    onPost?.({ post, ok: true });
  }

  return { fetched, failed, stopped };
}
