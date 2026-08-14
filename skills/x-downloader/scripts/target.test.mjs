import assert from 'node:assert/strict';
import test from 'node:test';

import { parseTarget } from './target.mjs';

test('a profile URL is an account', () => {
  assert.deepEqual(parseTarget('https://x.com/someone'), {
    kind: 'account',
    handle: 'someone',
    tweetId: null,
    url: 'https://x.com/someone',
  });
});

test('a status URL is one post', () => {
  const t = parseTarget('https://x.com/someone/status/1767');
  assert.equal(t.kind, 'post');
  assert.equal(t.tweetId, '1767');
  assert.equal(t.url, 'https://x.com/someone/status/1767');
});

test('twitter.com is the same site', () => {
  assert.equal(parseTarget('https://twitter.com/someone').kind, 'account');
  assert.equal(parseTarget('https://www.twitter.com/someone/status/1').kind, 'post');
  assert.equal(parseTarget('https://mobile.x.com/someone').kind, 'account');
});

test('a URL without a scheme still parses', () => {
  assert.equal(parseTarget('x.com/someone').kind, 'account');
});

test('the URL is rebuilt canonically, so one account is never two archives', () => {
  assert.equal(parseTarget('https://x.com/someone/?f=live').url, 'https://x.com/someone');
  assert.equal(parseTarget('https://x.com/someone/').url, 'https://x.com/someone');
  assert.equal(parseTarget('https://x.com/someone/media').url, 'https://x.com/someone');
});

test('a photo sub-path on a post is still that post', () => {
  assert.equal(parseTarget('https://x.com/someone/status/1767/photo/2').tweetId, '1767');
});

test('likes and bookmarks are refused by name rather than read as an account', () => {
  assert.equal(parseTarget('https://x.com/someone/likes').kind, 'unsupported');
  assert.equal(parseTarget('https://x.com/i/bookmarks').kind, 'unsupported');
  assert.equal(parseTarget('https://x.com/someone/with_replies').kind, 'unsupported');
  assert.equal(parseTarget('https://x.com/someone/following').kind, 'unsupported');
});

test('x.com own pages are not handles', () => {
  assert.equal(parseTarget('https://x.com/home').kind, 'unsupported');
  assert.equal(parseTarget('https://x.com/search?q=cats').kind, 'unsupported');
  assert.equal(parseTarget('https://x.com/hashtag/cats').kind, 'unsupported');
});

test('a non-X URL is refused', () => {
  assert.equal(parseTarget('https://example.com/someone').kind, 'unsupported');
  assert.equal(parseTarget('').kind, 'unsupported');
  assert.equal(parseTarget(null).kind, 'unsupported');
});

test('a bare x.com names no account', () => {
  assert.equal(parseTarget('https://x.com/').kind, 'unsupported');
});

test('a status URL with no id is refused rather than read as an account', () => {
  assert.equal(parseTarget('https://x.com/someone/status/').kind, 'unsupported');
});

test('every refusal says why', () => {
  for (const url of ['https://example.com', 'https://x.com/someone/likes', 'https://x.com/']) {
    assert.ok(parseTarget(url).why.length > 0, url);
  }
});
