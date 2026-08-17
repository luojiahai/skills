/**
 * Tests for run.mjs — run with:
 *   node --test scripts/run.test.mjs
 *
 * main() is exercised in-process rather than through archive.sh, which is how
 * the dispatcher reaches it. Everything here returns before the first side
 * effect.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { main } from './run.mjs';

const run = promisify(execFile);
const ARCHIVE_SH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'archive.sh');

/** main() reports through console.error, so a refusal is read by capturing it. */
async function runMain(argv) {
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  try {
    return { code: await main(argv), stderr: errors.join('\n') };
  } finally {
    console.error = original;
  }
}

test('--downloads is refused by name rather than as a generic unknown flag', async () => {
  // Dropping the flag from KNOWN_FLAGS alone would report it as an unknown
  // option — true, but it sends the user to --help to work out what happened.
  // The whole risk of this rename is a stale command still in someone's shell
  // history, so the refusal names its replacement.
  const { code, stderr } = await runMain(['https://x.com/someone', '--downloads', '/data']);

  assert.equal(code, 2);
  assert.match(stderr, /--downloads was renamed to --archives/);
});

test('archive.sh refuses --downloads before any platform preflights its tools', async () => {
  // A platform refuses it too, but only past its own tool preflight — so on a
  // machine without gallery-dl a stale command would report the missing tool
  // instead of the rename that actually broke it. Exiting before dispatch is
  // also what makes this test independent of what is installed here.
  const failed = await run(ARCHIVE_SH, ['https://x.com/someone', '--downloads', '/data']).then(
    () => null,
    (error) => error,
  );

  assert.ok(failed, 'expected a non-zero exit');
  assert.equal(failed.code, 2);
  assert.match(failed.stderr, /--downloads was renamed to --archives/);
});

test('a post URL is refused before anything is fetched', async () => {
  // A /status/ URL carries the handle in exactly the position a profile URL
  // does, so what this prevents is a request for one post being answered by
  // archiving the entire account. --yes is passed because the pre-authorised
  // path must refuse it too.
  const root = await mkdtemp(path.join(os.tmpdir(), 'x-archive-'));
  const { code, stderr } = await runMain([
    'https://x.com/someone/status/1767', '--yes', '--archives', root,
  ]);

  assert.equal(code, 2);
  assert.match(stderr, /out of scope/);
  assert.match(stderr, /takes an account URL/);
  // An empty root means no folder was resolved, no schema stamped, nothing
  // fetched.
  assert.deepEqual(await readdir(root), []);
});

test('an actually unknown flag still reports as unknown', async () => {
  // The targeted refusal above must not swallow the general case it sits in
  // front of.
  const { code, stderr } = await runMain(['https://x.com/someone', '--nonsense']);

  assert.equal(code, 2);
  assert.match(stderr, /unknown option '--nonsense'/);
});
