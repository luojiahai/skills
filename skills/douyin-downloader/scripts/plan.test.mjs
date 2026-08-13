/**
 * Tests for plan.mjs — run with: node --test scripts/
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
  validatePlan,
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

test('validatePlan rejects a plan with nothing to download', () => {
  const err = validatePlan(samplePlan({ pending: [] }), CHECK);
  assert.match(err.message, /nothing to download/);
});

test('statusBlock reports the account, folder and the three counts', () => {
  const block = statusBlock({
    nickname: '小明',
    douyinId: 'abc123',
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
    nickname: '小明',
    douyinId: 'abc123',
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
    nickname: '小明',
    douyinId: 'abc123',
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
    nickname: '小明',
    douyinId: 'abc123',
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
    nickname: '小明',
    douyinId: 'abc123',
    folder: '/data/abc123',
    collected: 282,
    reported: 284,
    onDisk: 0,
    pending: 282,
  });
  assert.match(block, /2 post\(s\) counted but not shown/);
});

test('statusBlock copes with an unknown reported count', () => {
  const block = statusBlock({
    nickname: null,
    douyinId: 'abc123',
    folder: '/data/abc123',
    collected: 282,
    reported: null,
    onDisk: 0,
    pending: 282,
  });
  assert.match(block, /collected\s+282/);
  assert.doesNotMatch(block, /counted but not shown/);
});
