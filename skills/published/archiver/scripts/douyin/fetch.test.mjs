import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { classifyFailure, fetchArgs, fetchPosts, metadataArgs, outstanding, postDir } from './fetch.mjs';

const root = () => mkdtemp(path.join(os.tmpdir(), 'douyin-fetch-'));

/**
 * A yt-dlp that prints the lines it is told to and exits with the code it is
 * told to, without a network or a binary anywhere.
 */
function fakeYtDlp(script) {
  const calls = [];
  const spawnImpl = (bin, args) => {
    const turn = script[Math.min(calls.length, script.length - 1)];
    calls.push({ bin, args });
    const child = new EventEmitter();
    child.stdout = Readable.from((turn.lines ?? []).map((line) => `${line}\n`));
    child.stderr = Readable.from(turn.stderr ? [turn.stderr] : []);
    child.stdout.on('end', () => setImmediate(() => child.emit('close', turn.code ?? 0)));
    return child;
  };
  return { spawnImpl, calls };
}

test('the printed filename and the output template are the same spelling', () => {
  // What yt-dlp prints has to be what yt-dlp writes. Two spellings that agree
  // today would drift the moment a post yields more than one file.
  const args = fetchArgs({ url: 'https://www.douyin.com/video/7412', dir: '/a/b', cookies: null });
  const printed = args[args.indexOf('--print') + 1];
  const output = args[args.indexOf('-o') + 1];
  assert.equal(output, path.join('/a/b', printed));
});

test('--print is paired with --no-simulate, or nothing downloads', () => {
  // --print implies --simulate. Without this flag the run would report every
  // post as fetched and write no media at all.
  const args = fetchArgs({ url: 'https://www.douyin.com/video/7412', dir: '/a', cookies: null });
  assert.ok(args.includes('--print'));
  assert.ok(args.includes('--no-simulate'));
});

test('the throttle is present on both kinds of request', () => {
  // Douyin rate-limits hard; a run with the pauses removed gets cut off partway.
  for (const args of [
    fetchArgs({ url: 'u', dir: '/a', cookies: null }),
    metadataArgs({ url: 'u', cookies: null }),
  ]) {
    assert.ok(args.includes('--sleep-requests'), args.join(' '));
    assert.ok(args.includes('--retries'), args.join(' '));
  }
});

test('cookies are passed only when there are cookies', () => {
  assert.deepEqual(fetchArgs({ url: 'u', dir: '/a', cookies: '/c.txt' }).slice(0, 2), ['--cookies', '/c.txt']);
  assert.ok(!fetchArgs({ url: 'u', dir: '/a', cookies: null }).includes('--cookies'));
});

test('a rejected session is told apart from an unavailable post', () => {
  // Only one of these is worth re-minting cookies and retrying for.
  assert.equal(classifyFailure('ERROR: ... Fresh cookies (not necessarily logged in) are needed'), 'unauthorized');
  assert.equal(classifyFailure('ERROR: Video unavailable'), null);
  assert.equal(classifyFailure(null), null);
});

test('the folder is named from the timestamp the listing pass carried', () => {
  assert.equal(
    postDir('/acct', { id: '7412', createTime: 1710144139 }),
    path.join('/acct', 'posts', '2024-03-11_7412'),
  );
});

test('outstanding keeps feed order and drops what has landed', () => {
  const archive = new Map([
    ['b', { post: { version: 1, media: [{ file: '1.mp4' }] }, names: ['1.mp4'] }],
  ]);
  const posts = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(outstanding(posts, archive).map((p) => p.id), ['a', 'c']);
});

test('post.json is written before the media, and lists what yt-dlp named', async () => {
  const dir = await root();
  const { spawnImpl } = fakeYtDlp([{ lines: ['1.mp4'], code: 0 }]);

  const result = await fetchPosts({
    accountDir: dir,
    posts: [{ id: '7412', text: '早安', createTime: 1710144139 }],
    cookies: null,
    spawnImpl,
  });

  assert.deepEqual({ fetched: result.fetched, failed: result.failed }, { fetched: 1, failed: 0 });
  const postDirPath = path.join(dir, 'posts', '2024-03-11_7412');
  const post = JSON.parse(await readFile(path.join(postDirPath, 'post.json'), 'utf8'));
  assert.equal(post.id, '7412');
  assert.equal(post.text, '早安');
  assert.equal(post.timestamp, '2024-03-11T08:02:19Z');
  assert.deepEqual(post.media, [{ file: '1.mp4', type: 'video' }]);
  assert.equal(post.reply_to, null);
});

test('a post yt-dlp never named its media for counts as failed', async () => {
  // No printed filename means no post.json, and a folder with no post.json must
  // not read as a fetched post — the next run has to come back for it.
  const dir = await root();
  const { spawnImpl } = fakeYtDlp([{ lines: [], code: 0 }]);

  const result = await fetchPosts({
    accountDir: dir,
    posts: [{ id: '7412', createTime: 1710144139 }],
    cookies: null,
    spawnImpl,
  });

  assert.equal(result.fetched, 0);
  assert.equal(result.failed, 1);
  assert.deepEqual(await readdir(path.join(dir, 'posts', '2024-03-11_7412')), []);
});

test('noise on stdout is not mistaken for a filename', async () => {
  const dir = await root();
  const { spawnImpl } = fakeYtDlp([{ lines: ['[download] Destination: whatever', '1.mp4'], code: 0 }]);

  await fetchPosts({
    accountDir: dir,
    posts: [{ id: '7412', createTime: 1710144139 }],
    cookies: null,
    spawnImpl,
  });

  const post = JSON.parse(
    await readFile(path.join(dir, 'posts', '2024-03-11_7412', 'post.json'), 'utf8'),
  );
  assert.deepEqual(post.media, [{ file: '1.mp4', type: 'video' }]);
});

test('a post the listing could not describe is dated by an extra request', async () => {
  const dir = await root();
  const { spawnImpl, calls } = fakeYtDlp([
    { lines: ['1710144139\t晚安'], code: 0 }, // the metadata pass
    { lines: ['1.mp4'], code: 0 }, // the download
  ]);

  const result = await fetchPosts({
    accountDir: dir,
    posts: [{ id: '7412', text: null, createTime: null }],
    cookies: null,
    spawnImpl,
  });

  assert.equal(result.undescribed, 1);
  assert.ok(calls[0].args.includes('--skip-download'), 'the first call asks, it does not fetch');
  const post = JSON.parse(
    await readFile(path.join(dir, 'posts', '2024-03-11_7412', 'post.json'), 'utf8'),
  );
  assert.equal(post.text, '晚安');
  assert.equal(post.timestamp, '2024-03-11T08:02:19Z');
});

test('a rejected session re-mints cookies and retries exactly once', async () => {
  const dir = await root();
  const { spawnImpl, calls } = fakeYtDlp([
    { lines: [], code: 1, stderr: 'ERROR: Fresh cookies are needed' },
    { lines: ['1.mp4'], code: 0 },
  ]);
  let minted = 0;

  const result = await fetchPosts({
    accountDir: dir,
    posts: [{ id: '7412', createTime: 1710144139 }],
    cookies: '/old.txt',
    refreshCookies: async () => (minted += 1, '/new.txt'),
    spawnImpl,
  });

  assert.equal(minted, 1);
  assert.equal(result.fetched, 1);
  assert.deepEqual(calls[1].args.slice(0, 2), ['--cookies', '/new.txt']);
});

test('a failure that is not the session does not re-mint anything', async () => {
  const dir = await root();
  const { spawnImpl } = fakeYtDlp([{ lines: [], code: 1, stderr: 'ERROR: Video unavailable' }]);
  let minted = 0;

  const result = await fetchPosts({
    accountDir: dir,
    posts: [{ id: '7412', createTime: 1710144139 }],
    cookies: '/old.txt',
    refreshCookies: async () => (minted += 1, '/new.txt'),
    spawnImpl,
  });

  assert.equal(minted, 0);
  assert.equal(result.failed, 1);
});

test('one post failing does not stop the ones after it', async () => {
  // What landed is on disk, so a re-run picks up exactly what is missing.
  const dir = await root();
  let call = 0;
  const spawnImpl = (bin, args) => {
    const fails = call++ === 0;
    const child = new EventEmitter();
    child.stdout = Readable.from(fails ? [] : ['1.mp4\n']);
    child.stderr = Readable.from(fails ? ['ERROR: Video unavailable'] : []);
    child.stdout.on('end', () => setImmediate(() => child.emit('close', fails ? 1 : 0)));
    return child;
  };

  const result = await fetchPosts({
    accountDir: dir,
    posts: [
      { id: '1', createTime: 1710144139 },
      { id: '2', createTime: 1710144139 },
      { id: '3', createTime: 1710144139 },
    ],
    cookies: null,
    spawnImpl,
  });

  assert.deepEqual({ fetched: result.fetched, failed: result.failed }, { fetched: 2, failed: 1 });
});

test('a yt-dlp that cannot be spawned is a failed post, not a hung run', async () => {
  const dir = await root();
  const spawnImpl = () => {
    const child = new EventEmitter();
    child.stdout = Readable.from([]);
    child.stderr = Readable.from([]);
    setImmediate(() => child.emit('error', new Error('spawn ENOENT')));
    return child;
  };

  const result = await fetchPosts({
    accountDir: dir,
    posts: [{ id: '7412', createTime: 1710144139 }],
    cookies: null,
    spawnImpl,
  });

  assert.equal(result.failed, 1);
});
