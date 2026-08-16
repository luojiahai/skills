import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_PLAN_AGE_MS,
  classify,
  describeAge,
  diff,
  groupFiles,
  renderPlanBlock,
  renderSummaryBlock,
  validatePlan,
} from './plan.mjs';
import { buildPost } from './post.mjs';

const rows = [
  { tweetId: '1', num: 1, count: 2, ext: 'jpg', date: '2024-03-11 07:22:19', content: 'a' },
  { tweetId: '1', num: 2, count: 2, ext: 'jpg', date: '2024-03-11 07:22:19', content: 'a' },
  { tweetId: '2', num: 1, count: 1, ext: 'mp4', date: '2024-03-10 07:22:19', content: 'b' },
];

/**
 * One archived post: it says it carries `listed` and the folder holds `present`.
 * The same shape landed.mjs's readArchive returns.
 */
function onDisk(id, listed, present = listed) {
  const media = listed.map((name) => {
    const [num, ext] = name.split('.');
    return { num, ext };
  });
  return [id, { folder: `2024-01-01_${id}`, names: [...present, 'post.json'], post: buildPost({ id, media }) }];
}

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

test('groupFiles carries what post.json needs off the first row', () => {
  const [post] = groupFiles([
    { tweetId: '9', num: 1, count: 1, ext: 'jpg', date: '2024-01-01 00:00:00', content: 'hi', replyId: '42', user: { name: 'someone' } },
  ]);
  assert.equal(post.replyId, '42');
  assert.equal(post.handle, 'someone');
  assert.equal(post.content, 'hi');
});

test('a file record is already in the shape post.json wants', () => {
  // fetch.mjs hands these straight to buildPost. A mapping step between the two
  // would be a second place the media list could be got wrong.
  const [post] = groupFiles([
    { tweetId: '9', num: 1, ext: 'jpg', url: 'https://pbs.twimg.com/media/ABC.jpg', type: 'photo', mediaId: 'ABC' },
  ]);
  assert.deepEqual(post.files, [
    { num: 1, ext: 'jpg', url: 'https://pbs.twimg.com/media/ABC.jpg', type: 'photo', id: 'ABC' },
  ]);
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
  const result = diff(groupFiles(rows), new Map());
  assert.equal(result.toFetch.length, 2);
  assert.equal(result.counts.fetchPosts, 2);
  assert.equal(result.counts.fetchFiles, 3);
  assert.equal(result.counts.onDiskPosts, 0);
});

test('diff omits posts already complete on disk', () => {
  const archive = new Map([onDisk('1', ['1.jpg', '2.jpg'])]);
  const result = diff(groupFiles(rows), archive);
  assert.deepEqual(result.toFetch.map((p) => p.tweetId), ['2']);
  assert.equal(result.counts.onDiskPosts, 1);
});

test('diff re-fetches a post whose files are only half there', () => {
  const archive = new Map([onDisk('1', ['1.jpg', '2.jpg'], ['1.jpg'])]);
  const result = diff(groupFiles(rows), archive);
  assert.deepEqual(result.toFetch.map((p) => p.tweetId), ['1', '2']);
});

test('diff counts found files across every post, fetched or not', () => {
  const archive = new Map([onDisk('1', ['1.jpg', '2.jpg'])]);
  const result = diff(groupFiles(rows), archive);
  assert.equal(result.counts.foundPosts, 2);
  assert.equal(result.counts.foundFiles, 3);
});

const goodPlan = {
  createdAt: new Date(1_700_000_000_000).toISOString(),
  account: { id: '55', handle: 'someone' },
  root: '/data',
  url: 'https://x.com/someone',
};
const now = 1_700_000_000_000 + 60_000;

test('validatePlan accepts a fresh plan for the same account and root', () => {
  assert.equal(validatePlan(goodPlan, { account: { id: '55' }, root: '/data', now }).ok, true);
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

test('validatePlan refuses a plan made for another URL', () => {
  const result = validatePlan(goodPlan, { url: 'https://x.com/other', now });
  assert.equal(result.ok, false);
  assert.match(result.reason, /not this account/);
});

test('validatePlan refuses a plan made for another archives root', () => {
  const result = validatePlan(goodPlan, { root: '/elsewhere', now });
  assert.equal(result.ok, false);
  assert.match(result.reason, /archives root/);
});

test('validatePlan refuses a plan with an unusable timestamp', () => {
  assert.equal(validatePlan({ ...goodPlan, createdAt: 'whenever' }, { now }).ok, false);
});

test('describeAge reads as English at each scale', () => {
  assert.equal(describeAge(30_000), 'less than a minute');
  assert.equal(describeAge(60_000), '1 minute');
  assert.equal(describeAge(4 * 60_000), '4 minutes');
  assert.equal(describeAge(3 * 3_600_000), '3 hours');
  assert.equal(describeAge(72 * 3_600_000), '3 days');
});

const blockPlan = {
  account: { id: '1234567890', handle: 'handle', nickname: 'Display Name' },
  root: './archives',
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
  const out = renderPlanBlock(blockPlan, { now });
  assert.match(out, /@handle \(Display Name\) · id 1234567890/);
  assert.match(out, /found\s+2,041 posts · 3,880 files/);
  assert.match(out, /on disk\s+2,037 posts/);
  assert.match(out, /to fetch\s+4 posts · 11 files\s+\(9 images, 2 videos\)/);
});

test('the block prints the folder the archive is actually in', () => {
  assert.match(renderPlanBlock(blockPlan, { now }), /→ archives\/x\/1234567890/);
});

test('the plan block says when a sweep stopped early', () => {
  assert.match(renderPlanBlock(blockPlan, { now }), /incremental sweep · stopped after 100 consecutive known posts/);
});

test('a sweep that reached the end says so, so "0 new" is unambiguous', () => {
  assert.match(renderPlanBlock({ ...blockPlan, stoppedEarly: false }, { now }), /reached the end of the timeline/);
});

test('a full sweep is named as one', () => {
  assert.match(renderPlanBlock({ ...blockPlan, mode: 'full' }, { now }), /full sweep/);
});

test('the plan block states its own age', () => {
  assert.match(renderPlanBlock(blockPlan, { now }), /plan collected 4 minutes ago/);
});

test('there is no folder-drift note left to print', () => {
  // A folder named for the id cannot fall out of step with the account, so the
  // warning that used to be here has nothing left to warn about.
  assert.doesNotMatch(renderPlanBlock(blockPlan, { now }), /folder was created as/);
});

test('an archive whose archives root moved since the last run says so', () => {
  // The folder is found under the root it was made in, so a run against a
  // different root silently starts a second archive. Unsaid, "on disk 0" reads
  // as an account that lost its files rather than a root that moved.
  const out = renderPlanBlock(blockPlan, { now, previousRoot: '/elsewhere/archives' });
  assert.match(out, /last run used \/elsewhere\/archives/);
});

test('a root that has not moved gets no note', () => {
  assert.doesNotMatch(renderPlanBlock(blockPlan, { now, previousRoot: './archives' }), /last run used/);
  assert.doesNotMatch(renderPlanBlock(blockPlan, { now }), /last run used/);
});

test('the media mix is omitted when there is nothing to fetch', () => {
  const out = renderPlanBlock(
    { ...blockPlan, counts: { ...blockPlan.counts, fetchPosts: 0, fetchFiles: 0, images: 0, videos: 0 } },
    { now },
  );
  assert.match(out, /to fetch\s+0 posts · 0 files$/m);
});

test('the summary block reports what landed and what is left', () => {
  const out = renderSummaryBlock({
    account: { id: '1234567890', handle: 'handle' },
    root: './archives',
    fetched: { posts: 4, files: 11 },
    failed: 0,
    remaining: 0,
  });
  assert.match(out, /@handle · archives\/x\/1234567890/);
  assert.match(out, /downloaded 4 posts · 11 files/);
  assert.match(out, /the plan is complete/);
});

test('a run stopped partway tells the user to run --go again', () => {
  const out = renderSummaryBlock({
    account: { id: '1234567890', handle: 'handle' },
    root: './archives',
    fetched: { posts: 2, files: 5 },
    failed: 1,
    remaining: 900,
  });
  assert.match(out, /remaining\s+900 posts still to fetch/);
  assert.match(out, /skipped\s+1 posts whose media could not be fetched/);
});
