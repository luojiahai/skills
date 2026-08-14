/**
 * Tests for plan.mjs — run with:
 *   node --test scripts/*.test.mjs
 *
 * Only the pure functions are covered here: the diff, the validation rules and
 * the rendering. The CLI around them is exercised by hand against the live
 * site, which no test can stand in for.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  archivedIds,
  buildPlan,
  pendingUrls,
  statusBlock,
  summaryBlock,
  unlistedArchivedIds,
  unlistedCountFromPlan,
  validatePlan,
  videoBlock,
  videoIdFrom,
} from './plan.mjs';

const HOUR = 3600 * 1000;

test('videoIdFrom reads the id out of a video URL', () => {
  assert.equal(videoIdFrom('https://www.douyin.com/video/7112233445566'), '7112233445566');
  assert.equal(videoIdFrom('https://www.douyin.com/user/MS4w?modal_id=7112233445566'), '7112233445566');
  assert.equal(videoIdFrom('https://www.douyin.com/user/MS4w'), null);
});

test('archivedIds takes the id from yt-dlp archive lines', () => {
  const ids = archivedIds('douyin 7111\ndouyin 7222\n\n  douyin 7333  \n');
  assert.deepEqual([...ids], ['7111', '7222', '7333']);
});

test('archivedIds treats a missing archive as nothing downloaded', () => {
  assert.equal(archivedIds(null).size, 0);
  assert.equal(archivedIds('').size, 0);
});

test('pendingUrls keeps only what the archive does not have, in feed order', () => {
  const collected = [
    'https://www.douyin.com/video/7111',
    'https://www.douyin.com/video/7222',
    'https://www.douyin.com/video/7333',
  ];
  assert.deepEqual(pendingUrls(collected, 'douyin 7222\n'), [
    'https://www.douyin.com/video/7111',
    'https://www.douyin.com/video/7333',
  ]);
});

test('pendingUrls de-duplicates and drops unparseable lines', () => {
  const collected = [
    'https://www.douyin.com/video/7111',
    'https://www.douyin.com/video/7111',
    'not-a-url',
  ];
  assert.deepEqual(pendingUrls(collected, ''), ['https://www.douyin.com/video/7111']);
});

test('pendingUrls is empty when everything is already archived', () => {
  const collected = ['https://www.douyin.com/video/7111'];
  assert.deepEqual(pendingUrls(collected, 'douyin 7111\n'), []);
});

test('unlistedArchivedIds finds what the archive holds and the listing has dropped', () => {
  const collected = [
    'https://www.douyin.com/video/7111',
    'https://www.douyin.com/video/7222',
  ];
  assert.deepEqual(unlistedArchivedIds(collected, 'douyin 7111\ndouyin 7333\n'), ['7333']);
});

test('unlistedArchivedIds is empty when the listing covers the archive', () => {
  const collected = [
    'https://www.douyin.com/video/7111',
    'https://www.douyin.com/video/7222',
  ];
  // The listing may run ahead of the archive — that is pendingUrls' business,
  // not this one's.
  assert.deepEqual(unlistedArchivedIds(collected, 'douyin 7111\n'), []);
  assert.deepEqual(unlistedArchivedIds(collected, ''), []);
});

test('unlistedArchivedIds counts the whole archive when nothing was collected', () => {
  assert.deepEqual(unlistedArchivedIds([], 'douyin 7111\n'), ['7111']);
});

test('unlistedCountFromPlan counts what a finished run holds and the listing dropped', () => {
  const plan = { collected: ['https://www.douyin.com/video/7111'] };
  assert.equal(unlistedCountFromPlan(plan, 'douyin 7111\ndouyin 7333\n'), 1);
  assert.equal(unlistedCountFromPlan(plan, 'douyin 7111\n'), 0);
});

test('unlistedCountFromPlan says unknown, not zero, for a plan with no collected list', () => {
  // A plan written before the note existed. Zero would assert the archive is
  // fully listed; null renders as no note at all.
  assert.equal(unlistedCountFromPlan({ collected_count: 86 }, 'douyin 7111\n'), null);
  assert.equal(unlistedCountFromPlan({}, 'douyin 7111\n'), null);
  assert.equal(unlistedCountFromPlan(null, 'douyin 7111\n'), null);
});

function samplePlan(overrides = {}) {
  return buildPlan({
    meta: {
      sec_uid: 'MS4wSEC',
      douyin_id: 'abc123',
      nickname: '小明',
      reported_works_count: 284,
    },
    collected: ['https://www.douyin.com/video/7111', 'https://www.douyin.com/video/7222'],
    pending: ['https://www.douyin.com/video/7222'],
    folder: '/data/abc123',
    downloadsRoot: '/data',
    now: new Date('2026-08-14T10:00:00Z'),
    ...overrides,
  });
}

test('buildPlan records identity, root and both lists', () => {
  const plan = samplePlan();
  assert.equal(plan.sec_uid, 'MS4wSEC');
  assert.equal(plan.douyin_id, 'abc123');
  assert.equal(plan.nickname, '小明');
  assert.equal(plan.downloads_root, '/data');
  assert.equal(plan.folder, '/data/abc123');
  assert.equal(plan.reported_works_count, 284);
  assert.equal(plan.collected.length, 2);
  assert.deepEqual(plan.pending, ['https://www.douyin.com/video/7222']);
  assert.equal(plan.created_at, '2026-08-14T10:00:00.000Z');
});

const CHECK = {
  secUid: 'MS4wSEC',
  douyinId: 'abc123',
  folder: '/data/abc123',
  downloadsRoot: '/data',
  now: new Date('2026-08-14T10:05:00Z'),
  ttlHours: 24,
};

test('validatePlan accepts a fresh plan for the same account and root', () => {
  assert.equal(validatePlan(samplePlan(), CHECK), null);
});

test('validatePlan rejects a missing plan', () => {
  const err = validatePlan(null, CHECK);
  assert.match(err.message, /no plan/);
});

test('validatePlan rejects a plan past its TTL', () => {
  const err = validatePlan(samplePlan(), {
    ...CHECK,
    now: new Date('2026-08-17T10:00:00Z'),
  });
  assert.match(err.message, /3d old/);
});

test('validatePlan accepts a plan just inside its TTL', () => {
  assert.equal(
    validatePlan(samplePlan(), {
      ...CHECK,
      now: new Date(new Date('2026-08-14T10:00:00Z').getTime() + 23 * HOUR),
    }),
    null,
  );
});

test('validatePlan rejects a plan written for another account', () => {
  const err = validatePlan(samplePlan(), { ...CHECK, secUid: 'MS4wOTHER' });
  assert.match(err.message, /different account/);
});

test('validatePlan matches on douyin_id when no sec_uid is known', () => {
  assert.equal(validatePlan(samplePlan(), { ...CHECK, secUid: null }), null);
  const err = validatePlan(samplePlan(), { ...CHECK, secUid: null, douyinId: 'other' });
  assert.match(err.message, /different account/);
});

test('validatePlan rejects a plan written for another root', () => {
  const err = validatePlan(samplePlan(), {
    ...CHECK,
    downloadsRoot: '/elsewhere',
    folder: '/elsewhere/abc123',
  });
  assert.match(err.message, /different downloads root/);
});

test('validatePlan rejects a plan written for another folder under the same root', () => {
  // Same root, different folder — a --name change between plan and go. The
  // root check must not shadow this one.
  const err = validatePlan(samplePlan(), { ...CHECK, folder: '/data/renamed' });
  assert.match(err.message, /different folder \(\/data\/abc123\)/);
});

test('validatePlan reports a stale plan age in hours and minutes, not just days', () => {
  const at = (hours, ttlHours) =>
    validatePlan(samplePlan(), {
      ...CHECK,
      now: new Date(new Date('2026-08-14T10:00:00Z').getTime() + hours * HOUR),
      ttlHours,
    });
  assert.match(at(5, 2).message, /5h old/);
  assert.match(at(0.5, 0.25).message, /30m old/);
});

test('validatePlan rejects a plan with nothing to download', () => {
  const err = validatePlan(samplePlan({ pending: [] }), CHECK);
  assert.match(err.message, /nothing to download/);
});

test('statusBlock reports the account, folder and the three counts', () => {
  const block = statusBlock({
    account: { nickname: '小明', douyin_id: 'abc123' },
    folder: '/data/abc123',
    collected: 282,
    reported: 284,
    onDisk: 245,
    pending: 37,
  });
  assert.match(block, /小明 \(抖音号 abc123\)/);
  assert.match(block, /folder\s+\/data\/abc123/);
  assert.match(block, /collected\s+282 of 284 reported/);
  assert.match(block, /on disk\s+245/);
  assert.match(block, /to fetch\s+37 new/);
});

test('statusBlock says up to date when nothing is pending', () => {
  const block = statusBlock({
    account: { nickname: '小明', douyin_id: 'abc123' },
    folder: '/data/abc123',
    collected: 282,
    reported: 284,
    onDisk: 282,
    pending: 0,
  });
  assert.match(block, /to fetch\s+0 — already up to date/);
});

test('statusBlock notes a downloads root that has moved', () => {
  const block = statusBlock({
    account: { nickname: '小明', douyin_id: 'abc123' },
    folder: '/data/abc123',
    previousRoot: '/proj/downloads',
    downloadsRoot: '/data',
    collected: 282,
    reported: 284,
    onDisk: 245,
    pending: 37,
  });
  assert.match(block, /note\s+last run used \/proj\/downloads/);
});

test('statusBlock stays quiet when the root has not moved', () => {
  const block = statusBlock({
    account: { nickname: '小明', douyin_id: 'abc123' },
    folder: '/data/abc123',
    previousRoot: '/data',
    downloadsRoot: '/data',
    collected: 282,
    reported: 284,
    onDisk: 245,
    pending: 37,
  });
  assert.doesNotMatch(block, /last run used/);
});

test('statusBlock explains a gap between collected and reported', () => {
  const block = statusBlock({
    account: { nickname: '小明', douyin_id: 'abc123' },
    folder: '/data/abc123',
    collected: 282,
    reported: 284,
    onDisk: 0,
    pending: 282,
  });
  assert.match(block, /2 post\(s\) counted but not shown/);
});

test('statusBlock notes archived posts the profile no longer lists', () => {
  const block = statusBlock({
    account: { nickname: '小明', douyin_id: 'abc123' },
    folder: '/data/abc123',
    collected: 86,
    reported: 86,
    onDisk: 87,
    unlisted: 1,
    pending: 0,
  });
  assert.match(block, /note\s+1 archived post no longer on the profile/);
});

test('statusBlock pluralises the archived-post note', () => {
  const block = statusBlock({
    account: { nickname: '小明', douyin_id: 'abc123' },
    folder: '/data/abc123',
    collected: 86,
    reported: 86,
    onDisk: 88,
    unlisted: 2,
    pending: 0,
  });
  assert.match(block, /note\s+2 archived posts no longer on the profile/);
});

test('statusBlock stays quiet when the profile still lists the whole archive', () => {
  const args = {
    account: { nickname: '小明', douyin_id: 'abc123' },
    folder: '/data/abc123',
    collected: 86,
    reported: 86,
    onDisk: 86,
    pending: 0,
  };
  assert.doesNotMatch(statusBlock({ ...args, unlisted: 0 }), /no longer on the profile/);
  // A plan written before this note existed carries no collected list, so the
  // count is unknown rather than zero — say nothing either way.
  assert.doesNotMatch(statusBlock({ ...args, unlisted: null }), /no longer on the profile/);
  assert.doesNotMatch(statusBlock(args), /no longer on the profile/);
});

test('statusBlock prints both notes when the listing is short and the archive is long', () => {
  const block = statusBlock({
    account: { nickname: '小明', douyin_id: 'abc123' },
    folder: '/data/abc123',
    collected: 280,
    reported: 284,
    onDisk: 285,
    unlisted: 5,
    pending: 0,
  });
  assert.match(block, /4 post\(s\) counted but not shown/);
  assert.match(block, /5 archived posts no longer on the profile/);
});

test('statusBlock copes with an unknown reported count', () => {
  const block = statusBlock({
    account: { nickname: null, douyin_id: 'abc123' },
    folder: '/data/abc123',
    collected: 282,
    reported: null,
    onDisk: 0,
    pending: 282,
  });
  assert.match(block, /collected\s+282/);
  assert.doesNotMatch(block, /counted but not shown/);
});

test('archivedIds counts unique ids, whatever the whitespace', () => {
  // The shell reflex is `wc -l`, which disagrees with this on a blank line, a
  // missing trailing newline, or a repeat — and then a finished run reports a
  // total that contradicts the number the user approved.
  assert.equal(archivedIds('douyin 7111\n\ndouyin 7222\ndouyin 7111').size, 2);
});

test('validatePlan rejects a plan whose timestamp is unreadable', () => {
  const plan = samplePlan();
  plan.created_at = 'not-a-date';
  const err = validatePlan(plan, CHECK);
  assert.match(err.message, /no readable timestamp/);
  assert.doesNotMatch(err.message, /NaN/);
});

test('summaryBlock reports in the same columns the plan was approved in', () => {
  const block = summaryBlock({
    account: { nickname: '小明', douyin_id: 'abc123' },
    folder: '/data/abc123',
    collected: 282,
    reported: 284,
    downloaded: 37,
    total: 282,
  });
  assert.match(block, /小明 \(抖音号 abc123\)/);
  assert.match(block, /folder\s+\/data\/abc123/);
  assert.match(block, /collected\s+282 of 284 reported/);
  assert.match(block, /downloaded\s+37 new, 282 total/);
  assert.doesNotMatch(block, /warning/);
});

test('summaryBlock warns when some downloads failed', () => {
  const block = summaryBlock({
    account: { nickname: '小明', douyin_id: 'abc123' },
    folder: '/data/abc123',
    collected: 282,
    reported: 284,
    downloaded: 20,
    total: 265,
    failed: true,
  });
  assert.match(block, /warning\s+some downloads failed — re-run --go/);
});

test('summaryBlock notes archived posts the profile no longer lists', () => {
  const block = summaryBlock({
    account: { nickname: '小明', douyin_id: 'abc123' },
    folder: '/data/abc123',
    collected: 86,
    reported: 86,
    unlisted: 1,
    downloaded: 1,
    total: 87,
  });
  assert.match(block, /collected\s+86 of 86 reported/);
  assert.match(block, /note\s+1 archived post no longer on the profile/);
  assert.match(block, /downloaded\s+1 new, 87 total/);
});

test('summaryBlock stays quiet when the profile still lists the whole archive', () => {
  const args = {
    account: { nickname: '小明', douyin_id: 'abc123' },
    folder: '/data/abc123',
    collected: 86,
    reported: 86,
    downloaded: 1,
    total: 86,
  };
  assert.doesNotMatch(summaryBlock({ ...args, unlisted: 0 }), /no longer on the profile/);
  assert.doesNotMatch(summaryBlock({ ...args, unlisted: null }), /no longer on the profile/);
  assert.doesNotMatch(summaryBlock(args), /no longer on the profile/);
});

test('the two blocks word the archived-post note identically', () => {
  const common = {
    account: { nickname: '小明', douyin_id: 'abc123' },
    folder: '/data/abc123',
    collected: 86,
    reported: 86,
    unlisted: 1,
  };
  const noteOf = (block) => block.split('\n').find((line) => line.includes('no longer'));
  assert.equal(
    noteOf(statusBlock({ ...common, onDisk: 87, pending: 0 })),
    noteOf(summaryBlock({ ...common, downloaded: 1, total: 87 })),
  );
});

test('statusBlock and summaryBlock line their columns up with each other', () => {
  const common = {
    account: { nickname: '小明', douyin_id: 'abc123' },
    folder: '/data/abc123',
    collected: 282,
    reported: 284,
  };
  const column = (block, label) => block.split('\n').find((l) => l.includes(label)).indexOf('282');
  const status = statusBlock({ ...common, onDisk: 282, pending: 0 });
  const summary = summaryBlock({ ...common, downloaded: 0, total: 282 });
  assert.equal(column(status, 'collected'), column(summary, 'collected'));
});

test('videoBlock says whether a single video is already here', () => {
  const args = { account: { douyin_id: 'abc123' }, folder: '/data/abc123', videoId: '7111' };
  assert.match(videoBlock({ ...args, onDisk: false }), /to fetch\s+1 new/);
  assert.match(videoBlock({ ...args, onDisk: true }), /to fetch\s+0 — already downloaded/);
  assert.match(videoBlock({ ...args, onDisk: true }), /抖音号 abc123/);
});
