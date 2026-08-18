import assert from 'node:assert/strict';
import test from 'node:test';

import { COMMON_BOOLEAN_FLAGS, COMMON_FLAGS, optString, parseCommandLine } from './cli.mjs';

test('a URL is positional and flags are flags', () => {
  const { opts, positional } = parseCommandLine(['https://x.com/someone', '--plan']);
  assert.deepEqual(positional, ['https://x.com/someone']);
  assert.equal(opts.plan, true);
});

test('a boolean flag does not swallow the argument after it', () => {
  const { opts } = parseCommandLine(['--go', '--archives', '/data']);
  assert.equal(opts.go, true);
  assert.equal(opts.archives, '/data');
});

test("a platform's own flags are declared, and unknown without that", () => {
  // What counts as a usage error is a question only the platform being run can
  // answer: --browser is X's and --profile is Douyin's, and neither should be
  // silently accepted by the other.
  const declared = {
    booleans: new Set([...COMMON_BOOLEAN_FLAGS, 'full']),
    known: new Set([...COMMON_FLAGS, 'full', 'browser']),
  };
  const mine = parseCommandLine(['--full', '--browser', 'chrome'], declared);
  assert.equal(mine.opts.full, true);
  assert.equal(mine.opts.browser, 'chrome');
  assert.deepEqual(mine.unknown, []);

  assert.deepEqual(parseCommandLine(['--browser', 'chrome']).unknown, ['--browser']);
});

test('a value flag followed by another flag neither eats nor loses it', () => {
  // --alias has no value here, but --plan must still be parsed as a flag in its
  // own right rather than disappearing into --alias.
  const { opts, missing } = parseCommandLine(['--alias', '--plan']);
  assert.deepEqual(missing, ['--alias']);
  assert.equal(opts.alias, undefined);
  assert.equal(opts.plan, true);
});

test('a value beginning with a dash is a usage error, never a silently dropped one', () => {
  // The failure this stops is a *successful* run that did not do what was asked:
  // reading `--alias -foo` as "no alias" archives the account under its id and
  // reports that as fine.
  for (const argv of [['--alias', '-foo'], ['--archives', '--plan'], ['--alias']]) {
    const { missing } = parseCommandLine(argv);
    assert.equal(missing.length, 1, argv.join(' '));
  }
});

test('an empty value is a value, because that is how archive.sh says nothing', () => {
  const { opts, missing } = parseCommandLine(['--alias', '', '--plan']);
  assert.deepEqual(missing, []);
  assert.equal(opts.alias, '');
  assert.equal(opts.plan, true);
});

test('a lone dash is a value, not a flag', () => {
  const { opts, missing } = parseCommandLine(['--archives', '-']);
  assert.deepEqual(missing, []);
  assert.equal(opts.archives, '-');
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

test('the flags every platform shares are accepted without being declared', () => {
  // Anything admitted here but absent from USAGE is a surface nobody can find
  // and nobody maintains.
  for (const flag of [
    '--archives', '--alias', '--unalias', '--plan', '--go', '--yes',
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
  const { opts, positional } = parseCommandLine(['--archives', '/data', 'https://x.com/someone', '--go']);
  assert.equal(opts.archives, '/data');
  assert.equal(opts.go, true);
  assert.deepEqual(positional, ['https://x.com/someone']);
});

test('optString treats a valueless flag as absent', () => {
  assert.equal(optString({ alias: true }, 'alias'), '');
  assert.equal(optString({ alias: 'jia' }, 'alias'), 'jia');
  assert.equal(optString({}, 'alias'), '');
});
