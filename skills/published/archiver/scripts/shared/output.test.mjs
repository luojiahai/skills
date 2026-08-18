/**
 * The two helpers whose contract lives outside the document: `quote`, which the
 * agent is told to run, and `progress`, whose whole rule is about who is
 * watching.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

import { progress, quote } from './output.mjs';

test('a quoted path survives a shell verbatim, spaces and apostrophes and all', () => {
  // The remedy commands carry paths the user chose, and the agent runs them
  // through a shell. Anything that changes on the way through is a different
  // command from the one this run means.
  for (const value of [
    "/Users/o'brien/My Skills/archiver/setup.sh",
    '/tmp/a b/档案',
    'plain-value',
    '/tmp/$(echo pwned)/x',
    '/tmp/a"b/c',
  ]) {
    const echoed = execFileSync('/bin/sh', ['-c', `printf %s ${quote(value)}`], { encoding: 'utf8' });
    assert.equal(echoed, value);
  }
});

test('progress is suppressed off a terminal and written on one', () => {
  const written = [];
  const write = process.stderr.write.bind(process.stderr);
  const isTTY = process.stderr.isTTY;
  process.stderr.write = (chunk) => (written.push(String(chunk)), true);

  try {
    process.stderr.isTTY = false;
    progress('12/40', { progress: true });
    assert.deepEqual(written, [], 'in-place progress has nobody to show off a terminal');

    progress('a plain line');
    assert.deepEqual(written, ['a plain line\n'], 'a plain line is not in-place and always lands');

    written.length = 0;
    process.stderr.isTTY = true;
    progress('12/40', { progress: true });
    assert.deepEqual(written, ['\r12/40']);
  } finally {
    process.stderr.write = write;
    process.stderr.isTTY = isTTY;
  }
});
