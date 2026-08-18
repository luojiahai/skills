/**
 * Tests for dispatch.mjs — which platform a command line reaches, and what is
 * answered before one is loaded.
 *
 * Every run goes through `emitted`, which parses the one document off stdout and
 * validates it against `shared/output.schema.json`. The help is the documented
 * exception and is asserted on stdout directly.
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { main } from './dispatch.mjs';
import { EXIT } from './shared/exit.mjs';
import { capture, emitted } from './testing.mjs';

const run = promisify(execFile);
const SKILL_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** A platform that records what it was handed, so passthrough can be asserted on. */
function spy(code = EXIT.OK) {
  const seen = [];
  const load = (platform) => {
    seen.push(platform.name);
    return Promise.resolve({ main: (argv) => (seen.push(argv), code) });
  };
  return { load, seen };
}

const dispatched = (argv, load) => emitted(main, argv, { load });

test('a URL reaches the platform it names', async () => {
  const { load, seen } = spy();
  assert.equal(await main(['https://x.com/jack', '--plan'], { load }), EXIT.OK);
  assert.equal(seen[0], 'x');
});

test('the whole command line goes through untouched', async () => {
  // The dispatcher parses no flags. A platform's own flags, in the order the
  // user typed them, are what it must receive — including the URL, because the
  // platform parses the URL again to work out what part of the site it names.
  const { load, seen } = spy();
  const argv = ['--archives', '~/data', 'https://www.douyin.com/user/MS4w', '--alias', '小明', '--go'];
  await main(argv, { load });
  assert.equal(seen[0], 'douyin');
  assert.deepEqual(seen[1], argv);
});

test('the platform decides the exit code', async () => {
  const { load } = spy(EXIT.UNAUTHORIZED);
  assert.equal(await main(['https://x.com/jack'], { load }), EXIT.UNAUTHORIZED);
});

test('a URL from a platform this skill does not archive is refused by name', async () => {
  const { load, seen } = spy();
  const { document } = await dispatched(['https://www.instagram.com/someone'], load);

  assert.equal(seen.length, 0, 'nothing should be loaded');
  assert.equal(document.error.code, 'unsupported-platform');
  assert.equal(document.exit, EXIT.USAGE);
  // Nothing was dispatched, so nothing has a command or a platform to name.
  assert.equal(document.command, null);
  assert.equal(document.platform, null);
  assert.deepEqual(
    document.error.details.supported.map((platform) => platform.name).sort(),
    ['douyin', 'x'],
  );
});

test('there is no generic fallback to try it anyway', async () => {
  // Every guarantee this skill makes — the post.json shape, the per-post folder,
  // the re-run that fetches only what is new — comes from platform code. A
  // generic downloader would satisfy none of it while looking like it worked.
  const { load, seen } = spy();
  await dispatched(['https://youtube.com/@someone', '--yes'], load);
  assert.equal(seen.length, 0);
});

test('two platforms in one command is refused, and names both URLs', async () => {
  const { load, seen } = spy();
  const urls = ['https://x.com/jack', 'https://www.douyin.com/user/MS4w'];
  const { document } = await dispatched(urls, load);

  assert.equal(seen.length, 0);
  assert.equal(document.error.code, 'multiple-platforms');
  assert.deepEqual(document.error.details.urls, urls);
});

test('--help without a URL describes every platform', async () => {
  // Prose on stdout, and the one documented exception to the one-document rule:
  // it exists for a person typing this by hand, and nobody parses it.
  const { load } = spy();
  const help = await capture(() => main(['--help'], { load }));

  assert.equal(help.code, EXIT.OK);
  assert.match(help.stdout, /Common to every platform/);
  assert.match(help.stdout, /--login/, 'the Douyin section');
  assert.match(help.stdout, /--browser/, 'the X section');
  assert.match(help.stdout, /--list/);
});

test('--help with a URL is the platform, not this', async () => {
  const { load, seen } = spy();
  await main(['https://x.com/jack', '--help'], { load });
  assert.equal(seen[0], 'x');
});

test('no arguments at all is a refusal with a code, and the usage on stderr', async () => {
  // The prose still reaches somebody who typed nothing; it goes to stderr so
  // that stdout carries the document and nothing else.
  const { load } = spy();
  const { document, stdout, stderr } = await dispatched([], load);

  assert.equal(document.error.code, 'no-arguments');
  assert.equal(document.exit, EXIT.USAGE);
  assert.match(stderr, /Usage:/);
  assert.deepEqual(JSON.parse(stdout), document, 'stdout holds the document and nothing else');
});

/** An archives root holding one X account, for the --list tests. */
async function archived() {
  const root = realpathSync(await mkdtemp(path.join(os.tmpdir(), 'archiver-dispatch-')));
  const dir = path.join(root, 'x', 'jia');
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, 'account.json'),
    JSON.stringify({ version: 1, platform: 'x', account: { id: '1', nickname: 'Jia' }, url: 'https://x.com/jia' }),
  );
  return root;
}

test('--list reports the accounts under the root, without loading a platform', async () => {
  // It must answer on a machine with no yt-dlp, no gallery-dl and no session:
  // reading the tree is not archiving, so nothing is loaded and nothing is
  // preflighted.
  const { load, seen } = spy();
  const root = await archived();
  const { document } = await dispatched(['--list', '--archives', root], load);

  assert.equal(seen.length, 0, 'no platform should be loaded');
  assert.equal(document.command, 'list');
  assert.equal(document.platform, null, '--list belongs to no platform');
  assert.equal(document.exit, EXIT.OK);
  assert.equal(document.result.root, root);
  assert.equal(document.result.accounts.length, 1);
  assert.equal(document.result.accounts[0].folder, 'jia');
  assert.equal(document.result.accounts[0].url, 'https://x.com/jia');
});

test('--list is under the same envelope as everything else', async () => {
  // One contract to read, rather than one plus an exception.
  const { load } = spy();
  const { document } = await dispatched(['--list', '--archives', await archived()], load);
  assert.equal(document.schema, 1);
  assert.equal(document.ok, true);
});

test('--list on a root with nothing in it still says where it looked, and succeeds', async () => {
  const { load } = spy();
  const empty = realpathSync(await mkdtemp(path.join(os.tmpdir(), 'archiver-empty-')));
  const { document } = await dispatched(['--list', '--archives', empty], load);

  assert.equal(document.exit, EXIT.OK);
  assert.deepEqual(document.result, { root: empty, accounts: [] });
});

test('--list with a URL is refused, because they ask different questions', async () => {
  const { load, seen } = spy();
  const { document } = await dispatched(['--list', 'https://x.com/jack'], load);

  assert.equal(seen.length, 0);
  assert.equal(document.error.code, 'list-with-url');
  assert.equal(document.exit, EXIT.USAGE);
});

test('--list alongside a flag that acts is refused, and names it', async () => {
  for (const flag of ['--plan', '--go', '--yes', '-y', '--unalias', '--alias']) {
    const { load, seen } = spy();
    const { document } = await dispatched(['--list', flag], load);

    assert.equal(seen.length, 0, flag);
    assert.equal(document.error.code, 'list-unknown-flag', flag);
    assert.equal(document.error.details.flag, flag);
  }
});

test('--list with a stray positional is refused, and names it', async () => {
  const { load } = spy();
  const { document } = await dispatched(['--list', 'jia'], load);

  assert.equal(document.error.code, 'list-unexpected-argument');
  assert.equal(document.error.details.argument, 'jia');
});

test('--list --help is the help, not a conflict', async () => {
  // Asking what a command does is always answerable, and answering it is not
  // the action --list would conflict with.
  const { load } = spy();
  const help = await capture(() => main(['--list', '--help'], { load }));

  assert.equal(help.code, EXIT.OK);
  assert.match(help.stdout, /Usage:/);
});

test('a root this build cannot read refuses the listing, and says which schema', async () => {
  const { load } = spy();
  const root = await archived();
  await writeFile(path.join(root, 'archiver.json'), JSON.stringify({ schema: 99 }));

  const { document } = await dispatched(['--list', '--archives', root], load);

  assert.equal(document.error.code, 'archive-schema-unsupported');
  assert.equal(document.error.details.found, 99);
  assert.equal(document.error.details.writes, 3);
  assert.equal(document.error.remedy.run_by, 'user');
});

test('a crash still produces a document', async () => {
  // The case where the agent knows least must not be the case that tells it
  // nothing: an empty stdout is indistinguishable from a command with nothing
  // to say.
  const load = () => Promise.reject(new Error('the platform module is broken'));
  const { document } = await dispatched(['https://x.com/jack', '--plan'], load);

  assert.equal(document.error.code, 'internal-error');
  assert.equal(document.exit, EXIT.FAILED);
  assert.match(document.error.details.stack, /the platform module is broken/);
});

test('the skill runs when it is reached through a symlink', async () => {
  // The skill is installed by symlink. node resolves the entry module to its
  // real location while argv[1] keeps the path archive.sh was given, so an entry
  // guard comparing the two unresolved never fires. Only a spawn reaches that
  // guard, and --help without a URL answers from the dispatcher without loading
  // a platform, so no platform's tools can affect the result.
  //
  // Spawned through the escape hatch, because the run needs an interpreter and
  // the suite may not build one: every other test here calls main() in-process,
  // and this is the one that has to be a real process. What it asserts —
  // where node resolves the entry module from — is the same either way.
  const dir = realpathSync(await mkdtemp(path.join(os.tmpdir(), 'archiver-symlink-')));
  await symlink(SKILL_DIR, path.join(dir, 'archiver'));

  const { stdout } = await run(path.join(dir, 'archiver', 'scripts', 'archive.sh'), ['--help'], {
    env: { ...process.env, ARCHIVER_SYSTEM_TOOLS: '1' },
  });

  assert.match(stdout, /Usage:/);
});

test('with no tools built, every command refuses rather than borrowing a node', async () => {
  // The version that runs the scripts is as much a part of the environment this
  // skill owns as the downloaders are, so "which node did this run on" has
  // exactly one answer. A node on PATH is not consulted, and --help is no
  // exception — the refusal is a document like any other, written by hand
  // because there is nothing to compose one with.
  const cache = await mkdtemp(path.join(os.tmpdir(), 'archiver-nobox-'));
  const failed = await run(path.join(SKILL_DIR, 'scripts', 'archive.sh'), ['--help'], {
    env: { ...process.env, XDG_CACHE_HOME: cache, ARCHIVER_SYSTEM_TOOLS: '' },
  }).then(() => null, (error) => error);

  assert.ok(failed, 'a machine with nothing built cannot answer');
  assert.equal(failed.code, EXIT.FAILED);

  const document = JSON.parse(failed.stdout);
  assert.equal(document.ok, false);
  assert.equal(document.error.code, 'node-missing');
  assert.equal(document.error.remedy.run_by, 'user');
  assert.match(document.error.remedy.message, /setup\.sh/);
});
