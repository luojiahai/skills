import assert from 'node:assert/strict';
import test from 'node:test';

import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { DEFAULT_ABORT, collect, harvestInPage, parseFeedPayload } from './collect.mjs';
import { postDir } from './fetch.mjs';
import { fakeProfile } from './testing.mjs';
import { makeStopper } from '../../shared/run.mjs';
import { readArchive } from '../../shared/landed.mjs';
import { buildPost, writePost } from '../../shared/post.mjs';

test('a feed response yields a post per entry', () => {
  const posts = parseFeedPayload({
    aweme_list: [
      { aweme_id: '7412', desc: '早安', create_time: 1710144139 },
      { aweme_id: '7413', desc: '', create_time: 1710244139 },
    ],
  });
  assert.deepEqual(posts, [
    { id: '7412', text: '早安', createTime: 1710144139 },
    { id: '7413', text: '', createTime: 1710244139 },
  ]);
});

test('the list is found however the payload wraps it', () => {
  const entry = { aweme_id: '7412', desc: 'x', create_time: 1 };
  for (const payload of [{ aweme_list: [entry] }, { data: { aweme_list: [entry] } }, { data: [entry] }]) {
    assert.equal(parseFeedPayload(payload).length, 1, JSON.stringify(payload));
  }
});

test('an empty caption is a caption, not a missing one', () => {
  // A post can genuinely have no words. Reading that as "unknown" would send
  // fetch.mjs off to ask yt-dlp for a caption that is correctly empty.
  const [post] = parseFeedPayload({ aweme_list: [{ aweme_id: '7412', desc: '', create_time: 1 }] });
  assert.equal(post.text, '');
});

test('a missing caption is unknown, and says so', () => {
  const [post] = parseFeedPayload({ aweme_list: [{ aweme_id: '7412', create_time: 1 }] });
  assert.equal(post.text, null);
});

test('a missing or unusable create_time is unknown rather than zero', () => {
  for (const entry of [
    { aweme_id: '7412' },
    { aweme_id: '7412', create_time: null },
    { aweme_id: '7412', create_time: 'yesterday' },
  ]) {
    assert.equal(parseFeedPayload({ aweme_list: [entry] })[0].createTime, null, JSON.stringify(entry));
  }
});

test('an entry with no usable id is skipped, not guessed at', () => {
  const posts = parseFeedPayload({
    aweme_list: [{ desc: 'no id' }, { aweme_id: '', desc: '' }, { aweme_id: 'not-a-number' }, { aweme_id: '7412' }],
  });
  assert.deepEqual(posts.map((p) => p.id), ['7412']);
});

test('a payload that is not a feed yields nothing rather than throwing', () => {
  // This parses something nobody promised us, read opportunistically off a
  // page. Yielding nothing is survivable: the DOM has already said the post
  // exists and yt-dlp can still be asked what it is.
  for (const junk of [null, undefined, {}, [], 'text', 42, { aweme_list: 'no' }, { data: null }]) {
    assert.deepEqual(parseFeedPayload(junk), [], JSON.stringify(junk));
  }
});

test('a numeric id is carried as a string', () => {
  // Post ids exceed Number.MAX_SAFE_INTEGER, so they are only ever compared and
  // stored as text — one that had been through a Number would name a folder
  // that is off by a digit.
  const [post] = parseFeedPayload({ aweme_list: [{ aweme_id: 7412345678901234567n.toString() }] });
  assert.equal(post.id, '7412345678901234567');
  assert.equal(typeof post.id, 'string');
});

// ---- the harvester, against a page ----------------------------------------
// `harvestInPage` runs inside the browser, so it is driven here against the
// smallest DOM that can express the thing it has to get right: which subtree a
// link is in. What it must never do is file a stranger's post under this
// account — the one mistake in this skill that running the command again cannot
// undo.

/** An element: a tag, its children, and an href if it is a link. */
function el(tag, children = [], href = null) {
  const node = { tagName: tag.toUpperCase(), href, children, parentElement: null };
  node.getAttribute = (name) => (name === 'href' ? node.href : null);
  node.closest = (selector) => {
    const want = selector.toUpperCase();
    for (let p = node; p; p = p.parentElement) if (p.tagName === want) return p;
    return null;
  };
  for (const child of children) child.parentElement = node;
  return node;
}

const link = (href) => el('a', [], href);

/** Runs the in-page harvester against `body`, the way page.evaluate would. */
function harvest(body) {
  const all = [];
  const walk = (node) => {
    if (node.tagName === 'A' && node.href !== null) all.push(node);
    for (const child of node.children) walk(child);
  };
  walk(body);

  const previous = globalThis.document;
  globalThis.document = { querySelectorAll: () => all };
  try {
    return harvestInPage();
  } finally {
    globalThis.document = previous;
  }
}

test('a video link outside the grid is not this account’s post', () => {
  // Douyin renders recommendation rails pointing at other accounts. One outside
  // <footer> and without ?source=Baiduspider is caught by nothing but the grid
  // scope, and collecting it files a stranger's upload under this account.
  const grid = el('div', [link('/video/1'), link('/video/2'), link('/video/3')]);
  const rail = el('div', [link('/video/999')]);
  const body = el('body', [grid, rail]);

  assert.deepEqual(harvest(body).videos, ['1', '2', '3']);
});

test('the footer and the spider links are still excluded', () => {
  const grid = el('div', [link('/video/1'), link('/video/2'), link('/video/3?source=Baiduspider')]);
  const footer = el('footer', [link('/video/900')]);
  const body = el('body', [grid, footer]);

  assert.deepEqual(harvest(body).videos, ['1', '2']);
});

test('image posts are counted separately, from inside the grid', () => {
  const grid = el('div', [
    link('/video/1'),
    link('//www.douyin.com/note/50'),
    link('/video/2'),
  ]);
  const body = el('body', [grid]);

  const { videos, notes } = harvest(body);
  assert.deepEqual(videos, ['1', '2']);
  assert.deepEqual(notes, ['50']);
});

test('a page with too few links to find a grid harvests them all', () => {
  // A first screen that has barely rendered. Nothing is scoped away, and the
  // feed cross-check in collect() is what remains between here and a stranger's
  // post.
  const body = el('body', [el('div', [link('/video/1')])]);
  assert.deepEqual(harvest(body).videos, ['1']);
});

// ---- the stopping rule, through the scroll loop -----------------------------
// A re-run recognising the newest posts stops rather than scrolling the whole
// profile. The rule is fed by the loop, so it is driven here through an injected
// browser: a fake grid, a fake feed, and no page anywhere.

/**
 * An archive of these ids, read back off a real folder rather than assembled
 * here: what the stopper is handed at runtime is `readArchive`'s output keyed by
 * post id, and a key shape that did not match would mean a re-run that silently
 * never stops.
 *
 * `half` names ids whose `post.json` lists a file the folder does not hold.
 */
async function landedArchive(ids, { half = [] } = {}) {
  const missing = new Set(half.map(String));
  const dir = await mkdtemp(path.join(os.tmpdir(), 'douyin-collect-'));
  for (const id of ids.map(String)) {
    const folder = postDir(dir, { id, createTime: 1710144139 });
    await writePost(folder, buildPost({ id, media: missing.has(id) ? [{ file: '1.mp4' }] : [] }));
  }
  return readArchive(dir);
}

/** Ids `from`..`from + count - 1`, as the grid and the feed both spell them. */
const run = (from, count) => Array.from({ length: count }, (_, i) => String(from + i));

/** A listing pass over `rounds`, stopping on `archive` at `threshold`. */
function sweep({ rounds, archive = new Map(), threshold = DEFAULT_ABORT, enabled = true, unattributed = [] }) {
  const { launch, state } = fakeProfile({ rounds, unattributed });
  return collect({
    url: 'https://www.douyin.com/user/MS4w',
    secUid: 'MS4w',
    profileDir: '/unused',
    launch,
    shouldStop: makeStopper({ archive, threshold, enabled }),
  }).then((listing) => ({ listing, state, ids: listing.posts.map((p) => p.id) }));
}

test('a re-run stops at the threshold rather than at the next round', async () => {
  // Ten cards a round, so the twentieth known post lands at the end of the
  // second: a rule that ran one round long would carry the third round's posts.
  const rounds = [{ videos: run(1, 10) }, { videos: run(11, 10) }, { videos: run(21, 10) }];
  const { listing, ids, state } = await sweep({ rounds, archive: await landedArchive(run(1, 30)) });

  assert.equal(listing.stoppedEarly, true);
  assert.deepEqual(ids, run(1, 20));
  assert.equal(state.scrolls, 1, 'it does not scroll again once it has recognised enough');
});

test('a first run never stops early, however much it recognises', async () => {
  // Whether a run may stop at all is settled before the browser opens, by
  // `sweepIsIncremental`. A disabled stopper is what an archive with nothing in
  // it hands down.
  const rounds = [{ videos: run(1, 10) }, { videos: run(11, 10) }, { videos: run(21, 10) }];
  const { listing, ids } = await sweep({ rounds, archive: await landedArchive(run(1, 30)), enabled: false });

  assert.equal(listing.stoppedEarly, false);
  assert.deepEqual(ids, run(1, 30));
});

test('pinned posts at the top of a profile cannot trip it', async () => {
  // Douyin pins up to three posts regardless of age, so the oldest posts in an
  // archive can be the first three cards a re-run meets. A rule that stopped at
  // what it recognised would collect nothing, forever, silently.
  const rounds = [{ videos: ['901', '902', '903', ...run(1, 7)] }, { videos: run(8, 10) }];
  const { listing, ids } = await sweep({ rounds, archive: await landedArchive(['901', '902', '903']) });

  assert.equal(listing.stoppedEarly, false);
  assert.equal(ids.length, 20);
});

test('a stretch of image posts is not the end of the feed', async () => {
  // 图文 never land (#48), so feeding them to the counter would break the streak
  // at every one and no re-run could ever stop. They are not this counter's
  // unit: it counts collected posts, and an image post is not one.
  const rounds = [
    { videos: run(1, 10) },
    { notes: run(500, 30) },
    { videos: run(11, 10) },
    { videos: run(21, 10) },
  ];
  const { listing, ids } = await sweep({ rounds, archive: await landedArchive(run(1, 30)) });

  assert.equal(listing.stoppedEarly, true);
  assert.deepEqual(ids, run(1, 20));
  assert.equal(listing.skippedImagePosts, 30, 'every one of them is still counted');
});

test('a card no feed response named never counts toward the streak', async () => {
  // A recommendation rail is not this account's posts, so one on disk from some
  // other archive must not stand in for a post of theirs. Nineteen known posts
  // and a stranger is nineteen.
  const rounds = [{ videos: [...run(1, 19), '999'] }, { videos: run(20, 10) }];
  const { listing, ids } = await sweep({
    rounds,
    archive: await landedArchive([...run(1, 29), '999']),
    unattributed: ['999'],
  });

  assert.equal(listing.stoppedEarly, true);
  assert.equal(listing.unattributed, 1);
  // The streak reaches twenty one post later than it would have with the
  // stranger counted, which is inside the second round.
  assert.deepEqual(ids, run(1, 29));
});

test('a card no feed response named does not break the streak either', async () => {
  // It is not a post of theirs they have yet to download; it is not their post
  // at all. Resetting on one would let a profile with a rail on it sweep in
  // full forever.
  const rounds = [{ videos: [...run(1, 10), '999', ...run(11, 10)] }, { videos: run(21, 10) }];
  const { listing, ids } = await sweep({ rounds, archive: await landedArchive(run(1, 30)), unattributed: ['999'] });

  assert.equal(listing.stoppedEarly, true);
  assert.deepEqual(ids, run(1, 20));
});

test('a round that renders nothing does not reset the counter', async () => {
  // Rounds and posts are different clocks. A round can yield nothing because
  // the page was still rendering, which says nothing about the posts on either
  // side of it.
  const rounds = [{ videos: run(1, 10) }, {}, {}, { videos: run(11, 10) }, { videos: run(21, 10) }];
  const { listing, ids } = await sweep({ rounds, archive: await landedArchive(run(1, 30)) });

  assert.equal(listing.stoppedEarly, true);
  assert.deepEqual(ids, run(1, 20));
});

test('a post half on disk is not one this run recognises', async () => {
  // Otherwise a sweep retires early over posts it would then have had to fetch
  // anyway. "Landed" is landed.mjs's one definition, on every platform.
  const archive = await landedArchive(run(1, 30), { half: ['5'] });
  const { listing, ids } = await sweep({ rounds: [{ videos: run(1, 30) }], archive });

  assert.equal(listing.stoppedEarly, true);
  assert.deepEqual(ids, run(1, 30), 'the batch already in hand is kept; the next scroll is what is skipped');
  assert.equal(listing.posts.length, 30);
});

test('a sweep that reaches the end of the profile did not stop early', async () => {
  const { listing } = await sweep({ rounds: [{ videos: run(1, 3) }], archive: await landedArchive(run(1, 3)) });
  assert.equal(listing.stoppedEarly, false);
});

/** Posts Douyin can put at the top of a profile regardless of their age. */
const PIN_BLOCK = 3;

test('the default threshold outlasts Douyin’s pin block five times over', () => {
  // Douyin pins up to three 置顶 posts and reorders nothing else, so three cards
  // is the whole block a re-run walks past. Five times it leaves room for the
  // recent posts an edit can reorder. A threshold near the block itself is a
  // stop-at-the-first-thing-you-recognise rule with a number painted on it.
  assert.ok(DEFAULT_ABORT >= PIN_BLOCK * 5);
});
