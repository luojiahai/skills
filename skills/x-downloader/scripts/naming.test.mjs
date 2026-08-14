import assert from 'node:assert/strict';
import test from 'node:test';

import { datePart, postFolderName, postText, permalink, tweetIdFromFolder } from './naming.mjs';

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

test('postText writes a header and body', () => {
  const out = postText({
    permalink: 'https://x.com/a/status/1',
    date: '2024-03-11 07:22:19',
    content: 'hello',
  });
  assert.equal(out, 'https://x.com/a/status/1\n2024-03-11 07:22:19\n\nhello\n');
});

test('postText notes what a reply replies to', () => {
  const out = postText({
    permalink: 'https://x.com/a/status/1',
    date: '2024-03-11 07:22:19',
    content: 'yes',
    replyUrl: 'https://x.com/i/web/status/99',
  });
  assert.ok(out.includes('in reply to https://x.com/i/web/status/99'));
});

test('postText omits the reply line for a post that is not a reply', () => {
  const out = postText({
    permalink: 'https://x.com/a/status/1',
    date: '2024-03-11 07:22:19',
    content: 'hi',
  });
  assert.ok(!out.includes('in reply to'));
});

test('postText is still written for a post with no text at all', () => {
  const out = postText({
    permalink: 'https://x.com/a/status/1',
    date: '2024-03-11 07:22:19',
    content: '',
  });
  assert.ok(out.startsWith('https://x.com/a/status/1'));
  assert.ok(out.endsWith('\n'));
});

test('postText keeps the full body the folder name no longer carries', () => {
  const body = 'a'.repeat(500);
  const out = postText({
    permalink: 'https://x.com/a/status/1',
    date: '2024-03-11 07:22:19',
    content: body,
  });
  assert.ok(out.includes(body));
});

test('permalink is the canonical form --go re-fetches by', () => {
  assert.equal(permalink('someone', '123'), 'https://x.com/someone/status/123');
  assert.equal(permalink('', '123'), 'https://x.com/i/web/status/123');
});
