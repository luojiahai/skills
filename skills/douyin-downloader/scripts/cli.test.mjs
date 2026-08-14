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
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { optString, parseArgs, readJson, readText } from './cli.mjs';

test('parseArgs pairs flags with their values', () => {
  assert.deepEqual(parseArgs(['--folder', '/data/abc', '--name', '小明']), {
    folder: '/data/abc',
    name: '小明',
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
  // eating --downloads, the root silently becomes the default and the run
  // works on the wrong archive.
  assert.deepEqual(parseArgs(['--require-match', '--downloads', '/data']), {
    require_match: true,
    downloads: '/data',
  });
});

test('a trailing flag with no value is true, not undefined', () => {
  assert.deepEqual(parseArgs(['--folder', '/data', '--require-match']), {
    folder: '/data',
    require_match: true,
  });
});

test('parseArgs keeps an empty-string value as a value', () => {
  // download.sh passes optional flags through unconditionally — `--name ""`
  // rather than omitting them — so empty must parse as present-but-empty.
  assert.deepEqual(parseArgs(['--name', '', '--folder', '/data']), {
    name: '',
    folder: '/data',
  });
});

test('optString treats a valueless flag as absent', () => {
  const opts = parseArgs(['--require-match', '--name', 'abc']);
  assert.equal(optString(opts, 'require_match'), '');
  assert.equal(optString(opts, 'name'), 'abc');
  assert.equal(optString(opts, 'missing'), '');
});

test('readJson returns the parsed object, and null for anything unreadable', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'douyin-cli-'));
  const file = path.join(dir, 'cursor.json');
  writeFileSync(file, '{"douyin_id":"abc123"}\n');

  assert.deepEqual(await readJson(file), { douyin_id: 'abc123' });
  assert.equal(await readJson(path.join(dir, 'missing.json')), null);

  writeFileSync(file, 'not json');
  assert.equal(await readJson(file), null);
});

test('readText returns the file, and empty for a missing one', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'douyin-cli-'));
  const file = path.join(dir, '.archive.txt');
  writeFileSync(file, 'douyin 7111\n');

  assert.equal(await readText(file), 'douyin 7111\n');
  assert.equal(await readText(path.join(dir, 'missing.txt')), '');
});
