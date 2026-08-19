import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';

import { DEFAULT_ABORT, collect, makeStopper } from './collect.mjs';
import { ROW_MARKER } from './gallerydl.mjs';
import { buildPost } from '../../shared/post.mjs';

const row = (id, num = 1) =>
  [
    ROW_MARKER, id, num, 'jpg',
    'TOKEN', 'photo', 'https://pbs.twimg.com/media/TOKEN.jpg',
    '2024-03-11 07:22:19', '55', 'someone', '"Some One"',
    'https://pbs.twimg.com/profile_images/9/a.jpg', '',
    '0', '"hi"',
  ].join('\t');

/**
 * An archive whose posts each list `listed` files and hold `present` of them —
 * the shape landed.mjs returns.
 */
function archiveOf(ids, { listed = ['1.jpg'], present = listed } = {}) {
  return new Map(ids.map((id) => [
    String(id),
    {
      folder: `2024-03-11_${id}`,
      names: [...present, 'post.json'],
      post: buildPost({
        id: String(id),
        media: listed.map((name) => {
          const [num, ext] = name.split('.');
          return { num, ext };
        }),
      }),
    },
  ]));
}

test('the stopper does nothing on a first run', () => {
  const stop = makeStopper({ archive: archiveOf([1, 2, 3]), threshold: 2, enabled: false });
  assert.equal(stop({ tweetId: '1', count: 1 }), false);
  assert.equal(stop({ tweetId: '2', count: 1 }), false);
  assert.equal(stop({ tweetId: '3', count: 1 }), false);
});

test('the stopper fires after N consecutive posts already on disk', () => {
  const stop = makeStopper({ archive: archiveOf([1, 2, 3]), threshold: 3, enabled: true });
  assert.equal(stop({ tweetId: '1', count: 1 }), false);
  assert.equal(stop({ tweetId: '2', count: 1 }), false);
  assert.equal(stop({ tweetId: '3', count: 1 }), true);
});

test('one unseen post resets the run of known ones', () => {
  const stop = makeStopper({ archive: archiveOf([1, 2, 4, 5]), threshold: 3, enabled: true });
  stop({ tweetId: '1', count: 1 });
  stop({ tweetId: '2', count: 1 });
  assert.equal(stop({ tweetId: '3', count: 1 }), false); // not on disk — resets
  assert.equal(stop({ tweetId: '4', count: 1 }), false);
  assert.equal(stop({ tweetId: '5', count: 1 }), false);
});

test('a post on disk but incomplete does not count as known', () => {
  // Otherwise a sweep retires early over posts it would then have to fetch.
  const archive = archiveOf([1, 2], { listed: ['1.jpg', '2.jpg'], present: ['1.jpg'] });
  const stop = makeStopper({ archive, threshold: 2, enabled: true });
  assert.equal(stop({ tweetId: '1', count: 4 }), false);
  assert.equal(stop({ tweetId: '2', count: 4 }), false);
});

test('a post whose folder has no post.json does not count as known', () => {
  const archive = new Map([['1', { folder: '2024-03-11_1', names: ['1.jpg'], post: null }]]);
  const stop = makeStopper({ archive, threshold: 1, enabled: true });
  assert.equal(stop({ tweetId: '1', count: 1 }), false);
});

/** Posts X can put at the top of a timeline regardless of their age. */
const PIN_BLOCK = 1;

test('the default threshold outlasts X\'s pin block ten times over', () => {
  // X pins exactly one post, and that one is the whole block a re-run walks
  // past: Premium buys a Highlights tab rather than a second pin, and that tab
  // is not the timeline this sweep walks. Ten times it leaves room for the
  // handful of recent posts an edit can reorder. A threshold near the block
  // itself is a stop-at-the-first-thing-you-recognise rule with a number
  // painted on it.
  assert.ok(DEFAULT_ABORT >= PIN_BLOCK * 10);
});

test('the stopper fires inside a timeline of forty posts', () => {
  // The threshold has to sit under the length of a real timeline. Above an
  // account's own post count it never fires, so every re-run enumerates the
  // whole thing no matter how much of it is already on disk.
  const timeline = Array.from({ length: 40 }, (_, i) => String(1000 - i));
  const stop = makeStopper({
    archive: archiveOf(timeline), threshold: DEFAULT_ABORT, enabled: true,
  });
  const stopped = timeline.some((id) => stop({ tweetId: id, count: 1 }));
  assert.ok(stopped, 'a 40-post timeline retires rather than re-sweeping forever');
});

async function fakeGalleryDl(script) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'x-dl-bin-'));
  const bin = path.join(dir, 'fake-gallery-dl');
  await writeFile(bin, `#!/bin/sh\n${script}\n`);
  await chmod(bin, 0o755);
  return bin;
}

test('collect reads printed rows and picks up the account identity', async () => {
  const bin = await fakeGalleryDl(
    [row('10'), row('11')].map((r) => `printf '%s\\n' '${r}'`).join('\n'),
  );
  const result = await collect({ url: 'https://x.com/someone', bin });

  assert.equal(result.rows.length, 2);
  assert.deepEqual(result.account, {
    id: '55',
    handle: 'someone',
    nickname: 'Some One',
    avatar: 'https://pbs.twimg.com/profile_images/9/a.jpg',
    banner: '',
  });
  assert.equal(result.stoppedEarly, false);
  assert.equal(result.failure, null);
});

test('collect ignores gallery-dl chatter interleaved with rows', async () => {
  const bin = await fakeGalleryDl(
    [
      `printf '%s\\n' '[twitter][warning] something'`,
      `printf '%s\\n' '${row('10')}'`,
      `printf '%s\\n' 'downloading...'`,
    ].join('\n'),
  );
  const result = await collect({ url: 'u', bin });
  assert.equal(result.rows.length, 1);
});

test('collect stops the process early when the stopper says so', async () => {
  // Prints two rows then blocks: if the kill did not work, this test would hang
  // rather than fail, which is exactly the failure it guards against.
  //
  // `exec` matters. Without it the shell forks sleep as a child, and killing the
  // shell leaves that child alive holding the inherited stdout pipe open — the
  // suite then sits for the full sleep after every assertion has passed.
  const bin = await fakeGalleryDl(
    [`printf '%s\\n' '${row('10')}'`, `printf '%s\\n' '${row('11')}'`, 'exec sleep 30'].join('\n'),
  );
  const result = await collect({
    url: 'u',
    bin,
    shouldStop: (r) => r.tweetId === '11',
    });

  assert.equal(result.stoppedEarly, true);
  // The row that triggered the stop is not part of the plan: the post it
  // belongs to was never fully enumerated.
  assert.equal(result.rows.length, 1);
  assert.equal(result.failure, null, 'a run we ended ourselves is not a failure');
});

test('collect settles when gallery-dl exits before its output is drained', async () => {
  // The regression this guards: an 'exit' listener attached after the read loop
  // is attached after the event has already fired for a fast-finishing process,
  // and the run then hangs forever on a promise nothing can settle. It was
  // intermittent, so this repeats rather than trying once.
  const bin = await fakeGalleryDl(`printf '%s\\n' '${row('10')}'`);
  for (let i = 0; i < 10; i++) {
    const result = await collect({ url: 'u', bin });
    assert.equal(result.rows.length, 1, `run ${i}`);
    assert.equal(result.failure, null, `run ${i}`);
  }
});

test('collect reports a non-zero exit as a classified failure', async () => {
  const bin = await fakeGalleryDl('echo "HttpError: 429 Too Many Requests" >&2\nexit 1');
  const result = await collect({ url: 'u', bin });
  assert.equal(result.failure, 'rate-limited');
});

test('collect reports an unrecognised failure rather than silence', async () => {
  const bin = await fakeGalleryDl('echo "something went wrong" >&2\nexit 1');
  const result = await collect({ url: 'u', bin });
  assert.equal(result.failure, 'collect-failed');
});

test('collect survives gallery-dl not being installed', async () => {
  const result = await collect({ url: 'u', bin: '/no/such/gallery-dl' });
  assert.equal(result.rows.length, 0);
  assert.ok(result.failure);
});

test('the listing pass spawns through the seam it was handed', async () => {
  // What is spawned is a path into a box this skill built, and a test asserting
  // it must not depend on anything being installed on the machine running it.
  const calls = [];
  const spawnImpl = (bin, args) => {
    calls.push({ bin, args });
    const child = new EventEmitter();
    child.stdout = Readable.from([`${row('10')}\n`]);
    child.stderr = Readable.from([]);
    setImmediate(() => child.emit('spawn'));
    child.stdout.on('end', () => setImmediate(() => child.emit('exit', 0)));
    return child;
  };

  const result = await collect({ url: 'https://x.com/someone', bin: '/box/gallery-dl', spawnImpl });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].bin, '/box/gallery-dl');
  assert.equal(result.rows.length, 1);
  assert.equal(result.failure, null);
});
