import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { chmod, mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { FATAL, POST_INTERVAL_MS, fetchPosts, outstanding, postDir } from './fetch.mjs';
import { approved } from '../../shared/plan.mjs';
import { buildPost, readPost } from '../../shared/post.mjs';

async function fakeBin(script) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ig-dl-bin-'));
  const bin = path.join(dir, 'fake-gallery-dl');
  await writeFile(bin, `#!/bin/sh\n${script}\n`);
  await chmod(bin, 0o755);
  return bin;
}

const archives = () => mkdtemp(path.join(os.tmpdir(), 'ig-fetch-'));

const file = (shortcode, num, ext = 'jpg') => ({
  num,
  ext,
  id: `m${shortcode}${num}`,
  url: `https://scontent.cdninstagram.com/${shortcode}_${num}.${ext}`,
});

const posts = [
  { shortcode: 'AAA', date: '2024-01-01 00:00:00', count: 2, files: [file('AAA', 1), file('AAA', 2)] },
  { shortcode: 'BBB', date: '2024-01-02 00:00:00', count: 1, files: [file('BBB', 1)] },
  {
    shortcode: 'CCC',
    date: '2024-01-03 00:00:00',
    count: 4,
    files: [1, 2, 3, 4].map((n) => file('CCC', n)),
  },
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
  assert.deepEqual(outstanding(posts, new Map()).map((p) => p.shortcode), ['AAA', 'BBB', 'CCC']);
});

test('a complete post is not fetched again', () => {
  const archive = new Map([onDisk('AAA', ['1.jpg', '2.jpg'])]);
  assert.deepEqual(outstanding(posts, archive).map((p) => p.shortcode), ['BBB', 'CCC']);
});

test('a post whose files half landed is finished rather than abandoned', () => {
  const archive = new Map([onDisk('CCC', ['1.jpg', '2.jpg', '3.jpg', '4.jpg'], ['1.jpg', '2.jpg'])]);
  assert.ok(outstanding(posts, archive).some((p) => p.shortcode === 'CCC'));
});

test('a post that left the disk after the plan was made is not fetched by --go', () => {
  // AAA and BBB were on disk when the block was rendered, so only CCC was
  // counted as new. AAA has since gone, and --go re-checks against disk — but
  // only across the posts the block promised, so it stays at one.
  const parked = { collected: posts, pending: [posts[2]] };
  const archive = new Map([onDisk('BBB', ['1.jpg'])]);
  assert.deepEqual(outstanding(approved(parked), archive).map((p) => p.shortcode), ['CCC']);
});

test('a post folder is the date and the shortcode', () => {
  assert.equal(
    path.basename(postDir('/a', { date: '2024-03-11 07:22:19', shortcode: 'C3xY-_9Ab' })),
    '2024-03-11_C3xY-_9Ab',
  );
});

test('post.json is written before the media, and describes the post', async () => {
  const root = await archives();
  const bin = await fakeBin('exit 0');
  await fetchPosts({ accountDir: root, posts: [posts[0]], bin, intervalMs: 0 });

  const dir = postDir(root, posts[0]);
  const written = await readPost(dir);
  assert.equal(written.id, 'AAA');
  assert.equal(written.permalink, 'https://www.instagram.com/p/AAA');
  assert.equal(written.timestamp, '2024-01-01T00:00:00Z');
  assert.deepEqual(written.media.map((m) => m.file), ['1.jpg', '2.jpg']);
  // Instagram gives every item of a carousel its own id, so unlike an X video
  // there is nothing here a re-encode could change.
  assert.deepEqual(written.media.map((m) => m.id), ['mAAA1', 'mAAA2']);
});

test('a post whose media is gone is counted and stepped over', async () => {
  // One dead post must not end a run with a thousand live ones behind it.
  const root = await archives();
  const bin = await fakeBin('echo "404 Not Found" >&2\nexit 1');
  const result = await fetchPosts({ accountDir: root, posts, bin, intervalMs: 0 });

  assert.equal(result.failed, 3);
  assert.equal(result.stopped, null);
  assert.equal(result.fetched.posts, 0);
});

test('a rate limit stops the run, because every post left would meet it too', async () => {
  const root = await archives();
  const bin = await fakeBin('echo "429 Too Many Requests" >&2\nexit 1');
  const result = await fetchPosts({ accountDir: root, posts, bin, intervalMs: 0 });

  assert.equal(result.stopped, 'rate-limited');
  assert.equal(result.failed, 0, 'a run that stopped has not failed the posts it never tried');
});

test('a checkpoint stops the run rather than hammering at the challenge', async () => {
  // Going on is what turns a challenge into a locked account.
  const root = await archives();
  const bin = await fakeBin(
    'echo "HTTP redirect to challenge page (https://www.instagram.com/challenge/)" >&2\nexit 1',
  );
  const result = await fetchPosts({ accountDir: root, posts, bin, intervalMs: 0 });
  assert.equal(result.stopped, 'checkpoint-required');
});

test('a checkpoint is one of the failures that end a run', () => {
  assert.ok(FATAL.has('checkpoint-required'));
  assert.ok(!FATAL.has('post-gone'), 'one dead post is not the end of a run');
});

test('the pause between posts is paid before every post but the first', async () => {
  const root = await archives();
  const bin = await fakeBin('exit 0');
  const waits = [];
  await fetchPosts({
    accountDir: root,
    posts,
    bin,
    intervalMs: 500,
    sleepImpl: async (ms) => waits.push(ms),
  });
  assert.deepEqual(waits, [500, 500]);
});

test('the pause is slower than a listing request, because a download loop is longer', () => {
  assert.ok(POST_INTERVAL_MS >= 6000);
});

test('a post whose post.json could not be written is failed, not downloaded into', async () => {
  // A folder that can never satisfy the completeness check would be retried
  // forever; counting the post as failed here is what keeps the archive honest.
  const root = await archives();
  const bin = await fakeBin('exit 0');
  // A directory where post.json has to go: the rename that writes it fails.
  await mkdir(path.join(postDir(root, posts[0]), 'post.json'), { recursive: true });

  const result = await fetchPosts({ accountDir: root, posts: [posts[0]], bin, intervalMs: 0 });
  assert.equal(result.failed, 1);
  assert.equal(result.fetched.posts, 0);
});

test('the downloader is spawned through the seam it was handed', async () => {
  const root = await archives();
  const calls = [];
  await fetchPosts({
    accountDir: root,
    posts: [posts[1]],
    bin: '/box/gallery-dl',
    intervalMs: 0,
    spawnImpl: (bin, args) => {
      calls.push({ bin, args });
      const child = new EventEmitter();
      child.stdout = Readable.from([]);
      child.stderr = Readable.from([]);
      setImmediate(() => child.emit('close', 0));
      return child;
    },
  });

  assert.equal(calls[0].bin, '/box/gallery-dl');
  assert.ok(calls[0].args.includes('https://www.instagram.com/p/BBB'));
});

test('a finished post is reported to the caller as it lands', async () => {
  const root = await archives();
  const bin = await fakeBin('exit 0');
  const seen = [];
  await fetchPosts({
    accountDir: root,
    posts,
    bin,
    intervalMs: 0,
    onPost: ({ post, ok }, done) => seen.push([post.shortcode, ok, done]),
  });
  assert.deepEqual(seen, [['AAA', true, 1], ['BBB', true, 2], ['CCC', true, 3]]);
});

test('nothing but post.json is written when the downloader writes nothing', async () => {
  const root = await archives();
  const bin = await fakeBin('exit 0');
  await fetchPosts({ accountDir: root, posts: [posts[1]], bin, intervalMs: 0 });
  assert.deepEqual(await readdir(postDir(root, posts[1])), ['post.json']);
});
