import assert from 'node:assert/strict';
import test from 'node:test';

import { datePart, postFolderName, permalink, tweetIdFromFolder } from './naming.mjs';

test('datePart takes the day out of a gallery-dl timestamp', () => {
  assert.equal(datePart('2024-03-11 07:22:19'), '2024-03-11');
});

test('datePart falls back rather than producing an empty component', () => {
  assert.equal(datePart(''), 'undated');
  assert.equal(datePart(null), 'undated');
});

test('postFolderName is the date and the id, so the listing sorts as a timeline', () => {
  assert.equal(postFolderName({ date: '2024-03-11 07:22:19', tweetId: '1767' }), '2024-03-11_1767');
});

test('postFolderName ignores post text even when handed some', () => {
  // A guard against the slug coming back: `content` is not in the signature, so
  // this can only fail if someone puts post text in the path again.
  assert.equal(
    postFolderName({ date: '2024-03-11 07:22:19', content: '../../etc/passwd', tweetId: '1767' }),
    '2024-03-11_1767',
  );
});

test('postFolderName falls back to undated rather than an empty component', () => {
  assert.equal(postFolderName({ date: '', tweetId: '1767' }), 'undated_1767');
});

test('tweetIdFromFolder round-trips postFolderName', () => {
  const name = postFolderName({ date: '2024-03-11 00:00:00', tweetId: '99' });
  assert.equal(tweetIdFromFolder(name), '99');
});

test('tweetIdFromFolder reads an undated folder', () => {
  assert.equal(tweetIdFromFolder('undated_1767'), '1767');
});

test('tweetIdFromFolder is null for a folder that is not ours', () => {
  assert.equal(tweetIdFromFolder('posts'), null);
  assert.equal(tweetIdFromFolder(''), null);
  assert.equal(tweetIdFromFolder(null), null);
});

test('tweetIdFromFolder ignores a folder that merely ends in _digits', () => {
  // Why this matters is on tweetIdFromFolder itself.
  assert.equal(tweetIdFromFolder('drafts_2'), null);
  assert.equal(tweetIdFromFolder('2024-03-11 - a trip_1767'), null);
  assert.equal(tweetIdFromFolder('2024-03-11_1767 copy'), null);
  assert.equal(tweetIdFromFolder(' 2024-03-11_1767 '), null);
});

test('permalink is the canonical form --go re-fetches by', () => {
  assert.equal(permalink('someone', '123'), 'https://x.com/someone/status/123');
  assert.equal(permalink('', '123'), 'https://x.com/i/web/status/123');
});
