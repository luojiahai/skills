import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { ensureEnv } from './env.mjs';
import { boxDir } from './paths.mjs';

/** A build that answers `code` and says `said` on the way, spawning nothing. */
function fakeBuilder(code, said = '') {
  const calls = [];
  const spawnImpl = (bin, args) => {
    calls.push({ bin, args });
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    queueMicrotask(() => {
      if (said) child.stderr.emit('data', said);
      child.emit('close', code);
    });
    return child;
  };
  return { spawnImpl, calls };
}

const built = () => true;
const nothing = () => false;
const onlyConsent = (dir) => dir.endsWith('consented');

test('a box already on disk builds nothing and says nothing', async () => {
  const { spawnImpl, calls } = fakeBuilder(0);
  await ensureEnv(['runtime', 'tools'], { spawnImpl, exists: built });
  assert.deepEqual(calls, []);
});

test('the first run refuses, naming what it would download and where', async () => {
  // Several hundred megabytes is not something to start without asking, and the
  // agent is the one who can ask.
  const { spawnImpl, calls } = fakeBuilder(0);
  const error = await ensureEnv(['runtime', 'browser'], {
    platform: 'douyin',
    spawnImpl,
    exists: nothing,
  }).catch((thrown) => thrown);

  assert.equal(error.code, 'env-consent');
  assert.deepEqual(error.details.boxes, ['runtime', 'browser']);
  assert.ok(error.details.download_mb > 0);
  assert.ok(error.details.dir.length);
  assert.equal(error.remedy.run_by, 'agent');
  assert.match(error.remedy.command, /setup\.sh douyin$/);
  assert.deepEqual(calls, [], 'nothing is downloaded before the user has agreed');
});

test('once anything has been built, a missing box appears silently', async () => {
  // A manifest bump moving the tools box is seconds and a few megabytes. Asking
  // again would be asking about a cost already agreed to.
  const { spawnImpl, calls } = fakeBuilder(0);
  await ensureEnv(['runtime', 'tools'], { spawnImpl, exists: onlyConsent });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ['runtime', 'tools']);
});

test('only the missing boxes are built', async () => {
  const { spawnImpl, calls } = fakeBuilder(0);
  const tools = boxDir('tools');
  await ensureEnv(['runtime', 'tools'], {
    spawnImpl,
    exists: (dir) => dir !== tools,
  });
  assert.deepEqual(calls[0].args, ['tools']);
});

test('a failed build names the escape hatch and never falls back to PATH', async () => {
  // Falling back would reintroduce the version ambiguity owning the environment
  // exists to remove, at the moment things are already going wrong.
  const { spawnImpl } = fakeBuilder(1, 'ensure-env: could not download uv\n');
  const error = await ensureEnv(['runtime'], { spawnImpl, exists: onlyConsent }).catch((e) => e);

  assert.equal(error.code, 'env-build-failed');
  assert.deepEqual(error.details.boxes, ['runtime']);
  assert.match(error.details.output, /could not download uv/);
  assert.match(error.remedy.message, /ARCHIVER_SYSTEM_TOOLS=1/);
  assert.equal(error.remedy.run_by, 'user');
});

test('a builder that cannot be started is a build failure, not a crash', async () => {
  const spawnImpl = () => {
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    queueMicrotask(() => child.emit('error', new Error('ENOENT')));
    return child;
  };
  const error = await ensureEnv(['runtime'], { spawnImpl, exists: onlyConsent }).catch((e) => e);
  assert.equal(error.code, 'env-build-failed');
});

test('the escape hatch builds nothing at all', async () => {
  // All-or-nothing and documented as unsupported: the user is back on PATH, and
  // the refusals for a tool that is not there are what they meet.
  const { spawnImpl, calls } = fakeBuilder(0);
  process.env.ARCHIVER_SYSTEM_TOOLS = '1';
  try {
    await ensureEnv(['runtime', 'tools', 'browser'], { spawnImpl, exists: nothing });
  } finally {
    delete process.env.ARCHIVER_SYSTEM_TOOLS;
  }
  assert.deepEqual(calls, []);
});
