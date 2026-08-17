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

test('the remedy for a missing tool names how to install it', () => {
  const lines = missingTool('gallery-dl', {
    brew: 'brew install gallery-dl',
    otherwise: 'pipx install gallery-dl',
    darwin: true,
    hasBrew: true,
  });
  assert.match(lines, /gallery-dl is not installed/);
  assert.match(lines, /brew install gallery-dl/);
});

test('off macOS the remedy is not a brew command', () => {
  // A brew command on a machine without brew is not a remedy, it is a second
  // thing to go and install.
  const lines = missingTool('gallery-dl', {
    brew: 'brew install gallery-dl',
    otherwise: 'pipx install gallery-dl',
    darwin: false,
    hasBrew: false,
  });
  assert.doesNotMatch(lines, /brew install/);
  assert.match(lines, /pipx install gallery-dl/);
});

test('a tool with only one way to install it says that one way everywhere', () => {
  const lines = missingTool('node', { otherwise: 'https://nodejs.org', darwin: true, hasBrew: true });
  assert.match(lines, /nodejs\.org/);
});
