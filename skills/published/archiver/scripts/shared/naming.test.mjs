import assert from 'node:assert/strict';
import test from 'node:test';

import { datePart, postFolderName, postIdFromFolder, toTimestamp } from './naming.mjs';

test('gallery-dl reports a moment with a space, and it is UTC', () => {
  // The one merge hazard worth a test of its own. `new Date('2024-03-11
  // 07:22:19')` is parsed as *local* time by JavaScript, so reading this form
  // through a plain Date would shift every folder name by the machine's offset —
  // and one archive would name different folders on two machines.
  assert.equal(toTimestamp('2024-03-11 07:22:19'), '2024-03-11T07:22:19Z');
  assert.equal(datePart('2024-03-11 07:22:19'), '2024-03-11');
});

test('a day with no time of day is midnight UTC, not local midnight', () => {
  assert.equal(toTimestamp('2024-03-11'), '2024-03-11T00:00:00Z');
});

test('yt-dlp and the Douyin feed report unix seconds', () => {
  assert.equal(toTimestamp(1710144139), '2024-03-11T08:02:19Z');
  assert.equal(datePart(1710144139), '2024-03-11');
});

test('an ISO instant survives unchanged', () => {
  assert.equal(toTimestamp('2024-03-11T07:22:19Z'), '2024-03-11T07:22:19Z');
  assert.equal(toTimestamp(new Date('2024-03-11T07:22:19Z')), '2024-03-11T07:22:19Z');
});

test('both platforms say the same moment the same way', () => {
  // post.json is one shape across a shared archives root, so the same instant
  // arriving as a gallery-dl string and as a yt-dlp unix second has to render
  // identically.
  assert.equal(toTimestamp('2024-03-11 08:02:19'), toTimestamp(1710144139));
});

test('half a timestamp is worse than none', () => {
  for (const nothing of [null, undefined, '', 0, NaN, 'yesterday', '2024-03']) {
    assert.equal(toTimestamp(nothing), null, String(nothing));
    assert.equal(datePart(nothing), 'undated', String(nothing));
  }
});

test('the folder is the date then the id', () => {
  assert.equal(postFolderName({ date: '2024-03-11 07:22:19', postId: '1767' }), '2024-03-11_1767');
  assert.equal(postFolderName({ date: 1710144139, postId: '7412' }), '2024-03-11_7412');
  assert.equal(postFolderName({ date: null, postId: '7412' }), 'undated_7412');
});

test('the id comes back out of a folder we wrote', () => {
  assert.equal(postIdFromFolder('2024-03-11_1767'), '1767');
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
  for (const date of ['2024-03-11 07:22:19', 1710144139, null]) {
    const name = postFolderName({ date, postId: '7412345678901234567' });
    assert.equal(postIdFromFolder(name), '7412345678901234567', String(date));
  }
});
