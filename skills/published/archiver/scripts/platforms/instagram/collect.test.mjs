import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';

import {
  CATEGORIES,
  DEFAULT_ABORT,
  classify,
  collect,
  collectFeeds,
  diff,
  groupFiles,
  makeStopper,
} from './collect.mjs';
import { ROW_MARKER } from './gallerydl.mjs';
import { buildPost } from '../../shared/post.mjs';
import { outstanding } from '../../shared/landed.mjs';

const row = (shortcode, num = 1) =>
  [
    ROW_MARKER, shortcode, num, 'jpg',
    `m${shortcode}${num}`, 'GraphImage', `https://scontent.cdninstagram.com/${shortcode}_${num}.jpg`,
    '2024-03-11 07:22:19', '55', 'someone', '"Some One"', '"hi"',
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
  const stop = makeStopper({ archive: archiveOf(['A', 'B']), threshold: 2, enabled: false });
  assert.equal(stop({ shortcode: 'A' }), false);
  assert.equal(stop({ shortcode: 'B' }), false);
});

test('the stopper fires after N consecutive posts already on disk', () => {
  const stop = makeStopper({ archive: archiveOf(['A', 'B', 'C']), threshold: 3, enabled: true });
  assert.equal(stop({ shortcode: 'A' }), false);
  assert.equal(stop({ shortcode: 'B' }), false);
  assert.equal(stop({ shortcode: 'C' }), true);
});

test('one unseen post resets the run of known ones', () => {
  const stop = makeStopper({ archive: archiveOf(['A', 'B', 'D', 'E']), threshold: 3, enabled: true });
  stop({ shortcode: 'A' });
  stop({ shortcode: 'B' });
  assert.equal(stop({ shortcode: 'C' }), false); // not on disk — resets
  assert.equal(stop({ shortcode: 'D' }), false);
  assert.equal(stop({ shortcode: 'E' }), false);
});

test('a post on disk but incomplete does not count as known', () => {
  // Otherwise a sweep retires early over posts it would then have to fetch.
  const archive = archiveOf(['A', 'B'], { listed: ['1.jpg', '2.jpg'], present: ['1.jpg'] });
  const stop = makeStopper({ archive, threshold: 2, enabled: true });
  assert.equal(stop({ shortcode: 'A' }), false);
  assert.equal(stop({ shortcode: 'B' }), false);
});

test('the default threshold is generous enough to survive pinned posts', () => {
  // Instagram pins up to three posts to the top of a profile regardless of age,
  // so a small threshold would be a stop-at-the-first-thing-you-recognise rule
  // with a number painted on it.
  assert.ok(DEFAULT_ABORT >= 50);
});

// ---- folding ---------------------------------------------------------------

test('a carousel is one post carrying its files in order', () => {
  const posts = groupFiles([parsed('A', 1), parsed('A', 2), parsed('A', 3)]);
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0].files.map((f) => f.num), [1, 2, 3]);
});

test('a post both feeds reported is one post, not two', () => {
  // The reels pass and the posts pass overlap by design: a reel shows in the
  // profile grid too. Two folders for one post would leave one of them
  // answering for nothing and its media counted by nothing.
  const posts = groupFiles([
    { ...parsed('A'), category: 'posts' },
    { ...parsed('A'), category: 'reels' },
  ]);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].files.length, 1, 'the same file must not be listed twice');
});

test('a post either feed called a reel is a reel', () => {
  // The posts feed carries reels without saying so, so `reels` winning is the
  // answer that cannot undercount.
  const posts = groupFiles([
    { ...parsed('A'), category: 'posts' },
    { ...parsed('A'), category: 'reels' },
  ]);
  assert.equal(posts[0].category, 'reels');
});

test('the classification counts files for media and posts for reels', () => {
  const posts = [
    { category: 'posts', files: [{ ext: 'jpg' }, { ext: 'jpg' }] },
    { category: 'reels', files: [{ ext: 'mp4' }] },
  ];
  assert.deepEqual(classify(posts), { images: 2, videos: 1, reels: 1 });
});

test('the diff offers exactly what the fetch will take, and never more', () => {
  // The one rule this file exists to hold. `--go` decides what to hand the
  // fetcher by calling `outstanding`; a diff that answered this question its own
  // way would offer posts the fetch then skips, and the run would report zero
  // downloaded against everything the user approved.
  const posts = [
    { shortcode: 'A', files: [{ num: 1, ext: 'jpg' }] },
    { shortcode: 'B', files: [{ num: 1, ext: 'jpg' }] },
    { shortcode: 'C', files: [{ num: 1, ext: 'jpg' }, { num: 2, ext: 'jpg' }] },
  ];
  // A landed, a never-seen, and one whose second image never arrived.
  const archive = new Map([
    ...archiveOf(['A']),
    ...archiveOf(['C'], { listed: ['1.jpg', '2.jpg'], present: ['1.jpg'] }),
  ]);
  const result = diff(posts, archive, 'shortcode');

  assert.deepEqual(result.toFetch, outstanding(posts, archive, 'shortcode'));
  assert.deepEqual(result.toFetch.map((p) => p.shortcode), ['B', 'C']);
  assert.equal(result.counts.onDiskPosts, 1);
});

// ---- the process ------------------------------------------------------------

async function fakeGalleryDl(script) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ig-dl-bin-'));
  const bin = path.join(dir, 'fake-gallery-dl');
  await writeFile(bin, `#!/bin/sh\n${script}\n`);
  await chmod(bin, 0o755);
  return bin;
}

test('collect reads printed rows and picks up the account identity', async () => {
  const bin = await fakeGalleryDl(
    [row('A'), row('B')].map((r) => `printf '%s\\n' '${r}'`).join('\n'),
  );
  const result = await collect({ url: 'https://www.instagram.com/someone', bin });

  assert.equal(result.rows.length, 2);
  assert.deepEqual(result.account, { id: '55', username: 'someone', nickname: 'Some One' });
  assert.equal(result.stoppedEarly, false);
  assert.equal(result.failure, null);
});

test('collect ignores gallery-dl chatter interleaved with rows', async () => {
  const bin = await fakeGalleryDl(
    [
      `printf '%s\\n' '[instagram][warning] something'`,
      `printf '%s\\n' '${row('A')}'`,
      `printf '%s\\n' 'downloading...'`,
    ].join('\n'),
  );
  assert.equal((await collect({ url: 'u', bin })).rows.length, 1);
});

test('collect stops the process early when the stopper says so', async () => {
  // Prints two rows then blocks: if the kill did not work this test would hang
  // rather than fail, which is exactly the failure it guards against.
  //
  // `exec` matters. Without it the shell forks sleep as a child, and killing the
  // shell leaves that child alive holding the inherited stdout pipe open — the
  // suite then sits for the full sleep after every assertion has passed.
  const bin = await fakeGalleryDl(
    [`printf '%s\\n' '${row('A')}'`, `printf '%s\\n' '${row('B')}'`, 'exec sleep 30'].join('\n'),
  );
  const result = await collect({ url: 'u', bin, shouldStop: (r) => r.shortcode === 'B' });

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
  const bin = await fakeGalleryDl(`printf '%s\\n' '${row('A')}'`);
  for (let i = 0; i < 10; i++) {
    const result = await collect({ url: 'u', bin });
    assert.equal(result.rows.length, 1, `run ${i}`);
    assert.equal(result.failure, null, `run ${i}`);
  }
});

test('collect reports a non-zero exit as a classified failure', async () => {
  const bin = await fakeGalleryDl('echo "HttpError: 429 Too Many Requests" >&2\nexit 1');
  assert.equal((await collect({ url: 'u', bin })).failure, 'rate-limited');
});

test('collect reports an unrecognised failure rather than silence', async () => {
  const bin = await fakeGalleryDl('echo "something went wrong" >&2\nexit 1');
  assert.equal((await collect({ url: 'u', bin })).failure, 'collect-failed');
});

test('collect survives gallery-dl not being installed', async () => {
  const result = await collect({ url: 'u', bin: '/no/such/gallery-dl' });
  assert.equal(result.rows.length, 0);
  assert.ok(result.failure);
});

// ---- the two passes ---------------------------------------------------------

/**
 * A collector that answers per feed URL, recording what it was asked and every
 * stopper it was handed.
 */
function feeds(byUrl) {
  const calls = [];
  const stoppers = [];
  const impl = async ({ url, onAccount }) => {
    calls.push(url);
    const result = byUrl[url] ?? { rows: [], account: null, stoppedEarly: false, failure: null };
    if (result.account && onAccount) stoppers.push(await onAccount(result.account));
    return { stderr: '', code: 0, ...result };
  };
  return { impl, calls, stoppers };
}

const ACCOUNT = { id: '55', username: 'someone', nickname: 'Some One' };
const PROFILE = 'https://www.instagram.com/someone';

test('both feeds are enumerated, each at its own URL', async () => {
  const { impl, calls } = feeds({
    [`${PROFILE}/posts`]: { rows: [parsed('A')], account: ACCOUNT, stoppedEarly: false, failure: null },
    [`${PROFILE}/reels`]: { rows: [parsed('B')], account: ACCOUNT, stoppedEarly: false, failure: null },
  });

  const result = await collectFeeds({ url: PROFILE, collectImpl: impl });

  assert.deepEqual(calls, [`${PROFILE}/posts`, `${PROFILE}/reels`]);
  assert.deepEqual(result.rows.map((r) => [r.shortcode, r.category]), [['A', 'posts'], ['B', 'reels']]);
});

test('each pass reports its own sweep, because each stops on its own', async () => {
  // One merged verdict could not say which feed was cut short, and "the sweep
  // may be short" without saying of what is a sentence nobody can act on.
  const { impl } = feeds({
    [`${PROFILE}/posts`]: { rows: [parsed('A')], account: ACCOUNT, stoppedEarly: true, failure: null },
    [`${PROFILE}/reels`]: { rows: [], account: null, stoppedEarly: false, failure: null },
  });

  const result = await collectFeeds({ url: PROFILE, collectImpl: impl });
  assert.deepEqual(result.sweeps, [
    { category: 'posts', stoppedEarly: true },
    { category: 'reels', stoppedEarly: false },
  ]);
});

test('the account is resolved once, however many passes run', async () => {
  // Resolving the folder and reading the archive again would be the same work
  // for the same answer — and the second read would see the first pass's writes.
  let resolved = 0;
  const { impl } = feeds({
    [`${PROFILE}/posts`]: { rows: [parsed('A')], account: ACCOUNT, stoppedEarly: false, failure: null },
    [`${PROFILE}/reels`]: { rows: [parsed('B')], account: ACCOUNT, stoppedEarly: false, failure: null },
  });

  await collectFeeds({
    url: PROFILE,
    collectImpl: impl,
    onAccount: () => {
      resolved += 1;
      return { archive: new Map(), incremental: true };
    },
  });

  assert.equal(resolved, 1);
});

test('each pass gets a fresh stopper, so one feed cannot end the next', async () => {
  // The consecutive counter is per feed. Sharing one would carry the streak off
  // the end of the posts feed into the first row of the reels feed and stop it
  // before it had begun.
  const { impl, stoppers } = feeds({
    [`${PROFILE}/posts`]: { rows: [parsed('A')], account: ACCOUNT, stoppedEarly: false, failure: null },
    [`${PROFILE}/reels`]: { rows: [parsed('B')], account: ACCOUNT, stoppedEarly: false, failure: null },
  });

  // Two posts already on disk and a threshold of two: the first pass exhausts
  // the streak, and the second must still start from zero.
  await collectFeeds({
    url: PROFILE,
    collectImpl: impl,
    threshold: 2,
    onAccount: () => ({ archive: archiveOf(['A', 'B']), incremental: true }),
  });

  assert.equal(stoppers.length, 2);
  assert.notEqual(stoppers[0], stoppers[1], 'the two passes share one stopper');
  // The second pass's counter is its own: one known post is not two.
  assert.equal(stoppers[1]({ shortcode: 'A' }), false);
});

test('an account with no feed posts is still identified by its reels', async () => {
  const { impl } = feeds({
    [`${PROFILE}/posts`]: { rows: [], account: null, stoppedEarly: false, failure: null },
    [`${PROFILE}/reels`]: { rows: [parsed('B')], account: ACCOUNT, stoppedEarly: false, failure: null },
  });

  const result = await collectFeeds({ url: PROFILE, collectImpl: impl });
  assert.deepEqual(result.account, ACCOUNT);
});

test('a feed that failed ends the collection rather than half-reporting', async () => {
  // A plan built from half a listing compares the archive against half an
  // account, and reports the rest as up to date.
  const { impl, calls } = feeds({
    [`${PROFILE}/posts`]: { rows: [parsed('A')], account: ACCOUNT, stoppedEarly: false, failure: null },
    [`${PROFILE}/reels`]: { rows: [], account: null, stoppedEarly: false, failure: 'rate-limited' },
  });

  const result = await collectFeeds({ url: PROFILE, collectImpl: impl });
  assert.equal(result.failure, 'rate-limited');
  assert.equal(calls.length, 2);
});

test('a first feed that failed does not go on to the second', async () => {
  const { impl, calls } = feeds({
    [`${PROFILE}/posts`]: { rows: [], account: null, stoppedEarly: false, failure: 'checkpoint-required' },
  });

  const result = await collectFeeds({ url: PROFILE, collectImpl: impl });
  assert.equal(result.failure, 'checkpoint-required');
  assert.deepEqual(calls, [`${PROFILE}/posts`], 'a held account must not be asked a second time');
});

test('the categories are the two feeds this archives, and no others', () => {
  // Stories and highlights are deliberately absent: a story is gone within a
  // day, which no incremental re-run can be honest about.
  assert.deepEqual(CATEGORIES, ['posts', 'reels']);
});

test('the listing pass spawns through the seam it was handed', async () => {
  // What is spawned is a path into a box this skill built, and a test asserting
  // it must not depend on anything being installed on the machine running it.
  const calls = [];
  const spawnImpl = (bin, args) => {
    calls.push({ bin, args });
    const child = new EventEmitter();
    child.stdout = Readable.from([`${row('A')}\n`]);
    child.stderr = Readable.from([]);
    setImmediate(() => child.emit('spawn'));
    child.stdout.on('end', () => setImmediate(() => child.emit('exit', 0)));
    return child;
  };

  const result = await collect({ url: PROFILE, bin: '/box/gallery-dl', spawnImpl });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].bin, '/box/gallery-dl');
  assert.equal(result.rows.length, 1);
});

/** One parsed row, the shape `parseRow` returns. */
function parsed(shortcode, num = 1) {
  return {
    shortcode,
    num,
    ext: 'jpg',
    mediaId: `m${shortcode}${num}`,
    type: 'GraphImage',
    url: `https://scontent.cdninstagram.com/${shortcode}_${num}.jpg`,
    date: '2024-03-11 07:22:19',
    user: { id: '55', name: 'someone', nick: 'Some One' },
    content: 'hi',
  };
}
