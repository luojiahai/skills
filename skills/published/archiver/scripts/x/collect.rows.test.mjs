/**
 * Tests for folding gallery-dl's per-file rows into posts — the half of
 * collect.mjs that needs no subprocess. The listing pass itself is
 * collect.test.mjs.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { classify, diff, groupFiles } from './collect.mjs';
import { buildPost } from '../shared/post.mjs';

const rows = [
  { tweetId: '1', num: 1, count: 2, ext: 'jpg', date: '2024-03-11 07:22:19', content: 'a' },
  { tweetId: '1', num: 2, count: 2, ext: 'jpg', date: '2024-03-11 07:22:19', content: 'a' },
  { tweetId: '2', num: 1, count: 1, ext: 'mp4', date: '2024-03-10 07:22:19', content: 'b' },
];

/**
 * One archived post: it says it carries `listed` and the folder holds `present`.
 * The same shape landed.mjs's readArchive returns.
 */
function onDisk(id, listed, present = listed) {
  const media = listed.map((name) => {
    const [num, ext] = name.split('.');
    return { num, ext };
  });
  return [id, { folder: `2024-01-01_${id}`, names: [...present, 'post.json'], post: buildPost({ id, media }) }];
}

test('groupFiles folds file rows into posts', () => {
  const posts = groupFiles(rows);
  assert.equal(posts.length, 2);
  assert.equal(posts[0].tweetId, '1');
  assert.equal(posts[0].files.length, 2);
  assert.equal(posts[0].count, 2);
});

test('groupFiles preserves enumeration order, newest first', () => {
  assert.deepEqual(groupFiles(rows).map((p) => p.tweetId), ['1', '2']);
});

test('groupFiles carries what post.json needs off the first row', () => {
  const [post] = groupFiles([
    { tweetId: '9', num: 1, count: 1, ext: 'jpg', date: '2024-01-01 00:00:00', content: 'hi', replyId: '42', user: { name: 'someone' } },
  ]);
  assert.equal(post.replyId, '42');
  assert.equal(post.handle, 'someone');
  assert.equal(post.content, 'hi');
});

test('a file record is already in the shape post.json wants', () => {
  // fetch.mjs hands these straight to buildPost. A mapping step between the two
  // would be a second place the media list could be got wrong.
  const [post] = groupFiles([
    { tweetId: '9', num: 1, ext: 'jpg', url: 'https://pbs.twimg.com/media/ABC.jpg', type: 'photo', mediaId: 'ABC' },
  ]);
  assert.deepEqual(post.files, [
    { num: 1, ext: 'jpg', url: 'https://pbs.twimg.com/media/ABC.jpg', type: 'photo', id: 'ABC' },
  ]);
});

test('groupFiles trusts the extractor count over a truncated tally', () => {
  const [post] = groupFiles([{ tweetId: '9', num: 1, count: 4, ext: 'jpg' }]);
  assert.equal(post.count, 4);
  assert.equal(post.files.length, 1);
});

test('groupFiles falls back to its own tally when no count is reported', () => {
  const [post] = groupFiles([
    { tweetId: '9', num: 1, ext: 'jpg' },
    { tweetId: '9', num: 2, ext: 'jpg' },
  ]);
  assert.equal(post.count, 2);
});

test('classify splits images from videos', () => {
  assert.deepEqual(classify(groupFiles(rows)), { images: 2, videos: 1 });
});

test('diff of an empty archive is everything', () => {
  const result = diff(groupFiles(rows), new Map());
  assert.equal(result.toFetch.length, 2);
  assert.equal(result.counts.fetchPosts, 2);
  assert.equal(result.counts.fetchFiles, 3);
  assert.equal(result.counts.onDiskPosts, 0);
});

test('diff omits posts already complete on disk', () => {
  const archive = new Map([onDisk('1', ['1.jpg', '2.jpg'])]);
  const result = diff(groupFiles(rows), archive, 'tweetId');
  assert.deepEqual(result.toFetch.map((p) => p.tweetId), ['2']);
  assert.equal(result.counts.onDiskPosts, 1);
});

test('diff re-fetches a post whose files are only half there', () => {
  const archive = new Map([onDisk('1', ['1.jpg', '2.jpg'], ['1.jpg'])]);
  const result = diff(groupFiles(rows), archive, 'tweetId');
  assert.deepEqual(result.toFetch.map((p) => p.tweetId), ['1', '2']);
});

test('diff counts found files across every post, fetched or not', () => {
  const archive = new Map([onDisk('1', ['1.jpg', '2.jpg'])]);
  const result = diff(groupFiles(rows), archive, 'tweetId');
  assert.equal(result.counts.foundPosts, 2);
  assert.equal(result.counts.foundFiles, 3);
});

const goodPlan = {
  createdAt: new Date(1_700_000_000_000).toISOString(),
  account: { id: '55', handle: 'someone' },
  root: '/data',
  url: 'https://x.com/someone',
};
const now = 1_700_000_000_000 + 60_000;

test('a post the extractor says has more files than were seen is fetched again', () => {
  // Enumeration cut off between two of one post's rows — a rate limit landing
  // mid-post. The plan would otherwise list two of the post's four images,
  // gallery-dl would fetch all four, and the completeness check would be
  // satisfied by the two that were listed, for good.
  const post = { tweetId: '9', count: 4, files: [{ num: 1, ext: 'jpg' }, { num: 2, ext: 'jpg' }] };
  const archive = new Map([onDisk('9', ['1.jpg', '2.jpg'])]);

  const result = diff([post], archive, 'tweetId');
  assert.deepEqual(result.toFetch.map((p) => p.tweetId), ['9']);
  assert.equal(result.counts.underDescribed, 1);
});

test('a post whose file count matches what was seen is not counted as short', () => {
  const post = { tweetId: '9', count: 2, files: [{ num: 1, ext: 'jpg' }, { num: 2, ext: 'jpg' }] };
  assert.equal(diff([post], new Map(), 'tweetId').counts.underDescribed, 0);
});
