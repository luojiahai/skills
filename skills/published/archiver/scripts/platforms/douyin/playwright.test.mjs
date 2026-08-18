import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { boxKey } from '../../shared/paths.mjs';
import { discardDerivedState, loadPlaywright } from './playwright.mjs';

/**
 * A cache root the loader will look in, and the browser box inside it.
 *
 * Addressed the way the loader addresses it — through the environment, then the
 * key that names the box — so nothing here writes down where a box lives. The
 * system-tools hatch is cleared for the same reason: it takes a different branch
 * entirely, and a machine that happens to have it set must not quietly test one.
 */
async function aBrowserBox(t, build) {
  const cache = await mkdtemp(path.join(os.tmpdir(), 'archiver-browser-'));
  const box = path.join(cache, 'archiver', `browser-${boxKey('browser')}`);
  if (build) await build(box);

  const restore = {
    XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
    ARCHIVER_SYSTEM_TOOLS: process.env.ARCHIVER_SYSTEM_TOOLS,
    PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH,
  };
  t.after(() => {
    for (const [name, value] of Object.entries(restore)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  process.env.XDG_CACHE_HOME = cache;
  delete process.env.ARCHIVER_SYSTEM_TOOLS;
  delete process.env.PLAYWRIGHT_BROWSERS_PATH;
  return box;
}

/** Something at the path the loader imports, without a browser behind it. */
async function playwrightIn(box, body) {
  const dir = path.join(box, 'node_modules', 'playwright');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'index.js'), body);
}

/**
 * Built by a call rather than written as a literal, so that nothing can read a
 * named export off the file. What comes back then carries `chromium` on
 * `.default` alone, which is the shape the loader has to cope with.
 */
const exporting = (shape) => `const build = () => (${shape});\nmodule.exports = build();\n`;

test('a browser box that was never built refuses, and says where it looked', async (t) => {
  const box = await aBrowserBox(t);

  const failed = await loadPlaywright().then(() => null, (error) => error);

  assert.ok(failed, 'there is no browser to drive, and that is not a success');
  assert.equal(failed.code, 'playwright-missing');
  assert.equal(failed.details.expected_at, path.join(box, 'node_modules', 'playwright', 'index.js'));
  assert.equal(failed.remedy.run_by, 'user');
  assert.match(failed.remedy.command, /setup\.sh douyin/);
});

test('playwright is reached through its default export, because a box holds CommonJS', async (t) => {
  const box = await aBrowserBox(t, (dir) => playwrightIn(dir, exporting("{ chromium: { stub: true } }")));

  // Asserted first: a stub that exposed `chromium` directly would pass the test
  // below without the unwrapping ever running, and prove nothing.
  const entry = path.join(box, 'node_modules', 'playwright', 'index.js');
  assert.equal((await import(pathToFileURL(entry).href)).chromium, undefined);

  const api = await loadPlaywright();

  assert.equal(api.chromium.stub, true);
  // Set here rather than exported by ensure-env, so that a run.mjs invoked
  // directly drives the same browser as one reached through archive.sh.
  assert.equal(process.env.PLAYWRIGHT_BROWSERS_PATH, path.join(box, 'browsers'));
});

test('a box holding something that is not playwright refuses rather than driving nothing', async (t) => {
  const box = await aBrowserBox(t, (dir) => playwrightIn(dir, exporting("{ firefox: {} }")));

  const failed = await loadPlaywright().then(() => null, (error) => error);

  assert.ok(failed, 'nothing here can open a page');
  assert.equal(failed.code, 'playwright-broken');
  assert.equal(failed.remedy.run_by, 'user');
});

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
