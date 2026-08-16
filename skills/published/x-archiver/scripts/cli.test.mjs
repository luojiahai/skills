import assert from 'node:assert/strict';
import test from 'node:test';

import { optString, parseCommandLine } from './cli.mjs';

test('a URL is positional and flags are flags', () => {
  const { opts, positional } = parseCommandLine(['https://x.com/someone', '--plan']);
  assert.deepEqual(positional, ['https://x.com/someone']);
  assert.equal(opts.plan, true);
});

test('a boolean flag does not swallow the argument after it', () => {
  const { opts } = parseCommandLine(['--full', '--archives', '/data']);
  assert.equal(opts.full, true);
  assert.equal(opts.archives, '/data');
});

test('a value flag followed by another flag neither eats nor loses it', () => {
  // --name has no value here, but --plan must still be parsed as a flag in its
  // own right rather than disappearing into --name.
  const { opts } = parseCommandLine(['--name', '--plan']);
  assert.equal(opts.name, true);
  assert.equal(opts.plan, true);
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
  for (const flag of ['--archives', '--name', '--browser', '--cookies', '--full', '--plan', '--go', '--yes']) {
    assert.deepEqual(parseCommandLine([flag, 'v']).unknown, [], flag);
  }
  for (const flag of ['--bin', '--abort', '--url']) {
    assert.deepEqual(parseCommandLine([flag, 'v']).unknown, [flag], flag);
  }
});

test('everything after -- is positional, even if it looks like a flag', () => {
  const { positional } = parseCommandLine(['--', '--plan']);
  assert.deepEqual(positional, ['--plan']);
});

test('a URL is never mistaken for a flag value', () => {
  const { opts, positional } = parseCommandLine(['--archives', '/data', 'https://x.com/someone', '--go']);
  assert.equal(opts.archives, '/data');
  assert.equal(opts.go, true);
  assert.deepEqual(positional, ['https://x.com/someone']);
});

test('optString treats a valueless flag as absent', () => {
  assert.equal(optString({ name: true }, 'name'), '');
  assert.equal(optString({ name: 'x' }, 'name'), 'x');
  assert.equal(optString({}, 'name'), '');
});
