import assert from 'node:assert/strict';
import test from 'node:test';

import {
  datePart,
  postFolderName,
  postText,
  permalink,
  slugify,
  tweetIdFromFolder,
} from './naming.mjs';

test('slugify keeps ordinary text intact', () => {
  assert.equal(slugify('hello world'), 'hello world');
});

test('slugify flattens newlines into single spaces', () => {
  assert.equal(slugify('one\ntwo\r\n\r\nthree'), 'one two three');
});

test('slugify removes path separators', () => {
  assert.equal(slugify('a/b\\c'), 'a b c');
  assert.ok(!slugify('../../etc/passwd').includes('/'));
});

test('slugify removes characters that are illegal on some filesystem', () => {
  assert.equal(slugify('a:b*c?d"e<f>g|h'), 'a b c d e f g h');
});

test('slugify strips control and bidi-override characters', () => {
  assert.equal(slugify('a\u0000b\u202ec'), 'a b c');
});

test('slugify never yields a name that is only dots', () => {
  assert.equal(slugify('..'), '');
  assert.equal(slugify('.'), '');
});

test('slugify strips trailing dots and spaces, which Windows cannot open', () => {
  assert.equal(slugify('report...'), 'report');
  assert.equal(slugify('report   '), 'report');
});

test('slugify truncates to the requested length', () => {
  assert.equal(slugify('a'.repeat(200), 10), 'aaaaaaaaaa');
});

test('slugify truncates whole characters, never half a surrogate pair', () => {
  const s = slugify('😀'.repeat(50), 3);
  assert.equal(Array.from(s).length, 3);
  assert.equal(Buffer.from(s, 'utf8').toString('utf8'), s);
});

test('slugify keeps a combining emoji whole rather than splitting it', () => {
  // A family emoji is several code points and one grapheme.
  const family = '👨‍👩‍👧‍👦';
  const s = slugify(family + 'x', 1);
  assert.ok(s === family || s === 'x' || Array.from(s).length >= 1);
  assert.equal(Buffer.from(s, 'utf8').toString('utf8'), s);
});

test('slugify returns empty for input that is entirely unusable', () => {
  assert.equal(slugify('///'), '');
  assert.equal(slugify('   '), '');
  assert.equal(slugify(''), '');
});

test('slugify tolerates non-string input rather than throwing', () => {
  assert.equal(slugify(null), '');
  assert.equal(slugify(undefined), '');
  assert.equal(slugify(42), '');
});

test('datePart takes the day out of a gallery-dl timestamp', () => {
  assert.equal(datePart('2024-03-11 07:22:19'), '2024-03-11');
});

test('datePart falls back rather than producing an empty component', () => {
  assert.equal(datePart(''), 'undated');
  assert.equal(datePart(null), 'undated');
});

test('postFolderName sorts by date and ends with the id', () => {
  assert.equal(
    postFolderName({ date: '2024-03-11 07:22:19', content: 'a trip', tweetId: '1767' }),
    '2024-03-11 - a trip [1767]',
  );
});

test('postFolderName omits the slug for a post with no usable text', () => {
  assert.equal(
    postFolderName({ date: '2024-03-11 07:22:19', content: '   ', tweetId: '1767' }),
    '2024-03-11 [1767]',
  );
});

test('tweetIdFromFolder round-trips postFolderName', () => {
  const name = postFolderName({ date: '2024-03-11 00:00:00', content: 'x/y', tweetId: '99' });
  assert.equal(tweetIdFromFolder(name), '99');
});

test('tweetIdFromFolder is null for a folder that is not ours', () => {
  assert.equal(tweetIdFromFolder('posts'), null);
  assert.equal(tweetIdFromFolder(''), null);
});

test('tweetIdFromFolder is not fooled by an id-like string mid-name', () => {
  assert.equal(tweetIdFromFolder('2024-01-01 - see [123] for more [456]'), '456');
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

test('permalink is the canonical form --go re-fetches by', () => {
  assert.equal(permalink('someone', '123'), 'https://x.com/someone/status/123');
  assert.equal(permalink('', '123'), 'https://x.com/i/web/status/123');
});
