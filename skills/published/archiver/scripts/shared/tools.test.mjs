import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';

import { missingTool, onPath } from './tools.mjs';

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
  const refusal = missingTool('gallery-dl', {
    brew: 'brew install gallery-dl',
    otherwise: 'pipx install gallery-dl',
    darwin: true,
    hasBrew: true,
  });

  assert.equal(refusal.code, 'tool-missing');
  assert.equal(refusal.details.tool, 'gallery-dl');
  assert.equal(refusal.details.install, 'brew install gallery-dl');
  assert.equal(refusal.remedy.command, 'brew install gallery-dl');
  // Nothing here installs anything for anyone.
  assert.equal(refusal.remedy.run_by, 'user');
});

test('off macOS the install command is not a brew one', () => {
  // A brew command on a machine without brew is not a remedy, it is a second
  // thing to go and install.
  const refusal = missingTool('gallery-dl', {
    brew: 'brew install gallery-dl',
    otherwise: 'pipx install gallery-dl',
    darwin: false,
    hasBrew: false,
  });

  assert.equal(refusal.details.install, 'pipx install gallery-dl');
});

test('a tool with only one way to install it says that one way everywhere', () => {
  const refusal = missingTool('node', { otherwise: 'brew install node', darwin: true, hasBrew: true });
  assert.equal(refusal.details.install, 'brew install node');
});

test('where the docs are goes in the remedy, not in the command', () => {
  // A remedy's command has to be one somebody can actually run.
  const refusal = missingTool('yt-dlp', {
    otherwise: 'pipx install yt-dlp',
    docs: 'https://github.com/yt-dlp/yt-dlp#installation',
    darwin: false,
  });

  assert.equal(refusal.remedy.command, 'pipx install yt-dlp');
  assert.match(refusal.remedy.message, /github\.com\/yt-dlp/);
});
