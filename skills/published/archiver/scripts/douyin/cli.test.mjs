import assert from 'node:assert/strict';
import test from 'node:test';

import { optString, parseCommandLine } from './cli.mjs';

test('a URL is positional and flags are flags', () => {
  const { opts, positional } = parseCommandLine(['https://www.douyin.com/user/MS4w', '--plan']);
  assert.deepEqual(positional, ['https://www.douyin.com/user/MS4w']);
  assert.equal(opts.plan, true);
});

test('a boolean flag does not swallow the argument after it', () => {
  const { opts } = parseCommandLine(['--login', '--archives', '/data']);
  assert.equal(opts.login, true);
  assert.equal(opts.archives, '/data');
});

test('a value flag followed by another flag neither eats nor loses it', () => {
  // --alias has no value here, but --plan must still be parsed as a flag in its
  // own right rather than disappearing into --alias.
  const { opts } = parseCommandLine(['--alias', '--plan']);
  assert.equal(opts.alias, true);
  assert.equal(opts.plan, true);
});

test('--unalias is a flag in its own right, not an alias with a value', () => {
  // It has to be: an empty --alias is how archive.sh passes a flag it has no
  // value for, so "" cannot also mean "take the alias off".
  const { opts } = parseCommandLine(['--unalias', '--go']);
  assert.equal(opts.unalias, true);
  assert.equal(opts.go, true);
});

test('dashes in a flag name become underscores', () => {
  const { opts } = parseCommandLine(['--archives', '~/data']);
  assert.equal(opts.archives, '~/data');
});

test('short forms are accepted', () => {
  assert.equal(parseCommandLine(['-y']).opts.y, true);
  assert.equal(parseCommandLine(['-h']).opts.h, true);
});

test('an unknown flag is reported rather than guessed at', () => {
  const { unknown } = parseCommandLine(['https://x.com/a', '--retweets']);
  assert.deepEqual(unknown, ['--retweets']);
});

test('the accepted flags are exactly the documented ones', () => {
  // Anything admitted here but absent from USAGE is a surface nobody can find
  // and nobody maintains.
  for (const flag of [
    '--archives', '--alias', '--unalias', '--profile', '--login', '--plan', '--go', '--yes',
  ]) {
    assert.deepEqual(parseCommandLine([flag, 'v']).unknown, [], flag);
  }
  for (const flag of ['--bin', '--abort', '--url', '--name']) {
    assert.deepEqual(parseCommandLine([flag, 'v']).unknown, [flag], flag);
  }
});

test('everything after -- is positional, even if it looks like a flag', () => {
  const { positional } = parseCommandLine(['--', '--plan']);
  assert.deepEqual(positional, ['--plan']);
});

test('a URL is never mistaken for a flag value', () => {
  const { opts, positional } = parseCommandLine(['--archives', '/data', 'https://www.douyin.com/user/MS4w', '--go']);
  assert.equal(opts.archives, '/data');
  assert.equal(opts.go, true);
  assert.deepEqual(positional, ['https://www.douyin.com/user/MS4w']);
});

test('optString treats a valueless flag as absent', () => {
  assert.equal(optString({ alias: true }, 'alias'), '');
  assert.equal(optString({ alias: 'jia' }, 'alias'), 'jia');
  assert.equal(optString({}, 'alias'), '');
});
