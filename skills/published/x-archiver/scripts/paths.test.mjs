import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { COOKIE_FILE, STATE_DIR, archivesRoot, normalizeRoot } from './paths.mjs';

test('the session is cached under the state directory, not the skill', () => {
  assert.ok(STATE_DIR.endsWith(path.join('state', 'x-archiver')) || STATE_DIR.includes('x-archiver'));
  assert.equal(COOKIE_FILE, path.join(STATE_DIR, 'cookies.txt'));
  // Nothing mutable may hang off the skill directory: it can be installed
  // read-only, and a plugin update replaces it wholesale.
  assert.ok(!STATE_DIR.includes(path.join('skills', 'x-archiver')));
});

test('normalizeRoot makes a relative path absolute', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'x-dl-cwd-'));
  const out = normalizeRoot('archive', cwd);
  assert.ok(path.isAbsolute(out));
  assert.ok(out.endsWith('archive'));
});

test('normalizeRoot expands a tilde the shell never got to see', async () => {
  // The agent passes the user's flag through as typed, and a quoted ~/data
  // never reaches the shell's expansion.
  assert.equal(normalizeRoot('~'), os.homedir());
  assert.ok(normalizeRoot('~/data').startsWith(os.homedir()));
  assert.ok(!normalizeRoot('~/data').includes('~'));
});

test('normalizeRoot resolves symlinks so one root is not two archives', async () => {
  // On macOS the default root comes back as /private/tmp/... while a hand-typed
  // --archives /tmp/... would not, and a plan made one way would be refused
  // the other.
  const real = await mkdtemp(path.join(os.tmpdir(), 'x-dl-real-'));
  const link = path.join(await mkdtemp(path.join(os.tmpdir(), 'x-dl-link-')), 'alias');
  await symlink(real, link);
  assert.equal(normalizeRoot(link), normalizeRoot(real));
});

test('normalizeRoot resolves as far as the path exists and keeps the rest', async () => {
  // A archives root usually does not exist yet, so plain realpath is not
  // available — but the part that does exist must still normalise.
  const real = await mkdtemp(path.join(os.tmpdir(), 'x-dl-real-'));
  const out = normalizeRoot(path.join(real, 'not', 'yet'));
  assert.equal(out, path.join(normalizeRoot(real), 'not', 'yet'));
});

test('normalizeRoot is idempotent', async () => {
  const real = await mkdtemp(path.join(os.tmpdir(), 'x-dl-real-'));
  assert.equal(normalizeRoot(normalizeRoot(real)), normalizeRoot(real));
});

test('the default root is archives/ beside a plain directory', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'x-dl-plain-'));
  assert.equal(archivesRoot(cwd), path.join(cwd, 'archives'));
});

test('the default root is archives/ at the git root, not the subdirectory', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'x-dl-repo-'));
  const { execFileSync } = await import('node:child_process');
  execFileSync('git', ['init', '-q'], { cwd: repo });
  const deep = path.join(repo, 'a', 'b');
  await mkdir(deep, { recursive: true });

  // An archive belongs beside the project, not beside whichever folder you
  // happened to be standing in.
  const { realpathSync } = await import('node:fs');
  assert.equal(archivesRoot(deep), path.join(realpathSync(repo), 'archives'));
});
