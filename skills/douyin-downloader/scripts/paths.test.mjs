/**
 * Tests for paths.mjs — run with: node --test scripts/plan.test.mjs scripts/paths.test.mjs
 *
 * Only normalizeRoot is covered: the rest of paths.mjs answers questions about
 * this machine (git roots, install layout, where Playwright landed) that a test
 * would have to fake wholesale to ask.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, symlinkSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { normalizeRoot } from './paths.mjs';

test('normalizeRoot expands a leading tilde', () => {
  assert.equal(normalizeRoot('~/data', '/somewhere'), path.join(os.homedir(), 'data'));
  assert.equal(normalizeRoot('~', '/somewhere'), realpathSync(os.homedir()));
});

test('normalizeRoot leaves a tilde that is not a home reference alone', () => {
  assert.equal(normalizeRoot('~weird/data', '/somewhere'), '/somewhere/~weird/data');
});

test('normalizeRoot resolves a relative path against the given directory', () => {
  assert.equal(normalizeRoot('./downloads', '/proj'), '/proj/downloads');
  assert.equal(normalizeRoot('../downloads', '/proj/src'), '/proj/downloads');
});

test('normalizeRoot keeps an absolute path absolute', () => {
  assert.equal(normalizeRoot('/data/dy', '/proj'), '/data/dy');
});

test('normalizeRoot resolves symlinks in the part that exists', () => {
  // The default root is read off the real filesystem, so an explicit --downloads
  // naming the same place through a symlink (/tmp on macOS) has to normalise to
  // the same string — otherwise a plan made one way is refused the other way.
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'douyin-paths-'));
  const real = path.join(tmp, 'real');
  const link = path.join(tmp, 'link');
  mkdirSync(real);
  symlinkSync(real, link);

  assert.equal(normalizeRoot(link, '/proj'), realpathSync(real));
  // …including when the root itself has not been created yet.
  assert.equal(
    normalizeRoot(path.join(link, 'downloads'), '/proj'),
    path.join(realpathSync(real), 'downloads'),
  );
});

test('normalizeRoot survives a path whose parents do not exist', () => {
  assert.equal(normalizeRoot('/nope/not/here', '/proj'), '/nope/not/here');
});
