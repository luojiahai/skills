/**
 * Tests for folding gallery-dl's per-file rows into posts — the half of
 * collect.mjs that needs no subprocess. The listing pass itself is
 * collect.test.mjs.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { classify, diff, groupFiles } from './collect.mjs';
import { buildPost } from '../../shared/post.mjs';
import { outstanding } from '../../shared/landed.mjs';

const rows = [
  { tweetId: '1', num: 1, ext: 'jpg', date: '2024-03-11 07:22:19', content: 'a' },
  { tweetId: '1', num: 2, ext: 'jpg', date: '2024-03-11 07:22:19', content: 'a' },
  { tweetId: '2', num: 1, ext: 'mp4', date: '2024-03-10 07:22:19', content: 'b' },
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
});

test('groupFiles preserves enumeration order, newest first', () => {
  assert.deepEqual(groupFiles(rows).map((p) => p.tweetId), ['1', '2']);
});

test('groupFiles carries what post.json needs off the first row', () => {
  const [post] = groupFiles([
    { tweetId: '9', num: 1, ext: 'jpg', date: '2024-01-01 00:00:00', content: 'hi', replyId: '42', user: { name: 'someone' } },
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

test('the diff offers exactly what the fetch will take, and never more', () => {
  // The one rule. `--go` decides what to hand the fetcher by calling
  // `outstanding`; a diff that answered this question its own way would offer
  // posts the fetch then skips, and the run would report zero downloaded against
  // everything the user approved.
  // A landed post carrying two files and a landed post carrying one, so a stray
  // predicate on either shape shows up here, plus one genuinely absent.
  const archive = new Map([onDisk('1', ['1.jpg', '2.jpg']), onDisk('2', ['1.mp4'])]);
  const posts = groupFiles([...rows, { tweetId: '3', num: 1, ext: 'jpg', date: '2024-03-09 07:22:19' }]);
  const result = diff(posts, archive, 'tweetId');

  assert.deepEqual(result.toFetch, outstanding(posts, archive, 'tweetId'));
  assert.deepEqual(result.toFetch.map((p) => p.tweetId), ['3']);
  assert.equal(result.counts.onDiskPosts, 2);
});
