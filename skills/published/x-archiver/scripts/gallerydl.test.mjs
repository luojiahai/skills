import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PRINT_FORMAT,
  ROW_MARKER,
  classifyFailure,
  cookieArgs,
  fetchArgs,
  listArgs,
  parseRow,
} from './gallerydl.mjs';

test('the print format carries an explicit event prefix', () => {
  // gallery-dl partitions the --print value on its first colon to find an
  // event name. Without "prepare:", the colon inside {date:%Y-%m-%d} would be
  // read as the separator and "{date" as the event.
  assert.ok(PRINT_FORMAT.startsWith('prepare:'));
  const format = PRINT_FORMAT.slice('prepare:'.length);
  assert.ok(format.startsWith(`${ROW_MARKER}\t`));
});

test('free-text fields are JSON-encoded in the print format', () => {
  assert.ok(PRINT_FORMAT.includes('{content!j}'));
  assert.ok(PRINT_FORMAT.includes('{user[nick]!j}'));
});

test('the print format names no optional extractor field', () => {
  // reply_to and pinned are set conditionally by the extractor and would raise
  // on the posts that lack them.
  assert.ok(!PRINT_FORMAT.includes('{reply_to}'));
  assert.ok(!PRINT_FORMAT.includes('{pinned}'));
  assert.ok(PRINT_FORMAT.includes('{reply_id}'));
});

test('the listing pass downloads nothing and asks for rows', () => {
  const args = listArgs({ url: 'https://x.com/someone', cookies: '/tmp/c.txt' });
  assert.ok(args.includes('--print'));
  assert.ok(!args.includes('--Print'));
  assert.ok(args.includes(PRINT_FORMAT));
  assert.equal(args.at(-1), 'https://x.com/someone');
});

test('every invocation ignores the user own gallery-dl config', () => {
  assert.ok(listArgs({ url: 'u' }).includes('--config-ignore'));
  assert.ok(fetchArgs({ url: 'u', directory: '/d' }).includes('--config-ignore'));
});

test('policy is imposed as JSON values gallery-dl can parse', () => {
  const args = listArgs({ url: 'u' });
  assert.ok(args.includes('extractor.twitter.retweets=false'));
  assert.ok(args.includes('extractor.twitter.replies="self"'));
  assert.ok(args.includes('extractor.twitter.pinned=true'));
  assert.ok(args.includes('extractor.twitter.videos=true'));
});

test('both invocations carry the same throttling', () => {
  const list = listArgs({ url: 'u' });
  const fetch = fetchArgs({ url: 'u', directory: '/d' });
  for (const flag of ['--sleep-request', '--sleep', '--retries']) {
    assert.ok(list.includes(flag), `listArgs missing ${flag}`);
    assert.ok(fetch.includes(flag), `fetchArgs missing ${flag}`);
  }
});

test('a fetch names the exact directory and a numbered filename', () => {
  // The root can carry spaces even though the post folder no longer does, so
  // the path must still reach gallery-dl as a single argument.
  const args = fetchArgs({ url: 'u', directory: '/d/my posts/2024-01-01_1' });
  assert.ok(args.includes('--directory'));
  assert.ok(args.includes('/d/my posts/2024-01-01_1'));
  assert.ok(args.includes('{num}.{extension}'));
});

test('a run always reads its session from a file, never the live browser', () => {
  // run.mjs resolves the session to a cookies.txt before either invocation is
  // built, so no download-time invocation may reach for the browser profile.
  assert.deepEqual(cookieArgs({ cookies: '/c.txt' }), ['--cookies', '/c.txt']);
  assert.deepEqual(cookieArgs({}), []);
  for (const args of [listArgs({ url: 'u', cookies: '/c.txt' }), fetchArgs({ url: 'u', directory: '/d', cookies: '/c.txt' })]) {
    assert.ok(!args.includes('--cookies-from-browser'));
  }
});

const REPLY_ID = 14;

const row = (content = '"hello"', { type = 'photo' } = {}) =>
  [
    ROW_MARKER, '1767', '1', '2', 'jpg',
    'F1a2B3c4D5eFgHi', type, 'https://pbs.twimg.com/media/F1a2B3c4D5eFgHi.jpg',
    '2024-03-11 07:22:19', '55', 'someone', '"Some One"',
    'https://pbs.twimg.com/profile_images/9/a.jpg', 'https://pbs.twimg.com/profile_banners/55/1699',
    '0', content,
  ].join('\t');

test('parseRow reads a printed row', () => {
  const parsed = parseRow(row());
  assert.equal(parsed.tweetId, '1767');
  assert.equal(parsed.num, 1);
  assert.equal(parsed.count, 2);
  assert.equal(parsed.ext, 'jpg');
  assert.equal(parsed.url, 'https://pbs.twimg.com/media/F1a2B3c4D5eFgHi.jpg');
  assert.equal(parsed.user.name, 'someone');
  assert.equal(parsed.user.nick, 'Some One');
  assert.equal(parsed.content, 'hello');
});

test('an image carries the pbs media token as its identity', () => {
  assert.equal(parseRow(row()).mediaId, 'F1a2B3c4D5eFgHi');
});

test('a video carries no media identity', () => {
  // Its basename is the variant gallery-dl picked, which a re-encode changes.
  // Recording it would look like an id and behave like a guess.
  assert.equal(parseRow(row('"hi"', { type: 'video' })).mediaId, '');
});

test('the profile assets ride on every row, costing no extra request', () => {
  const parsed = parseRow(row());
  assert.equal(parsed.user.avatar, 'https://pbs.twimg.com/profile_images/9/a.jpg');
  assert.equal(parsed.user.banner, 'https://pbs.twimg.com/profile_banners/55/1699');
});

test('the optional fields are asked for with a fallback, never bare', () => {
  // gallery-dl's formatter renders a key it cannot find as the literal string
  // "None", which would land in post.json as a media URL.
  for (const field of ['filename', 'type', 'url', 'user[profile_image]', 'user[profile_banner]']) {
    assert.ok(PRINT_FORMAT.includes(`{${field}|''}`), `${field} needs an explicit fallback`);
  }
});

test('parseRow restores newlines and tabs from an encoded body', () => {
  const parsed = parseRow(row(JSON.stringify('one\ntwo\tthree')));
  assert.equal(parsed.content, 'one\ntwo\tthree');
});

test('parseRow treats reply_id 0 as "not a reply"', () => {
  assert.equal(parseRow(row()).replyId, '');
});

test('parseRow keeps a real reply id', () => {
  const parts = row().split('\t');
  parts[REPLY_ID] = '4242';
  assert.equal(parseRow(parts.join('\t')).replyId, '4242');
});

test('parseRow ignores gallery-dl chatter rather than inventing a post', () => {
  assert.equal(parseRow('[twitter][warning] something happened'), null);
  assert.equal(parseRow(''), null);
  assert.equal(parseRow('xdl\ttoo\tfew'), null);
});

test('parseRow rejects a row whose id is not an id', () => {
  const parts = row().split('\t');
  parts[1] = 'nonsense';
  assert.equal(parseRow(parts.join('\t')), null);
});

test('classifyFailure never lets an unreadable account look like zero posts', () => {
  assert.equal(classifyFailure('HttpError: 401 Unauthorized'), 'unauthorized');
  assert.equal(classifyFailure('Account is suspended'), 'suspended');
  assert.equal(classifyFailure('This account is protected'), 'protected');
  assert.equal(classifyFailure('User not found'), 'missing');
});

test('classifyFailure spots a rate limit', () => {
  assert.equal(classifyFailure('HttpError: 429 Too Many Requests'), 'rate-limited');
});

test('classifyFailure returns null for output it does not recognise', () => {
  assert.equal(classifyFailure('everything is fine'), null);
  assert.equal(classifyFailure(''), null);
});
