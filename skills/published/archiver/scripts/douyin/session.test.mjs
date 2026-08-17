import assert from 'node:assert/strict';
import test from 'node:test';

import { douyinCookies, hasSession, isSessionCookie, toNetscape } from './session.mjs';

const cookie = (over = {}) => ({
  domain: '.douyin.com',
  name: 'sessionid',
  value: 'abc',
  path: '/',
  secure: true,
  expires: 1893456000,
  ...over,
});

test('a signed-in profile is told apart from one that merely visited', () => {
  // Douyin hands a pile of tracking cookies to anonymous visitors, so "has
  // douyin cookies" is not "has a session" — answering the first when the
  // second was asked is what gets a run all the way to a browser before it
  // reports an empty grid.
  assert.equal(hasSession([cookie({ name: 'ttwid' }), cookie({ name: 'msToken' })]), false);
  assert.equal(hasSession([cookie({ name: 'ttwid' }), cookie()]), true);
});

test('every cookie Douyin uses for a session counts', () => {
  for (const name of ['sessionid', 'sessionid_ss', 'sid_tt']) {
    assert.equal(isSessionCookie(cookie({ name })), true, name);
  }
});

test('an empty session cookie is not a session', () => {
  assert.equal(isSessionCookie(cookie({ value: '' })), false);
});

test('a lookalike domain is not douyin', () => {
  // Anchored on a label boundary, so notdouyin.com cannot answer for douyin.com.
  assert.equal(isSessionCookie(cookie({ domain: 'notdouyin.com' })), false);
  assert.equal(douyinCookies([cookie({ domain: 'evil-douyin.com' })]).length, 0);
  for (const domain of ['douyin.com', '.douyin.com', 'www.douyin.com']) {
    assert.equal(douyinCookies([cookie({ domain })]).length, 1, domain);
  }
});

test('nothing at all is not a session, rather than a crash', () => {
  assert.equal(hasSession(null), false);
  assert.equal(hasSession([]), false);
  assert.equal(isSessionCookie(null), false);
  assert.deepEqual(douyinCookies(undefined), []);
});

test('the netscape file is what yt-dlp expects, tab by tab', () => {
  const lines = toNetscape([cookie()]).trim().split('\n');
  assert.match(lines[0], /^# Netscape HTTP Cookie File$/);
  assert.deepEqual(lines.at(-1).split('\t'), [
    '.douyin.com', 'TRUE', '/', 'TRUE', '1893456000', 'sessionid', 'abc',
  ]);
});

test('a host-only cookie does not claim to cover subdomains', () => {
  assert.equal(toNetscape([cookie({ domain: 'douyin.com' })]).trim().split('\n').at(-1).split('\t')[1], 'FALSE');
});

test('a session cookie with no expiry is written as non-expiring', () => {
  // Playwright reports -1 for a session cookie; yt-dlp reads 0 as "no expiry".
  // Writing -1 through would make yt-dlp treat a live cookie as long expired.
  for (const expires of [-1, 0, undefined]) {
    const fields = toNetscape([cookie({ expires })]).trim().split('\n').at(-1).split('\t');
    assert.equal(fields[4], '0', String(expires));
  }
});
