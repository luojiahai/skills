import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  BOXES,
  ENV_DIR,
  archivesRoot,
  boxDir,
  boxKey,
  cacheRoot,
  cookieFile,
  downloadSize,
  normalizeRoot,
  parseManifest,
  pin,
  stateDir,
  systemTools,
  toolPath,
} from './paths.mjs';

test('each platform keeps its state under its own directory', () => {
  // Split per platform because signing in to one says nothing about the other,
  // and because a run that discarded a rejected session must not take the
  // other platform's with it.
  assert.ok(stateDir('x').endsWith(path.join('archiver', 'x')));
  assert.ok(stateDir('douyin').endsWith(path.join('archiver', 'douyin')));
  assert.notEqual(stateDir('x'), stateDir('douyin'));
  assert.equal(cookieFile('x'), path.join(stateDir('x'), 'cookies.txt'));
});

test('nothing mutable hangs off the skill directory', () => {
  // It can be installed read-only, and a plugin update replaces it wholesale.
  for (const platform of ['x', 'douyin']) {
    assert.ok(!stateDir(platform).includes(path.join('skills', 'archiver')), platform);
  }
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
  assert.equal(archivesRoot(cwd), path.join(realpathSync(cwd), 'archives'));
});

test('the default root and --archives spell one directory the same way', async () => {
  // They have to. A plan records the root it was made under and --go refuses one
  // made elsewhere, so two spellings of one directory are a plan that can never
  // be run. On macOS /tmp → /private/tmp makes that concrete rather than
  // theoretical.
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'x-dl-same-'));
  assert.equal(archivesRoot(cwd), normalizeRoot(path.join(cwd, 'archives')));
});

test('the default root is archives/ at the git root, not the subdirectory', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'x-dl-repo-'));
  execFileSync('git', ['init', '-q'], { cwd: repo });
  const deep = path.join(repo, 'a', 'b');
  await mkdir(deep, { recursive: true });

  // An archive belongs beside the project, not beside whichever folder you
  // happened to be standing in.
  assert.equal(archivesRoot(deep), path.join(realpathSync(repo), 'archives'));
});

test('a worktree, whose .git is a file, is still a project root', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'x-dl-worktree-'));
  const deep = path.join(repo, 'src');
  await mkdir(deep, { recursive: true });
  await writeFile(path.join(repo, '.git'), 'gitdir: /elsewhere/.git/worktrees/w\n');

  assert.equal(archivesRoot(deep), path.join(realpathSync(repo), 'archives'));
});

// ---- the tool boxes --------------------------------------------------------

const MANIFEST = `# a note
[runtime]
uv = 1.2.3
python = 3.13.14

# a note about tools
[tools]
pinned-by = pyproject.toml
locked-by = uv.lock

[browser]
playwright = 9.9.9
`;

test('the manifest is read as key = value lines, comments and blanks dropped', () => {
  const sections = parseManifest(MANIFEST);
  assert.deepEqual(sections.get('runtime'), ['uv=1.2.3', 'python=3.13.14']);
  assert.deepEqual(sections.get('browser'), ['playwright=9.9.9']);
  assert.equal(pin('runtime', 'python', sections), '3.13.14');
  assert.equal(pin('runtime', 'nothing', sections), null);
});

test('a box key answers to its versions and not to its comments', () => {
  // Comments in the manifest exist to be rewritten. One costing a hundred
  // megabytes of re-download is a comment nobody edits.
  const sections = parseManifest(MANIFEST);
  const reworded = parseManifest(MANIFEST.replace('# a note about tools', '# something else'));
  const read = () => 'fixed';
  for (const box of BOXES) {
    assert.equal(boxKey(box, sections, read), boxKey(box, reworded, read), box);
  }
});

test('a version bump changes exactly the box that pins it', () => {
  const sections = parseManifest(MANIFEST);
  const bumped = parseManifest(MANIFEST.replace('playwright = 9.9.9', 'playwright = 9.9.10'));
  const read = () => 'fixed';
  assert.notEqual(boxKey('browser', sections, read), boxKey('browser', bumped, read));
  assert.equal(boxKey('runtime', sections, read), boxKey('runtime', bumped, read));
  assert.equal(boxKey('tools', sections, read), boxKey('tools', bumped, read));
});

test('a Python bump invalidates the tools built against it', () => {
  // uv resolves tools against the interpreter it was given, so a tools box left
  // over from the previous Python is a box holding the wrong thing.
  const sections = parseManifest(MANIFEST);
  const bumped = parseManifest(MANIFEST.replace('python = 3.13.14', 'python = 3.14.0'));
  const read = () => 'fixed';
  assert.notEqual(boxKey('tools', sections, read), boxKey('tools', bumped, read));
});

test('a lock change invalidates the tools and nothing else', () => {
  // The whole reason the partition follows volatility: a yt-dlp patch must not
  // re-download an interpreter and a browser that did not change.
  const sections = parseManifest(MANIFEST);
  const before = () => 'one';
  const after = (name) => (name === 'uv.lock' ? 'two' : 'one');
  assert.notEqual(boxKey('tools', sections, before), boxKey('tools', sections, after));
  assert.equal(boxKey('runtime', sections, before), boxKey('runtime', sections, after));
  assert.equal(boxKey('browser', sections, before), boxKey('browser', sections, after));
});

test('ensure-env and paths.mjs agree on where every box is', () => {
  // One of them builds the box and the other has to find the same box again, so
  // the two implementations of the key are the same rule written twice. This is
  // the test that keeps them the same rule. It computes only; nothing is built
  // and no socket is touched.
  for (const box of BOXES) {
    const fromShell = execFileSync(path.join(ENV_DIR, 'ensure-env'), ['--print', box], {
      encoding: 'utf8',
    }).trim();
    assert.equal(boxDir(box), fromShell, box);
  }
});

test('a refresh sticks until a shipped bump passes it', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'archiver-cache-'));
  assert.equal(boxDir('tools', root), path.join(root, `tools-${boxKey('tools')}`));

  await writeFile(path.join(root, 'tools-override'), boxKey('tools'));
  assert.equal(boxDir('tools', root), path.join(root, `tools-latest-${boxKey('tools')}`));

  // Recorded against the shipped key it was taken over, so the day that key
  // changes the override stops applying rather than pinning the user to a
  // refresh they made months ago.
  await writeFile(path.join(root, 'tools-override'), 'someolderkey');
  assert.equal(boxDir('tools', root), path.join(root, `tools-${boxKey('tools')}`));
});

test('the boxes are cache, and sessions are not', () => {
  // rm -rf on the cache root has to be unconditionally safe: no support answer
  // should ever have to warn somebody they are about to lose a login.
  assert.equal(path.basename(cacheRoot()), 'archiver');
  assert.notEqual(cacheRoot(), stateDir('x'));
  for (const platform of ['x', 'douyin']) {
    assert.ok(!stateDir(platform).startsWith(cacheRoot() + path.sep), platform);
  }
});

test('every box says roughly what it costs to build', () => {
  // It is what the first-run refusal tells the user they are about to spend.
  for (const box of BOXES) assert.ok(downloadSize(box) > 0, box);
});

test('tools resolve into the boxes, and to PATH only through the escape hatch', () => {
  assert.ok(toolPath('yt-dlp').startsWith(cacheRoot()));
  assert.ok(toolPath('gallery-dl').startsWith(cacheRoot()));
  assert.throws(() => toolPath('curl'), /no box holds a tool/);

  process.env.ARCHIVER_SYSTEM_TOOLS = '1';
  try {
    assert.equal(systemTools(), true);
    assert.equal(toolPath('yt-dlp'), 'yt-dlp');
    assert.equal(toolPath('gallery-dl'), 'gallery-dl');
  } finally {
    delete process.env.ARCHIVER_SYSTEM_TOOLS;
  }
  assert.equal(systemTools(), false);
});
