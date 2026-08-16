/**
 * Tests for run.mjs — run with:
 *   node --test scripts/run.test.mjs
 *
 * main() is exercised in-process rather than through archive.sh, which
 * preflights node and gallery-dl before handing over: a test that went through
 * the shell would pass or fail on whether gallery-dl happens to be installed.
 * Everything here returns before the first side effect.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { main } from './run.mjs';

const run = promisify(execFile);
const ARCHIVE_SH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'archive.sh');

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

test('archive.sh refuses --downloads before it preflights gallery-dl', async () => {
  // run.mjs is only reached past the preflight, so the refusal has to exist in
  // the shell too or a stale command on a machine without gallery-dl reports
  // the missing tool instead of the rename that actually broke it. Exiting
  // before the preflight is also what makes this test independent of whether
  // gallery-dl happens to be installed here.
  const failed = await run(ARCHIVE_SH, ['https://x.com/someone', '--downloads', '/data']).then(
    () => null,
    (error) => error,
  );

  assert.ok(failed, 'expected a non-zero exit');
  assert.equal(failed.code, 2);
  assert.match(failed.stderr, /--downloads was renamed to --archives/);
});

test('an actually unknown flag still reports as unknown', async () => {
  // The targeted refusal above must not swallow the general case it sits in
  // front of.
  const { code, stderr } = await runMain(['https://x.com/someone', '--nonsense']);

  assert.equal(code, 2);
  assert.match(stderr, /unknown option '--nonsense'/);
});
