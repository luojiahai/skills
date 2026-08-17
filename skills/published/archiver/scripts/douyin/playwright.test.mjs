import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { discardDerivedState } from './playwright.mjs';

test('anything re-derivable is cleared out of the state directory', async () => {
  // The state directory is for what must survive the skill being replaced. A
  // dependency tree is re-derivable and belongs in the cache, so a copy here is
  // a hundred megabytes nothing reads.
  const dir = await mkdtemp(path.join(os.tmpdir(), 'douyin-state-'));
  await mkdir(path.join(dir, 'node_modules', 'playwright'), { recursive: true });
  await mkdir(path.join(dir, 'profile'), { recursive: true });
  for (const name of ['package.json', 'package-lock.json', 'chromium-install.log', 'cookies.txt']) {
    await writeFile(path.join(dir, name), '{}');
  }

  await discardDerivedState(dir);

  // The session cost a human a QR scan and a browser sign-in; it is not ours to
  // throw away over a dependency tree.
  assert.deepEqual((await readdir(dir)).sort(), ['cookies.txt', 'profile']);
});

test('clearing it out is safe on a state directory that is not there', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'douyin-state-'));
  await discardDerivedState(path.join(dir, 'never'));
});
