import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  SYNC_FILE,
  SYNC_VERSION,
  clearPlan,
  loadPlan,
  mergeSync,
  previousRoot,
  readSync,
  recordRun,
  savePlan,
  writeSync,
} from './sync.mjs';

const accountDir = async () => {
  const dir = path.join(await mkdtemp(path.join(os.tmpdir(), 'x-sync-')), 'x', '55');
  await mkdir(dir, { recursive: true });
  return dir;
};

test('mergeSync holds the file’s three keys and nothing else', () => {
  const merged = mergeSync({ cursor: '7000', newest_id: '7000' }, { plan: { a: 1 } });
  assert.deepEqual(Object.keys(merged), ['version', 'plan', 'last_run']);
  assert.equal(merged.version, SYNC_VERSION);
});

test('a key left out keeps what is already there', () => {
  const merged = mergeSync({ plan: { a: 1 }, last_run: { at: 'yesterday' } }, { last_run: { at: 'today' } });
  assert.deepEqual(merged.plan, { a: 1 });
  assert.equal(merged.last_run.at, 'today');
});

test('a key passed as null clears it, which is how a finished plan is retired', () => {
  const merged = mergeSync({ plan: { a: 1 }, last_run: { at: 'today' } }, { plan: null });
  assert.equal(merged.plan, null);
  assert.equal(merged.last_run.at, 'today');
});

test('a plan survives a round trip', async () => {
  const dir = await accountDir();
  await savePlan(dir, { createdAt: 'now', posts: [{ tweetId: '1' }] });
  assert.deepEqual((await loadPlan(dir)).posts, [{ tweetId: '1' }]);
});

test('clearPlan retires the plan and keeps the run history beside it', async () => {
  const dir = await accountDir();
  await savePlan(dir, { createdAt: 'now' });
  await recordRun(dir, { root: '/data', found: 3, landed: 3, failed: 0 });
  await clearPlan(dir);

  assert.equal(await loadPlan(dir), null);
  assert.equal((await readSync(dir)).last_run.found, 3);
});

test('recordRun stamps a time without being given one', async () => {
  const dir = await accountDir();
  await recordRun(dir, { root: '/data' });
  assert.match((await readSync(dir)).last_run.at, /^\d{4}-\d{2}-\d{2}T/);
});

test('previousRoot is what the last run recorded, so the block can say it moved', async () => {
  const dir = await accountDir();
  assert.equal(await previousRoot(dir), null);
  await recordRun(dir, { root: '/old' });
  assert.equal(await previousRoot(dir), '/old');
});

test('an account nobody has run against reads as nothing, not as an error', async () => {
  const dir = await accountDir();
  assert.equal(await readSync(dir), null);
  assert.equal(await loadPlan(dir), null);
});

test('a file from a version this build cannot read is no plan at all', async () => {
  // A plan is a cache. The honest thing to do with one we cannot read is make a
  // new one, not guess at fields that may be numbered differently.
  const dir = await accountDir();
  await writeFile(
    path.join(dir, SYNC_FILE),
    JSON.stringify({ version: SYNC_VERSION + 1, plan: { posts: [{ tweetId: '1' }] } }),
  );
  assert.equal(await readSync(dir), null);
  assert.equal(await loadPlan(dir), null);
});

test('writeSync creates the account folder if the run got here first', async () => {
  const dir = path.join(await mkdtemp(path.join(os.tmpdir(), 'x-sync-')), 'x', '99');
  await writeSync(dir, { plan: { createdAt: 'now' } });
  assert.deepEqual((await readSync(dir)).plan, { createdAt: 'now' });
});
