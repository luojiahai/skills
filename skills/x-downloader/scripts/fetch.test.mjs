import assert from 'node:assert/strict';
import test from 'node:test';

import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { fetchPosts, outstanding } from './fetch.mjs';

async function fakeBin(script) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'x-dl-bin-'));
  const bin = path.join(dir, 'fake-gallery-dl');
  await writeFile(bin, `#!/bin/sh
${script}
`);
  await chmod(bin, 0o755);
  return bin;
}

const posts = [
  { tweetId: '1', count: 2, files: [{}, {}] },
  { tweetId: '2', count: 1, files: [{}] },
  { tweetId: '3', count: 4, files: [{}, {}, {}, {}] },
];

test('everything is outstanding against an empty folder', () => {
  assert.deepEqual(outstanding(posts, new Map()).map((p) => p.tweetId), ['1', '2', '3']);
});

test('a complete post is not fetched again', () => {
  const archive = new Map([['1', { mediaCount: 2 }]]);
  assert.deepEqual(outstanding(posts, archive).map((p) => p.tweetId), ['2', '3']);
});

test('a post whose files half landed is finished rather than abandoned', () => {
  const archive = new Map([['3', { mediaCount: 2 }]]);
  assert.ok(outstanding(posts, archive).some((p) => p.tweetId === '3'));
});

test('a folder holding more files than expected still counts as done', () => {
  const archive = new Map([['2', { mediaCount: 5 }]]);
  assert.ok(!outstanding(posts, archive).some((p) => p.tweetId === '2'));
});

test('an approved plan fully on disk leaves nothing outstanding', () => {
  const archive = new Map([
    ['1', { mediaCount: 2 }],
    ['2', { mediaCount: 1 }],
    ['3', { mediaCount: 4 }],
  ]);
  assert.deepEqual(outstanding(posts, archive), []);
});

test('a post whose media partly failed still gets its text.txt', async () => {
  // The failure this guards: one 404'd image in a four-image post used to
  // return before the text was written, leaving media in a folder with nothing
  // saying what it was.
  const dir = await mkdtemp(path.join(os.tmpdir(), 'x-dl-fetch-'));
  const bin = await fakeBin('echo "HttpError: 404 Not Found" >&2; exit 1');

  const result = await fetchPosts({
    accountDir: dir,
    handle: 'someone',
    bin,
    posts: [{ tweetId: '1', count: 2, files: [{}, {}], date: '2024-03-11 07:22:19', content: 'hi' }],
  });

  assert.equal(result.failed, 1);
  assert.equal(result.fetched.posts, 0);
  assert.equal(result.stopped, null, 'a dead-media 404 must not end the run');

  const folder = path.join(dir, 'posts', '2024-03-11 - hi [1]');
  assert.match(await readFile(path.join(folder, 'text.txt'), 'utf8'), /hi/);
});

test('a rate limit ends the run instead of grinding through every post', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'x-dl-fetch-'));
  const bin = await fakeBin('echo "HttpError: 429 Too Many Requests" >&2; exit 1');

  const result = await fetchPosts({
    accountDir: dir,
    handle: 'someone',
    bin,
    posts: [
      { tweetId: '1', count: 1, files: [{}], date: '2024-03-11 07:22:19', content: 'a' },
      { tweetId: '2', count: 1, files: [{}], date: '2024-03-10 07:22:19', content: 'b' },
    ],
  });

  assert.equal(result.stopped, 'rate-limited');
  assert.equal(result.failed, 0);
});
