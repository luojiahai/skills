import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { hatchToolMissing, missingTool, onPath } from './tools.mjs';

/** A PATH made of promises rather than a filesystem. */
function fakePath(executables, dirs = ['/usr/bin', '/opt/homebrew/bin']) {
  return {
    PATH: dirs.join(path.delimiter),
    canExecute: async (candidate) => executables.includes(candidate),
  };
}

test('a binary on the PATH is found', async () => {
  const env = fakePath(['/opt/homebrew/bin/gallery-dl']);
  assert.equal(await onPath('gallery-dl', env), true);
});

test('a binary that is nowhere on the PATH is not found', async () => {
  assert.equal(await onPath('gallery-dl', fakePath([])), false);
});

test('an empty PATH finds nothing rather than throwing', async () => {
  assert.equal(await onPath('gallery-dl', { PATH: '', canExecute: async () => true }), false);
});

test('a name with a slash is a path, not something to search for', async () => {
  // Otherwise ./gallery-dl would be searched for inside every PATH directory,
  // and found in none of them.
  const env = { PATH: '/usr/bin', canExecute: async (c) => c === '/tmp/gallery-dl' };
  assert.equal(await onPath('/tmp/gallery-dl', env), true);
  assert.equal(await onPath('/tmp/nope', env), false);
});

test('a missing tool is refused by code, with the install command as its remedy', () => {
  const refusal = missingTool('gallery-dl', { install: 'uv tool install gallery-dl' });

  assert.equal(refusal.code, 'tool-missing');
  assert.equal(refusal.details.tool, 'gallery-dl');
  assert.equal(refusal.details.install, 'uv tool install gallery-dl');
  assert.equal(refusal.remedy.command, 'uv tool install gallery-dl');
  // Nothing here installs anything for anyone.
  assert.equal(refusal.remedy.run_by, 'user');
});

test('the same command is suggested on every machine', () => {
  // One suggestion, not one per package manager. A `brew install` handed to
  // somebody without brew is not a remedy, it is a second thing to go and
  // install first — and this skill names no package manager it does not ship.
  assert.equal(missingTool('yt-dlp', { install: 'uv tool install yt-dlp' }).details.install,
    'uv tool install yt-dlp');
  assert.equal(missingTool('yt-dlp', {}).details.install, null);
});

test('off the escape hatch there is nothing to be missing', async () => {
  // The tool comes out of a box, and a box that could not be built has refused
  // with a code of its own. Asking PATH about it would answer a question nobody
  // is in a position to act on.
  assert.equal(await hatchToolMissing('/box/yt-dlp', {}, async () => false), null);
});

test('on the escape hatch a tool that is not on PATH is refused', async () => {
  process.env.ARCHIVER_SYSTEM_TOOLS = '1';
  try {
    assert.equal(await hatchToolMissing('yt-dlp', {}, async () => true), null);

    const refusal = await hatchToolMissing(
      'yt-dlp',
      { install: 'uv tool install yt-dlp' },
      async () => false,
    );
    assert.equal(refusal.code, 'tool-missing');
    assert.equal(refusal.details.tool, 'yt-dlp');
  } finally {
    delete process.env.ARCHIVER_SYSTEM_TOOLS;
  }
});

test('where the docs are goes in the remedy, not in the command', () => {
  // A remedy's command has to be one somebody can actually run.
  const refusal = missingTool('yt-dlp', {
    install: 'uv tool install yt-dlp',
    docs: 'https://github.com/yt-dlp/yt-dlp#installation',
  });

  assert.equal(refusal.remedy.command, 'uv tool install yt-dlp');
  assert.match(refusal.remedy.message, /github\.com\/yt-dlp/);
});

test('a directory named like a tool on PATH is not an executable', async () => {
  // A directory carries the execute bit, so `access(X_OK)` alone says yes to
  // one. The preflight then passes and the failure resurfaces later as an
  // opaque spawn error, in a run that has already read a session.
  const dir = await mkdtemp(path.join(os.tmpdir(), 'archiver-tools-'));
  await mkdir(path.join(dir, 'yt-dlp'));

  assert.equal(await onPath('yt-dlp', { PATH: dir }), false);

  // And a real one still satisfies it.
  const bin = path.join(dir, 'gallery-dl');
  await writeFile(bin, '#!/bin/sh\nexit 0\n');
  await chmod(bin, 0o755);
  assert.equal(await onPath('gallery-dl', { PATH: dir }), true);
});
