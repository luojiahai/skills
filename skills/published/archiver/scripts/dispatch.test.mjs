import assert from 'node:assert/strict';
import test from 'node:test';

import { main } from './dispatch.mjs';
import { EXIT } from './shared/exit.mjs';

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
