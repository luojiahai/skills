import assert from 'node:assert/strict';
import test from 'node:test';

import { PLATFORMS, detect, supported } from './platforms.mjs';

test('a Douyin profile URL is Douyin', () => {
  assert.equal(detect(['https://www.douyin.com/user/MS4wLjABAAAA']).name, 'douyin');
});

test('a Douyin short link is Douyin', () => {
  assert.equal(detect(['https://v.douyin.com/iRNBho6G/']).name, 'douyin');
});

test('an X profile URL is X', () => {
  assert.equal(detect(['https://x.com/jack']).name, 'x');
});

test('twitter.com is X too', () => {
  assert.equal(detect(['https://twitter.com/jack']).name, 'x');
});

test('a URL without a scheme still resolves', () => {
  assert.equal(detect(['x.com/jack']).name, 'x');
  assert.equal(detect(['www.douyin.com/user/MS4w']).name, 'douyin');
});

test('mobile and www hosts resolve', () => {
  assert.equal(detect(['https://mobile.twitter.com/jack']).name, 'x');
  assert.equal(detect(['https://www.x.com/jack']).name, 'x');
});

test('the URL need not come first', () => {
  assert.equal(detect(['--archives', '~/data', 'https://x.com/jack', '--plan']).name, 'x');
});

test('detection answers which platform, never whether the URL is archivable', () => {
  // A single-post URL belongs to a platform. Refusing it is that platform's job,
  // and it refuses by name — which it can only do once it has been dispatched to.
  assert.equal(detect(['https://www.douyin.com/video/7412']).name, 'douyin');
  assert.equal(detect(['https://x.com/jack/status/1767']).name, 'x');
  assert.equal(detect(['https://x.com/i/bookmarks']).name, 'x');
});

test('a platform this skill does not archive resolves to nothing', () => {
  assert.equal(detect(['https://www.instagram.com/someone']), null);
  assert.equal(detect(['https://youtube.com/@someone']), null);
});

test('no URL at all resolves to nothing', () => {
  assert.equal(detect([]), null);
  assert.equal(detect(['--plan', '--archives', '~/data']), null);
});

test('a flag value that merely mentions a host is not a URL', () => {
  // --archives takes a path, and a path is not dispatched on. Scanning every
  // argument is what lets the URL sit anywhere, so the patterns have to be tight
  // enough that a directory name cannot answer for one.
  assert.equal(detect(['--archives', '/data/x.com-backup', '--plan']), null);
  assert.equal(detect(['--archives', './douyin.com', '--plan']), null);
});

test('two platforms named in one command is a refusal, not a coin toss', () => {
  assert.throws(
    () => detect(['https://x.com/jack', 'https://www.douyin.com/user/MS4w']),
    /one account at a time/,
  );
});

test('the same platform twice is not ambiguous', () => {
  assert.equal(detect(['https://x.com/jack', 'https://twitter.com/jack']).name, 'x');
});

test('every platform names a folder and a label', () => {
  for (const platform of PLATFORMS) {
    assert.match(platform.name, /^[a-z]+$/);
    assert.equal(platform.dir, platform.name);
    assert.ok(platform.label.length > 0, `${platform.name} needs a label`);
  }
});

test('the supported list reads as prose for a refusal message', () => {
  assert.equal(supported(), 'Douyin (douyin.com) and X, formerly Twitter (x.com, twitter.com)');
});
