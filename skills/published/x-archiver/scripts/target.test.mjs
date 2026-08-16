import assert from 'node:assert/strict';
import test from 'node:test';

import { parseTarget } from './target.mjs';

test('a profile URL is an account', () => {
  assert.deepEqual(parseTarget('https://x.com/someone'), {
    handle: 'someone',
    url: 'https://x.com/someone',
  });
});

test('twitter.com is the same site', () => {
  assert.equal(parseTarget('https://twitter.com/someone').url, 'https://x.com/someone');
  assert.equal(parseTarget('https://mobile.x.com/someone').url, 'https://x.com/someone');
});

test('a URL without a scheme still parses', () => {
  assert.equal(parseTarget('x.com/someone').handle, 'someone');
});

test('the URL is rebuilt canonically, so one account is never two archives', () => {
  assert.equal(parseTarget('https://x.com/someone/?f=live').url, 'https://x.com/someone');
  assert.equal(parseTarget('https://x.com/someone/').url, 'https://x.com/someone');
  assert.equal(parseTarget('https://x.com/someone/media').url, 'https://x.com/someone');
});

test('a post URL is refused rather than read as the account that posted it', () => {
  // The reason this is worth a test of its own: the handle sits in the same
  // position in both URLs, so a parser that stopped reading after it would
  // answer a request for one post by archiving an entire account.
  for (const url of [
    'https://x.com/someone/status/1767',
    'https://x.com/someone/status/1767/photo/2',
    'https://x.com/someone/status/',
    'https://twitter.com/someone/statuses/1767',
  ]) {
    assert.throws(() => parseTarget(url), /out of scope/, url);
  }
});

test('likes and bookmarks are refused by name rather than read as an account', () => {
  assert.throws(() => parseTarget('https://x.com/someone/likes'));
  assert.throws(() => parseTarget('https://x.com/i/bookmarks'));
  assert.throws(() => parseTarget('https://x.com/someone/with_replies'));
  assert.throws(() => parseTarget('https://x.com/someone/following'));
});

test('x.com own pages are not handles', () => {
  assert.throws(() => parseTarget('https://x.com/home'));
  assert.throws(() => parseTarget('https://x.com/search?q=cats'));
  assert.throws(() => parseTarget('https://x.com/hashtag/cats'));
});

test('a non-X URL is refused', () => {
  assert.throws(() => parseTarget('https://example.com/someone'));
  assert.throws(() => parseTarget(''));
  assert.throws(() => parseTarget(null));
});

test('a bare x.com names no account', () => {
  assert.throws(() => parseTarget('https://x.com/'));
});

test('every refusal says why', () => {
  for (const url of ['https://example.com', 'https://x.com/someone/likes', 'https://x.com/']) {
    assert.throws(() => parseTarget(url), (error) => error.message.length > 0, url);
  }
});
