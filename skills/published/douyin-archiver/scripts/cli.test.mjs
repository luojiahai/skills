/**
 * Tests for cli.mjs — run with:
 *   node --test scripts/cli.test.mjs
 *
 * The parser's one hard-won rule — a valueless flag must not swallow the flag
 * after it — used to live in two drifting copies, and this is what keeps the
 * surviving copy honest.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { optString, parseArgs, readJson, readText } from './cli.mjs';

const run = promisify(execFile);
const ARCHIVE_SH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'archive.sh');

test('--downloads is refused by name rather than as a generic unknown flag', async () => {
  // The old flag would otherwise fall through to the `-*` catch-all and be
  // reported as an unknown option — true, but it sends the user to --help to
  // work out what happened. The whole risk of this rename is a stale command
  // still in someone's shell history, so the refusal names its replacement.
  //
  // Argument parsing runs before every preflight, so this needs neither yt-dlp
  // nor a session to be installed.
  const failed = await run(ARCHIVE_SH, [
    'https://www.douyin.com/user/MS4wLjABAAAA',
    '--downloads',
    '/data',
  ]).then(
    () => null,
    (error) => error,
  );

  assert.ok(failed, 'expected a non-zero exit');
  assert.equal(failed.code, 2);
  assert.match(failed.stderr, /--downloads was renamed to --archives/);
});

test('a /video/ URL is refused rather than archived as the account that posted it', async () => {
  // What keeps a request for one post from being answered with the whole
  // account. Like the refusal above it exits before the preflight, so it needs
  // neither yt-dlp nor a session — and --yes is passed because the
  // pre-authorised path must refuse it too.
  const root = mkdtempSync(path.join(os.tmpdir(), 'douyin-archive-'));
  const failed = await run(ARCHIVE_SH, [
    'https://www.douyin.com/video/7111111111', '--yes', '--archives', root,
  ]).then(
    () => null,
    (error) => error,
  );

  assert.ok(failed, 'expected a non-zero exit');
  assert.equal(failed.code, 2);
  assert.match(failed.stderr, /not a Douyin profile URL/);
  // An empty root means no folder was resolved, no schema stamped, nothing
  // fetched.
  assert.deepEqual(readdirSync(root), []);
});

test('parseArgs pairs flags with their values', () => {
  assert.deepEqual(parseArgs(['--folder', '/data/abc', '--alias', '小明']), {
    folder: '/data/abc',
    alias: '小明',
  });
});

test('parseArgs turns dashes into underscores', () => {
  assert.deepEqual(parseArgs(['--sec-uid', 'MS4w', '--require-match']), {
    sec_uid: 'MS4w',
    require_match: true,
  });
});

test('a valueless flag does not swallow the flag after it', () => {
  // The regression the shared copy exists to prevent: with --require-match
  // eating --archives, the root silently becomes the default and the run
  // works on the wrong archive.
  assert.deepEqual(parseArgs(['--require-match', '--archives', '/data']), {
    require_match: true,
    archives: '/data',
  });
});

test('a trailing flag with no value is true, not undefined', () => {
  assert.deepEqual(parseArgs(['--folder', '/data', '--require-match']), {
    folder: '/data',
    require_match: true,
  });
});

test('parseArgs keeps an empty-string value as a value', () => {
  // archive.sh passes optional flags through unconditionally — `--alias ""`
  // rather than omitting them — so empty must parse as present-but-empty.
  assert.deepEqual(parseArgs(['--alias', '', '--folder', '/data']), {
    alias: '',
    folder: '/data',
  });
});

test('optString treats a valueless flag as absent', () => {
  const opts = parseArgs(['--require-match', '--alias', 'abc']);
  assert.equal(optString(opts, 'require_match'), '');
  assert.equal(optString(opts, 'alias'), 'abc');
  assert.equal(optString(opts, 'missing'), '');
});

test('readJson returns the parsed object, and null for anything unreadable', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'douyin-cli-'));
  const file = path.join(dir, 'account.json');
  writeFileSync(file, '{"douyin_id":"abc123"}\n');

  assert.deepEqual(await readJson(file), { douyin_id: 'abc123' });
  assert.equal(await readJson(path.join(dir, 'missing.json')), null);

  writeFileSync(file, 'not json');
  assert.equal(await readJson(file), null);
});

test('readText returns the file, and empty for a missing one', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'douyin-cli-'));
  const file = path.join(dir, 'some-file.txt');
  writeFileSync(file, 'douyin 7111\n');

  assert.equal(await readText(file), 'douyin 7111\n');
  assert.equal(await readText(path.join(dir, 'missing.txt')), '');
});
