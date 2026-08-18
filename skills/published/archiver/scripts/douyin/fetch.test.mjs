import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  classifyFailure,
  fetchArgs,
  fetchPosts,
  metadataArgs,
  outstanding,
  postDir,
  saysSessionStale,
} from './fetch.mjs';
import { isComplete } from '../shared/post.mjs';

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

test('a stale session is told apart from an unavailable post', () => {
  // Only one of these is worth re-minting cookies and retrying for.
  assert.equal(saysSessionStale('ERROR: ... Fresh cookies (not necessarily logged in) are needed'), true);
  assert.equal(saysSessionStale('ERROR: Video unavailable'), false);
  assert.equal(saysSessionStale(null), false);
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

test('a post yielding several files lists every one of them', async () => {
  // MEDIA_NAME numbers a post's files by position because a post can yield more
  // than one. Recording only the first would let `1.mp4` alone satisfy the
  // completeness check — so files 2 and 3 stay missing, silently and forever.
  const dir = await root();
  const { spawnImpl } = fakeYtDlp([{ lines: ['1.mp4', '2.mp4', '3.mp4'], code: 0 }]);

  const result = await fetchPosts({
    accountDir: dir,
    posts: [{ id: '7412', createTime: 1710144139, text: 'three clips' }],
    cookies: null,
    bin: '/nonexistent/yt-dlp',
    spawnImpl,
  });

  assert.equal(result.fetched, 1);

  const folder = postDir(dir, { id: '7412', createTime: 1710144139 });
  const post = JSON.parse(await readFile(path.join(folder, 'post.json'), 'utf8'));
  assert.deepEqual(post.media.map((entry) => entry.file), ['1.mp4', '2.mp4', '3.mp4']);

  // And the point of listing all three: with only the first on disk, the post
  // is not done.
  assert.equal(isComplete(post, ['1.mp4']), false);
  assert.equal(isComplete(post, ['1.mp4', '2.mp4', '3.mp4']), true);
});

test('a failure the next post would meet too is told apart from this post’s own', async () => {
  // The one that matters is the rate limit: counting it as a failed post and
  // carrying on means hundreds more yt-dlp invocations, each with --retries 3,
  // into a limiter that has just said no. What is at risk is the account.
  assert.equal(classifyFailure('ERROR: [douyin] 7412: HTTP Error 429: Too Many Requests'), 'rate-limited');
  assert.equal(classifyFailure('ERROR: unable to download: 访问频繁，请稍后再试'), 'rate-limited');
  assert.equal(classifyFailure('ERROR: [douyin] HTTP Error 403: Forbidden'), 'session-rejected');
  assert.equal(classifyFailure('WARNING: risk control triggered, 请完成验证码'), 'session-rejected');

  // This post's own business: the run steps over it and keeps going.
  assert.equal(classifyFailure('ERROR: Video unavailable'), null);
  assert.equal(classifyFailure(''), null);
});

test('a caption or a path is never read as a reason to stop', async () => {
  // yt-dlp prints resolved filenames and video titles to the same streams an
  // error goes to. `session-rejected` stops the run *and* discards the cached
  // session, so a post titled 访问频繁 would cost the user a sign-in.
  for (const line of [
    '[download] Destination: /a/访问频繁/1.mp4',
    '[info] title: 大家不要访问频繁哦',
    '/Users/someone/archives/douyin/captcha/1.mp4',
    '[download] 100% of 403.00KiB',
    '[download] 100% of 429.00KiB in 00:01',
  ]) {
    assert.equal(classifyFailure(line), null, line);
  }
});

test('a run stops at the first failure the next post would repeat', async () => {
  const dir = await root();
  const { spawnImpl, calls } = fakeYtDlp([
    { lines: ['1.mp4'], code: 0 },
    { lines: [], stderr: 'ERROR: [douyin] HTTP Error 429: Too Many Requests', code: 1 },
  ]);

  const result = await fetchPosts({
    accountDir: dir,
    posts: [
      { id: '1', createTime: 1710144139, text: '' },
      { id: '2', createTime: 1710144139, text: '' },
      { id: '3', createTime: 1710144139, text: '' },
    ],
    cookies: null,
    bin: '/nonexistent/yt-dlp',
    spawnImpl,
  });

  assert.equal(result.stopped, 'rate-limited');
  assert.equal(result.fetched, 1);
  assert.equal(calls.length, 2, 'the third post is never asked for');
});
