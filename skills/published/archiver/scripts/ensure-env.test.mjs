/**
 * The one thing about the box builder a test can hold without a network: which
 * directory it resolves `tools` to, and when it stops believing a refresh.
 *
 * Everything else in `env/ensure-env` downloads, and mocking that is its own
 * piece of work — see the issue linked from `env/README.md`. These drive it
 * against a cache root with the box directory already in place, so `ensure`
 * has nothing to build and answers from the override alone.
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENSURE_ENV = path.join(HERE, '..', 'env', 'ensure-env');

/** A cache root of our own, so nothing here touches the real one. */
async function cache() {
  const home = await mkdtemp(path.join(os.tmpdir(), 'ensure-env-'));
  return { home, root: path.join(home, 'archiver') };
}

const run = (args, home) =>
  exec(ENSURE_ENV, args, { env: { ...process.env, XDG_CACHE_HOME: home } });

test('an override naming a directory that is gone is dropped, not built into', async () => {
  // A refresh killed between standing the old box aside and publishing the new
  // one leaves exactly this. Left in place, the next run installs the *pinned*
  // downloaders into the refreshed path and reports the box ready — so the user
  // is told they are on latest while running the pins --refresh exists to escape.
  const { home, root } = await cache();

  const pinned = (await run(['--print', 'tools'], home)).stdout.trim();
  const key = path.basename(pinned).replace(/^tools-/, '');
  await mkdir(pinned, { recursive: true });

  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, 'tools-override'), key);
  assert.equal(
    (await run(['--print', 'tools'], home)).stdout.trim(),
    path.join(root, `tools-latest-${key}`),
    'the override applies while its directory could still be there',
  );

  await run(['tools'], home);

  assert.ok(!existsSync(path.join(root, 'tools-override')), 'the override is cleared');
  assert.equal((await run(['--print', 'tools'], home)).stdout.trim(), pinned);
  assert.ok(!existsSync(path.join(root, `tools-latest-${key}`)), 'and nothing was built into it');

  await rm(home, { recursive: true, force: true });
});

test('an override whose box is there still selects it', async () => {
  const { home, root } = await cache();

  const pinned = (await run(['--print', 'tools'], home)).stdout.trim();
  const key = path.basename(pinned).replace(/^tools-/, '');
  const refreshed = path.join(root, `tools-latest-${key}`);
  await mkdir(refreshed, { recursive: true });
  await writeFile(path.join(root, 'tools-override'), key);

  await run(['tools'], home);

  assert.equal(await readFile(path.join(root, 'tools-override'), 'utf8'), key);
  assert.equal((await run(['--print', 'tools'], home)).stdout.trim(), refreshed);

  await rm(home, { recursive: true, force: true });
});

test('the downloads carry a connect and a total timeout', async () => {
  // --silent means a stalled handshake shows nothing at all, so without these a
  // captive portal is a skill that hangs with no output.
  const source = await readFile(ENSURE_ENV, 'utf8');
  const fetch = source.slice(source.indexOf('fetch() {'), source.indexOf('verify() {'));

  assert.match(fetch, /--connect-timeout \d+/);
  assert.match(fetch, /--max-time \d+/);
  assert.match(fetch, /--retry-connrefused/);
});

test('no trap re-parses its argument when it fires', async () => {
  // `trap "rm -rf '$work'" EXIT` expands at definition time into a string the
  // shell re-parses later, so a cache root holding an apostrophe is a syntax
  // error and anything able to set XDG_CACHE_HOME chooses what runs.
  const source = await readFile(ENSURE_ENV, 'utf8');

  assert.ok(!source.includes('SC2064'), 'no suppression of the check that catches this');
  assert.ok(!/trap "[^"]*\$/.test(source), 'no trap body is expanded where it is defined');
  assert.equal(source.match(/trap 'rm -rf "\$work"' EXIT/g)?.length, 4);
});
