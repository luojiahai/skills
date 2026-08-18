import assert from 'node:assert/strict';
import test from 'node:test';

import { parseTarget, permalink } from './target.mjs';

test('a profile URL is an account', () => {
  const target = parseTarget('https://www.douyin.com/user/MS4wLjABAAAAEKnfa654');
  assert.equal(target.secUid, 'MS4wLjABAAAAEKnfa654');
  assert.equal(target.url, 'https://www.douyin.com/user/MS4wLjABAAAAEKnfa654');
});

test('the URL is rebuilt canonically, so one account is never two archives', () => {
  // A profile URL carrying a tracking parameter is the same account, and letting
  // two spellings through would make two archives of it.
  for (const spelling of [
    'https://www.douyin.com/user/MS4w?from_tab_name=main',
    'https://douyin.com/user/MS4w',
    'douyin.com/user/MS4w/',
    'https://www.douyin.com/user/MS4w#anchor',
  ]) {
    assert.equal(parseTarget(spelling).url, 'https://www.douyin.com/user/MS4w', spelling);
  }
});

test('a post URL is refused rather than read as the account that posted it', () => {
  // This is the whole reason the module exists: refusing "download this one
  // video" rather than answering it by archiving the entire account. It gets its
  // own code, because "that is not a profile URL" is true and unhelpful when the
  // user pointed at a post on purpose.
  for (const url of ['https://www.douyin.com/video/7412345', 'https://www.douyin.com/note/7412345']) {
    assert.throws(
      () => parseTarget(url),
      (error) => {
        assert.equal(error.code, 'url-single-post');
        assert.equal(error.details.post_id, '7412345');
        assert.equal(error.remedy.run_by, 'user');
        return true;
      },
      url,
    );
  }
});

test('a share link is its own code, because expanding it is the user’s to do', () => {
  assert.throws(() => parseTarget('https://v.douyin.com/iRNBho6G/'), (error) => {
    assert.equal(error.code, 'url-share-link');
    assert.equal(error.remedy.run_by, 'user');
    return true;
  });
});

test('a URL naming no account is refused', () => {
  assert.throws(() => parseTarget('https://www.douyin.com/user/'), /profile URL/);
  assert.throws(() => parseTarget('https://www.douyin.com/'), /profile URL/);
});

test('a non-Douyin URL is refused', () => {
  assert.throws(() => parseTarget('https://x.com/jack'), /profile URL/);
});

test('every refusal says what was expected', () => {
  for (const bad of ['https://www.douyin.com/video/1', 'https://x.com/jack', '']) {
    assert.throws(() => parseTarget(bad), /MS4wLjABAAAA/, bad);
  }
});

test('permalink is the canonical form --go re-fetches by', () => {
  assert.equal(permalink('7412'), 'https://www.douyin.com/video/7412');
});
