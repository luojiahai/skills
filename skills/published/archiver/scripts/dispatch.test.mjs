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

function capture() {
  const lines = [];
  const out = console.log;
  const err = console.error;
  console.log = (line) => lines.push(String(line));
  console.error = (line) => lines.push(String(line));
  return {
    lines,
    restore() {
      console.log = out;
      console.error = err;
    },
  };
}

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
  const io = capture();
  try {
    assert.equal(await main(['https://www.instagram.com/someone'], { load }), EXIT.USAGE);
  } finally {
    io.restore();
  }
  assert.equal(seen.length, 0, 'nothing should be loaded');
  assert.match(io.lines.join('\n'), /no URL here names a platform/);
  assert.match(io.lines.join('\n'), /Douyin.*X, formerly Twitter/s);
});

test('there is no generic fallback to try it anyway', async () => {
  // Every guarantee this skill makes — the post.json shape, the per-post folder,
  // the re-run that fetches only what is new — comes from platform code. A
  // generic downloader would satisfy none of it while looking like it worked.
  const { load, seen } = spy();
  const io = capture();
  try {
    await main(['https://youtube.com/@someone', '--yes'], { load });
  } finally {
    io.restore();
  }
  assert.equal(seen.length, 0);
});

test('two platforms in one command is refused, and nothing runs', async () => {
  const { load, seen } = spy();
  const io = capture();
  try {
    const code = await main(['https://x.com/jack', 'https://www.douyin.com/user/MS4w'], { load });
    assert.equal(code, EXIT.USAGE);
  } finally {
    io.restore();
  }
  assert.equal(seen.length, 0);
  assert.match(io.lines.join('\n'), /one account at a time/);
});

test('--help without a URL describes every platform', async () => {
  const { load } = spy();
  const io = capture();
  try {
    assert.equal(await main(['--help'], { load }), EXIT.OK);
  } finally {
    io.restore();
  }
  const help = io.lines.join('\n');
  assert.match(help, /Common to every platform/);
  assert.match(help, /--login/, 'the Douyin section');
  assert.match(help, /--browser/, 'the X section');
});

test('--help with a URL is the platform, not this', async () => {
  const { load, seen } = spy();
  await main(['https://x.com/jack', '--help'], { load });
  assert.equal(seen[0], 'x');
});

test('no arguments at all prints the help, and says so with its exit code', async () => {
  const { load } = spy();
  const io = capture();
  try {
    assert.equal(await main([], { load }), EXIT.USAGE);
  } finally {
    io.restore();
  }
  assert.match(io.lines.join('\n'), /Usage:/);
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
  const io = capture();
  const root = await archived();
  try {
    assert.equal(await main(['--list', '--archives', root], { load }), EXIT.OK);
  } finally {
    io.restore();
  }
  assert.equal(seen.length, 0, 'no platform should be loaded');

  const reported = JSON.parse(io.lines.join('\n'));
  assert.equal(reported.root, root);
  assert.equal(reported.accounts.length, 1);
  assert.equal(reported.accounts[0].folder, 'jia');
  assert.equal(reported.accounts[0].url, 'https://x.com/jia');
});

test('--list writes JSON, because the skill is what does the talking', async () => {
  const { load } = spy();
  const io = capture();
  try {
    await main(['--list', '--archives', await archived()], { load });
  } finally {
    io.restore();
  }
  assert.doesNotThrow(() => JSON.parse(io.lines.join('\n')));
});

test('--list on a root with nothing in it still says where it looked, and succeeds', async () => {
  const { load } = spy();
  const io = capture();
  const empty = realpathSync(await mkdtemp(path.join(os.tmpdir(), 'archiver-empty-')));
  try {
    assert.equal(await main(['--list', '--archives', empty], { load }), EXIT.OK);
  } finally {
    io.restore();
  }
  assert.deepEqual(JSON.parse(io.lines.join('\n')), { root: empty, accounts: [] });
});

test('--list with a URL is refused, because they ask different questions', async () => {
  const { load, seen } = spy();
  const io = capture();
  try {
    assert.equal(await main(['--list', 'https://x.com/jack'], { load }), EXIT.USAGE);
  } finally {
    io.restore();
  }
  assert.equal(seen.length, 0);
  assert.match(io.lines.join('\n'), /a URL asks about one account/);
});

test('--list alongside a flag that acts is refused, and names it', async () => {
  for (const flag of ['--plan', '--go', '--yes', '-y', '--unalias', '--alias']) {
    const { load, seen } = spy();
    const io = capture();
    try {
      assert.equal(await main(['--list', flag], { load }), EXIT.USAGE, flag);
    } finally {
      io.restore();
    }
    assert.equal(seen.length, 0, flag);
    assert.match(io.lines.join('\n'), new RegExp(`takes only --archives DIR, not ${flag}`), flag);
  }
});

test('--list with a stray positional is refused', async () => {
  const { load } = spy();
  const io = capture();
  try {
    assert.equal(await main(['--list', 'jia'], { load }), EXIT.USAGE);
  } finally {
    io.restore();
  }
  assert.match(io.lines.join('\n'), /takes only --archives DIR, not "jia"/);
});

test('--list --help is the help, not a conflict', async () => {
  // Asking what a command does is always answerable, and answering it is not
  // the action --list would conflict with.
  const { load } = spy();
  const io = capture();
  try {
    assert.equal(await main(['--list', '--help'], { load }), EXIT.OK);
  } finally {
    io.restore();
  }
  assert.match(io.lines.join('\n'), /Usage:/);
});

test('a root this build cannot read refuses the listing, and says why', async () => {
  const { load } = spy();
  const io = capture();
  try {
    const root = await archived();
    await writeFile(path.join(root, 'archiver.json'), JSON.stringify({ schema: 99 }));
    assert.equal(await main(['--list', '--archives', root], { load }), EXIT.USAGE);
  } finally {
    io.restore();
  }
  assert.match(io.lines.join('\n'), /newer version of this skill/);
});

test('the help names --list', async () => {
  const { load } = spy();
  const io = capture();
  try {
    await main(['--help'], { load });
  } finally {
    io.restore();
  }
  assert.match(io.lines.join('\n'), /--list/);
});

test('the skill runs when it is reached through a symlink', async () => {
  // The skill is installed by symlink. node resolves the entry module to its
  // real location while argv[1] keeps the path archive.sh was given, so an entry
  // guard comparing the two unresolved never fires. Only a spawn reaches that
  // guard, and --help without a URL answers from the dispatcher without loading
  // a platform, so what is installed on this machine cannot affect the result.
  const dir = realpathSync(await mkdtemp(path.join(os.tmpdir(), 'archiver-symlink-')));
  await symlink(SKILL_DIR, path.join(dir, 'archiver'));

  const { stdout } = await run(path.join(dir, 'archiver', 'scripts', 'archive.sh'), ['--help']);

  assert.match(stdout, /Usage:/);
});
