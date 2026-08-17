import assert from 'node:assert/strict';
import test from 'node:test';

import { datePart, permalink, postFolderName, postIdFromFolder, toTimestamp } from './naming.mjs';

test('a unix second becomes a UTC date', () => {
  assert.equal(datePart(1710144139), '2024-03-11');
});

test('an ISO timestamp becomes its date', () => {
  assert.equal(datePart('2024-03-11T08:02:19Z'), '2024-03-11');
});

test('a post with no usable date is undated, not today', () => {
  // `undated` is a literal, and dating a post by when it was archived would be a
  // fact the archive invented.
  for (const nothing of [null, undefined, '', 0, NaN, 'nonsense']) {
    assert.equal(datePart(nothing), 'undated', String(nothing));
  }
});

test('the folder is the date then the id', () => {
  // Date first so a directory listing sorts as a timeline; the id always,
  // because it is what makes the name unique.
  assert.equal(postFolderName({ date: 1710144139, postId: '7412' }), '2024-03-11_7412');
  assert.equal(postFolderName({ date: null, postId: '7412' }), 'undated_7412');
});

test('the id comes back out of a folder we wrote', () => {
  assert.equal(postIdFromFolder('2024-03-11_7412'), '7412');
  assert.equal(postIdFromFolder('undated_7412'), '7412');
});

test('a folder we did not write yields no id', () => {
  // A loose match would read `drafts_2` as post 2, and the skill would then
  // count that post as downloaded and skip it forever — a silent, permanent
  // hole in the archive.
  for (const name of ['drafts_2', '2024-3-11_7412', '2024-03-11_7412 ', '_7412', '2024-03-11_']) {
    assert.equal(postIdFromFolder(name), null, name);
  }
});

test('a folder name survives the round trip', () => {
  const name = postFolderName({ date: 1710144139, postId: '7412345678901234567' });
  assert.equal(postIdFromFolder(name), '7412345678901234567');
});

test('a timestamp is the moment, where the folder keeps only the day', () => {
  // Same fact, two precisions, deliberately: the folder wants a sortable day and
  // post.json wants the instant.
  assert.equal(toTimestamp(1710144139), '2024-03-11T08:02:19Z');
  assert.equal(toTimestamp(null), null);
  assert.equal(toTimestamp('nonsense'), null);
});

test('the permalink is how --go re-fetches a post', () => {
  assert.equal(permalink('7412'), 'https://www.douyin.com/video/7412');
});
