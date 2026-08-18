import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import path from 'node:path';
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
/** Every box agreed to, none of them built. */
const onlyConsent = (dir) => path.basename(dir).startsWith('consented-');

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

test('a box already agreed to is rebuilt silently', async () => {
  // A manifest bump moving the tools box is seconds and a few megabytes. Asking
  // again would be asking about a cost already agreed to.
  const { spawnImpl, calls } = fakeBuilder(0);
  await ensureEnv(['runtime', 'tools'], { spawnImpl, exists: onlyConsent });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ['runtime', 'tools']);
});

test('agreeing to the downloaders is not agreeing to a quarter-gigabyte browser', async () => {
  // The scenario: someone runs `setup.sh x` for the ~115 MB X needs, then hands
  // the skill a Douyin URL. One marker covering every box is how Chromium starts
  // downloading over whatever connection they are on, unasked.
  const { spawnImpl, calls } = fakeBuilder(0);
  const consented = new Set(['runtime', 'tools']);
  const exists = (dir) => {
    const name = path.basename(dir);
    if (name.startsWith('consented-')) return consented.has(name.slice('consented-'.length));
    return dir !== boxDir('browser');
  };

  const error = await ensureEnv(['runtime', 'tools', 'browser'], {
    platform: 'douyin',
    spawnImpl,
    exists,
  }).catch((thrown) => thrown);

  assert.equal(error.code, 'env-consent');
  assert.deepEqual(error.details.boxes, ['browser']);
  assert.deepEqual(calls, [], 'nothing is downloaded before the user has agreed');
});

test('the command the agent is told to run is one argument, whatever the path holds', async () => {
  // The remedy carries run_by: 'agent', so SKILL.md instructs the agent to run
  // this string. A skill installed under "My Skills" must not become two
  // commands on the way.
  const { spawnImpl } = fakeBuilder(0);
  const error = await ensureEnv(['browser'], {
    platform: 'douyin',
    spawnImpl,
    exists: nothing,
  }).catch((thrown) => thrown);

  const [script, ...rest] = splitShellWords(error.remedy.command);
  assert.deepEqual(rest, ['douyin']);
  assert.ok(script.endsWith('setup.sh'), script);
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

test('a build failure reports its words intact, however the chunks fell', async () => {
  // The builder's stderr is bytes off a pipe, and a multi-byte character can be
  // split across two chunks. Concatenated as Buffers it becomes mojibake — in
  // the very text the user is told to read to find out what went wrong.
  const said = '构建失败：找不到 uv\n';
  const bytes = Buffer.from(said, 'utf8');

  const spawnImpl = () => {
    const child = new EventEmitter();
    // Split mid-character, which is what a real pipe does.
    child.stderr = Readable.from([bytes.subarray(0, 5), bytes.subarray(5)]);
    child.stderr.on('end', () => child.emit('close', 1));
    return child;
  };

  const error = await ensureEnv(['runtime'], { spawnImpl, exists: onlyConsent }).catch((e) => e);

  assert.equal(error.code, 'env-build-failed');
  assert.equal(error.details.output, said.trim());
});

/** What a shell would make of the command, so the assertion is about that. */
function splitShellWords(command) {
  return execFileSync('/bin/sh', ['-c', `printf '%s\\n' ${command}`], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
}
