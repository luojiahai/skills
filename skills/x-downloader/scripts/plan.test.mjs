import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_PLAN_AGE_MS,
  PLAN_VERSION,
  classify,
  describeAge,
  diff,
  groupFiles,
  renderPlanBlock,
  renderSummaryBlock,
  validatePlan,
} from './plan.mjs';

const rows = [
  { tweetId: '1', num: 1, count: 2, ext: 'jpg', date: '2024-03-11 07:22:19', content: 'a' },
  { tweetId: '1', num: 2, count: 2, ext: 'jpg', date: '2024-03-11 07:22:19', content: 'a' },
  { tweetId: '2', num: 1, count: 1, ext: 'mp4', date: '2024-03-10 07:22:19', content: 'b' },
];

test('groupFiles folds file rows into posts', () => {
  const posts = groupFiles(rows);
  assert.equal(posts.length, 2);
  assert.equal(posts[0].tweetId, '1');
  assert.equal(posts[0].files.length, 2);
  assert.equal(posts[0].count, 2);
});

test('groupFiles preserves enumeration order, newest first', () => {
  assert.deepEqual(groupFiles(rows).map((p) => p.tweetId), ['1', '2']);
});

test('groupFiles carries what text.txt needs off the first row', () => {
  const [post] = groupFiles([
    { tweetId: '9', num: 1, count: 1, ext: 'jpg', date: '2024-01-01 00:00:00', content: 'hi', replyId: '42', user: { name: 'someone' } },
  ]);
  assert.equal(post.replyId, '42');
  assert.equal(post.handle, 'someone');
  assert.equal(post.content, 'hi');
});

test('groupFiles trusts the extractor count over a truncated tally', () => {
  const [post] = groupFiles([{ tweetId: '9', num: 1, count: 4, ext: 'jpg' }]);
  assert.equal(post.count, 4);
  assert.equal(post.files.length, 1);
});

test('groupFiles falls back to its own tally when no count is reported', () => {
  const [post] = groupFiles([
    { tweetId: '9', num: 1, ext: 'jpg' },
    { tweetId: '9', num: 2, ext: 'jpg' },
  ]);
  assert.equal(post.count, 2);
});

test('classify splits images from videos', () => {
  assert.deepEqual(classify(groupFiles(rows)), { images: 2, videos: 1 });
});

test('diff of an empty archive is everything', () => {
  const posts = groupFiles(rows);
  const result = diff(posts, new Map());
  assert.equal(result.toFetch.length, 2);
  assert.equal(result.counts.fetchPosts, 2);
  assert.equal(result.counts.fetchFiles, 3);
  assert.equal(result.counts.onDiskPosts, 0);
});

test('diff omits posts already complete on disk', () => {
  const posts = groupFiles(rows);
  const archive = new Map([['1', { folder: '2024-01-01_1', mediaCount: 2 }]]);
  const result = diff(posts, archive);
  assert.deepEqual(result.toFetch.map((p) => p.tweetId), ['2']);
  assert.equal(result.counts.onDiskPosts, 1);
});

test('diff re-fetches a post whose files are only half there', () => {
  const posts = groupFiles(rows);
  const archive = new Map([['1', { folder: '2024-01-01_1', mediaCount: 1 }]]);
  const result = diff(posts, archive);
  assert.deepEqual(result.toFetch.map((p) => p.tweetId), ['1', '2']);
});

test('diff counts found files across every post, fetched or not', () => {
  const archive = new Map([['1', { folder: '2024-01-01_1', mediaCount: 2 }]]);
  const result = diff(groupFiles(rows), archive);
  assert.equal(result.counts.foundPosts, 2);
  assert.equal(result.counts.foundFiles, 3);
});

const goodPlan = {
  version: PLAN_VERSION,
  createdAt: new Date(1_700_000_000_000).toISOString(),
  account: { id: '55', handle: 'someone' },
  root: '/data',
  folder: 'someone',
};
const now = 1_700_000_000_000 + 60_000;

test('validatePlan accepts a fresh plan for the same account, root and folder', () => {
  const result = validatePlan(goodPlan, {
    account: { id: '55' },
    root: '/data',
    folder: 'someone',
    now,
  });
  assert.equal(result.ok, true);
});

test('validatePlan refuses a missing plan', () => {
  assert.equal(validatePlan(null, { now }).ok, false);
});

test('validatePlan refuses a plan older than 24 hours', () => {
  const result = validatePlan(goodPlan, { now: Date.parse(goodPlan.createdAt) + MAX_PLAN_AGE_MS + 1 });
  assert.equal(result.ok, false);
  assert.match(result.reason, /24 hours/);
});

test('validatePlan refuses a plan made for another account', () => {
  const result = validatePlan(goodPlan, { account: { id: '99' }, now });
  assert.equal(result.ok, false);
  assert.match(result.reason, /not this account/);
});

test('validatePlan refuses a plan made for another downloads root', () => {
  const result = validatePlan(goodPlan, { root: '/elsewhere', now });
  assert.equal(result.ok, false);
  assert.match(result.reason, /downloads root/);
});

test('validatePlan refuses a plan made for another folder', () => {
  const result = validatePlan(goodPlan, { folder: 'other', now });
  assert.equal(result.ok, false);
  assert.match(result.reason, /different folder/);
});

test('validatePlan refuses a plan written by another version', () => {
  const result = validatePlan({ ...goodPlan, version: 999 }, { now });
  assert.equal(result.ok, false);
});

test('validatePlan refuses a plan with an unusable timestamp', () => {
  const result = validatePlan({ ...goodPlan, createdAt: 'whenever' }, { now });
  assert.equal(result.ok, false);
});

test('describeAge reads as English at each scale', () => {
  assert.equal(describeAge(30_000), 'less than a minute');
  assert.equal(describeAge(60_000), '1 minute');
  assert.equal(describeAge(4 * 60_000), '4 minutes');
  assert.equal(describeAge(3 * 3_600_000), '3 hours');
  assert.equal(describeAge(72 * 3_600_000), '3 days');
});

const blockPlan = {
  account: { id: '1234567890', handle: 'handle', nick: 'Display Name' },
  root: './downloads',
  folder: 'handle',
  createdAt: new Date(now - 4 * 60_000).toISOString(),
  mode: 'incremental',
  stoppedEarly: true,
  abortThreshold: 100,
  counts: {
    foundPosts: 2041,
    foundFiles: 3880,
    onDiskPosts: 2037,
    fetchPosts: 4,
    fetchFiles: 11,
    images: 9,
    videos: 2,
  },
};

test('the plan block reports every number the user is approving', () => {
  const out = renderPlanBlock(blockPlan, now);
  assert.match(out, /@handle \(Display Name\) · id 1234567890/);
  assert.match(out, /found\s+2,041 posts · 3,880 files/);
  assert.match(out, /on disk\s+2,037 posts/);
  assert.match(out, /to fetch\s+4 posts · 11 files\s+\(9 images, 2 videos\)/);
});

test('the plan block says when a sweep stopped early', () => {
  const out = renderPlanBlock(blockPlan, now);
  assert.match(out, /incremental sweep · stopped after 100 consecutive known posts/);
});

test('a sweep that reached the end says so, so "0 new" is unambiguous', () => {
  const out = renderPlanBlock({ ...blockPlan, stoppedEarly: false }, now);
  assert.match(out, /reached the end of the timeline/);
});

test('a full sweep is named as one', () => {
  const out = renderPlanBlock({ ...blockPlan, mode: 'full' }, now);
  assert.match(out, /full sweep/);
});

test('the plan block states its own age', () => {
  assert.match(renderPlanBlock(blockPlan, now), /plan collected 4 minutes ago/);
});

test('a folder whose name no longer matches the handle is called out', () => {
  const out = renderPlanBlock({ ...blockPlan, folder: 'oldhandle' }, now);
  assert.match(out, /folder was created as @oldhandle/);
});

test('a folder that matches the handle gets no drift note', () => {
  assert.doesNotMatch(renderPlanBlock(blockPlan, now), /folder was created as/);
});

test('the media mix is omitted when there is nothing to fetch', () => {
  const out = renderPlanBlock(
    { ...blockPlan, counts: { ...blockPlan.counts, fetchPosts: 0, fetchFiles: 0, images: 0, videos: 0 } },
    now,
  );
  assert.match(out, /to fetch\s+0 posts · 0 files$/m);
});

test('the summary block reports what landed and what is left', () => {
  const out = renderSummaryBlock({
    account: { handle: 'handle' },
    root: './downloads',
    folder: 'handle',
    fetched: { posts: 4, files: 11 },
    failed: 0,
    remaining: 0,
  });
  assert.match(out, /downloaded 4 posts · 11 files/);
  assert.match(out, /the plan is complete/);
});

test('a run stopped partway tells the user to run --go again', () => {
  const out = renderSummaryBlock({
    account: { handle: 'handle' },
    root: './downloads',
    folder: 'handle',
    fetched: { posts: 2, files: 5 },
    failed: 1,
    remaining: 900,
  });
  assert.match(out, /remaining\s+900 posts still to fetch/);
  assert.match(out, /skipped\s+1 posts whose media could not be fetched/);
});
