import assert from 'node:assert/strict';
import test from 'node:test';

import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { fetchPosts, outstanding } from './fetch.mjs';
import { approved } from '../shared/plan.mjs';
import { buildPost, readPost } from '../shared/post.mjs';

async function fakeBin(script) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'x-dl-bin-'));
  const bin = path.join(dir, 'fake-gallery-dl');
  await writeFile(bin, `#!/bin/sh
${script}
`);
  await chmod(bin, 0o755);
  return bin;
}

const file = (num) => ({ num, ext: 'jpg' });

const posts = [
  { tweetId: '1', count: 2, files: [file(1), file(2)] },
  { tweetId: '2', count: 1, files: [file(1)] },
  { tweetId: '3', count: 4, files: [file(1), file(2), file(3), file(4)] },
];

/** One archived post, as landed.mjs reports it: what it lists, and what is there. */
function onDisk(id, listed, present = listed) {
  const media = listed.map((name) => {
    const [num, ext] = name.split('.');
    return { num, ext };
  });
  return [id, { folder: `2024-01-01_${id}`, names: [...present, 'post.json'], post: buildPost({ id, media }) }];
}

test('everything is outstanding against an empty folder', () => {
  assert.deepEqual(outstanding(posts, new Map()).map((p) => p.tweetId), ['1', '2', '3']);
});

test('a complete post is not fetched again', () => {
  const archive = new Map([onDisk('1', ['1.jpg', '2.jpg'])]);
  assert.deepEqual(outstanding(posts, archive).map((p) => p.tweetId), ['2', '3']);
});

test('a post whose files half landed is finished rather than abandoned', () => {
  const archive = new Map([onDisk('3', ['1.jpg', '2.jpg', '3.jpg', '4.jpg'], ['1.jpg', '2.jpg'])]);
  assert.ok(outstanding(posts, archive).some((p) => p.tweetId === '3'));
});

test('a folder holding more files than the post lists still counts as done', () => {
  const archive = new Map([onDisk('2', ['1.jpg'], ['1.jpg', 'notes.txt', '2.jpg'])]);
  assert.ok(!outstanding(posts, archive).some((p) => p.tweetId === '2'));
});

test('a post that left the disk after the plan was made is not fetched by --go', () => {
  // Posts 1 and 2 were on disk when the block was rendered, so only 3 was
  // counted as new. Post 1 has since gone, and --go re-checks against disk —
  // but only across the posts the block promised, so it stays at one.
  const parked = { collected: posts, pending: [posts[2]] };
  const archive = new Map([onDisk('2', ['1.jpg'])]);

  assert.deepEqual(outstanding(approved(parked), archive).map((p) => p.tweetId), ['3']);
});

test('an approved plan fully on disk leaves nothing outstanding', () => {
  const archive = new Map([
    onDisk('1', ['1.jpg', '2.jpg']),
    onDisk('2', ['1.jpg']),
    onDisk('3', ['1.jpg', '2.jpg', '3.jpg', '4.jpg']),
  ]);
  assert.deepEqual(outstanding(posts, archive), []);
});

test('a post whose media failed entirely still says what it was', async () => {
  // post.json is written before gallery-dl is spawned, so a folder that ends up
  // holding nothing — or three of four images — is still legible rather than
  // anonymous rubble.
  const dir = await mkdtemp(path.join(os.tmpdir(), 'x-dl-fetch-'));
  const bin = await fakeBin('echo "HttpError: 404 Not Found" >&2; exit 1');

  const result = await fetchPosts({
    accountDir: dir,
    handle: 'someone',
    bin,
    posts: [{ tweetId: '1', count: 2, files: [file(1), file(2)], date: '2024-03-11 07:22:19', content: 'hi' }],
  });

  assert.equal(result.failed, 1);
  assert.equal(result.fetched.posts, 0);
  assert.equal(result.stopped, null, 'a dead-media 404 must not end the run');

  const post = await readPost(path.join(dir, 'posts', '2024-03-11_1'));
  assert.equal(post.text, 'hi');
  assert.equal(post.permalink, 'https://x.com/someone/status/1');
  assert.equal(post.timestamp, '2024-03-11T07:22:19Z');
  assert.deepEqual(post.media.map((m) => m.file), ['1.jpg', '2.jpg']);
});

test('a reply records what it replies to', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'x-dl-fetch-'));
  const bin = await fakeBin('exit 0');

  await fetchPosts({
    accountDir: dir,
    handle: 'someone',
    bin,
    posts: [{ tweetId: '1', count: 1, files: [file(1)], date: '2024-03-11 07:22:19', content: 'yes', replyId: '99' }],
  });

  const post = await readPost(path.join(dir, 'posts', '2024-03-11_1'));
  assert.equal(post.reply_to, 'https://x.com/i/web/status/99');
});

test('a rate limit ends the run instead of grinding through every post', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'x-dl-fetch-'));
  const bin = await fakeBin('echo "HttpError: 429 Too Many Requests" >&2; exit 1');

  const result = await fetchPosts({
    accountDir: dir,
    handle: 'someone',
    bin,
    posts: [
      { tweetId: '1', count: 1, files: [file(1)], date: '2024-03-11 07:22:19', content: 'a' },
      { tweetId: '2', count: 1, files: [file(1)], date: '2024-03-10 07:22:19', content: 'b' },
    ],
  });

  assert.equal(result.stopped, 'rate-limited');
  assert.equal(result.failed, 0);
  // The second post was never started, so nothing was written for it.
  assert.equal(await readPost(path.join(dir, 'posts', '2024-03-10_2')), null);
});
