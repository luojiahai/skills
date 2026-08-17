import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_TTL_HOURS,
  buildPlan,
  describeAge,
  renderPlanBlock,
  renderSummaryBlock,
  validatePlan,
} from './plan.mjs';

const HOUR = 3600 * 1000;
const NOW = Date.parse('2026-08-14T10:00:00Z');

const plan = (over = {}) =>
  buildPlan({
    account: { id: 'MS4wSEC', handle: 'abc123', nickname: '小明' },
    collected: [{ id: '7111' }, { id: '7222' }],
    pending: [{ id: '7222' }],
    root: '/data',
    counts: { found: 2, onDisk: 1, toFetch: 1 },
    now: new Date(NOW),
    ...over,
  });

const counts = (over = {}) => ({ found: 405, onDisk: 0, toFetch: 405, ...over });

// ---- what a plan means -----------------------------------------------------

test('the plan carries each post whole, so --go needs no second listing', () => {
  assert.deepEqual(plan().pending, [{ id: '7222' }]);
});

test('a fresh plan for this account and root may be acted on', () => {
  assert.deepEqual(validatePlan(plan(), { accountId: 'MS4wSEC', root: '/data', now: NOW }), { ok: true });
});

test('no plan at all is refused, not treated as an empty one', () => {
  assert.equal(validatePlan(null, { root: '/data', now: NOW }).ok, false);
});

test('a plan past its day is refused, and says why', () => {
  const stale = validatePlan(plan(), { accountId: 'MS4wSEC', root: '/data', now: NOW + 30 * HOUR });
  assert.equal(stale.ok, false);
  assert.match(stale.reason, /the account may have posted since/);
});

test('a plan just inside its day still stands', () => {
  const fresh = validatePlan(plan(), { accountId: 'MS4wSEC', root: '/data', now: NOW + 23 * HOUR });
  assert.equal(fresh.ok, true);
  assert.equal(DEFAULT_TTL_HOURS, 24);
});

test('a plan made for another account is refused', () => {
  // Acting on it would download a list approved for somebody else.
  const wrong = validatePlan(plan(), { accountId: 'MS4wOTHER', root: '/data', now: NOW });
  assert.equal(wrong.ok, false);
  assert.match(wrong.reason, /different account/);
});

test('a plan made for another archives root is refused', () => {
  const wrong = validatePlan(plan(), { accountId: 'MS4wSEC', root: '/elsewhere', now: NOW });
  assert.equal(wrong.ok, false);
  assert.match(wrong.reason, /different archives root/);
});

test('a plan with nothing left to download is not a plan', () => {
  const empty = validatePlan(plan({ pending: [] }), { accountId: 'MS4wSEC', root: '/data', now: NOW });
  assert.equal(empty.ok, false);
});

test('a plan this build cannot read is refused rather than interpreted', () => {
  // A half-understood plan is a list nobody approved.
  for (const junk of [{ created_at: new Date(NOW).toISOString() }, { pending: 'lots' }, {}]) {
    assert.equal(validatePlan(junk, { root: '/data', now: NOW }).ok, false, JSON.stringify(junk));
  }
});

test('a plan whose timestamp is unreadable is refused', () => {
  // Not something buildPlan can produce — this is a plan already on disk that
  // has been corrupted, and it must refuse rather than compute an age of NaN
  // and let it fall through the comparison as "not older than a day".
  const broken = validatePlan({ ...plan(), created_at: 'sometime' }, { root: '/data', now: NOW });
  assert.equal(broken.ok, false);
  assert.match(broken.reason, /timestamp/);
});

test('an age reads in the largest unit that is still honest', () => {
  assert.equal(describeAge(30 * 1000), 'less than a minute');
  assert.equal(describeAge(90 * 1000), '1 minute');
  assert.equal(describeAge(3 * HOUR), '3 hours');
  assert.equal(describeAge(72 * HOUR), '3 days');
});

// ---- one renderer, for every platform --------------------------------------

test('the block names the account, the folder and the three counts', () => {
  const block = renderPlanBlock({
    headline: '小明 (抖音号 abc123)',
    folder: '/data/douyin/小明',
    counts: counts({ onDisk: 12, toFetch: 393 }),
  });

  assert.match(block, /小明 \(抖音号 abc123\)/);
  assert.match(block, /folder\s+\/data\/douyin\/小明/);
  assert.match(block, /found\s+405/);
  assert.match(block, /on disk\s+12/);
  assert.match(block, /to fetch\s+393 new/);
});

test('nothing to fetch says so rather than printing a bare zero', () => {
  const block = renderPlanBlock({ headline: 'x', folder: '/f', counts: counts({ toFetch: 0 }) });
  assert.match(block, /to fetch\s+0 — already up to date/);
});

test('the renderer never branches on platform — extra facts arrive as text', () => {
  // Douyin has image posts it cannot fetch; X has a sweep that stopped early.
  // Neither is a case in here.
  const douyin = renderPlanBlock({
    headline: '小明 (抖音号 abc123)',
    folder: '/f',
    counts: counts({ foundDetail: 'of 411 reported' }),
    notes: [['4 image posts skipped — not yet supported', '(see github.com/luojiahai/skills/issues/39)']],
  });
  assert.match(douyin, /found\s+405 of 411 reported/);
  assert.match(douyin, /note\s+4 image posts skipped/);
  assert.match(douyin, /\(see github/);

  const x = renderPlanBlock({
    headline: '@jack (Jack) · id 55',
    folder: '/f',
    counts: counts({ toFetchDetail: '· 512 files (400 images, 112 videos)' }),
    notes: ['incremental sweep · stopped after 100 consecutive known posts'],
  });
  assert.match(x, /to fetch\s+405 new · 512 files/);
  assert.match(x, /note\s+incremental sweep/);
});

test('a move is announced and not performed', () => {
  const block = renderPlanBlock({
    headline: 'x',
    folder: '/data/douyin/MS4wSEC',
    movingTo: '/data/douyin/小明',
    counts: counts(),
  });
  assert.match(block, /moves to\s+\/data\/douyin\/小明 — on --go/);
});

test('a folder already where it is going is not announced as moving', () => {
  const block = renderPlanBlock({ headline: 'x', folder: '/f', movingTo: '/f', counts: counts() });
  assert.doesNotMatch(block, /moves to/);
});

test('an archives root that has moved is called out', () => {
  // Left unsaid, a run against a different root starts a second archive in
  // silence and its "on disk 0" reads as an account that has lost its files.
  const block = renderPlanBlock({
    headline: 'x', folder: '/f', root: '/data', previousRoot: '/old', counts: counts(),
  });
  assert.match(block, /note\s+last run used \/old/);
});

test('a root that has not moved says nothing about it', () => {
  const block = renderPlanBlock({
    headline: 'x', folder: '/f', root: '/data', previousRoot: '/data', counts: counts(),
  });
  assert.doesNotMatch(block, /last run used/);
});

test('the summary reports in the columns the plan was approved in', () => {
  const approved = renderPlanBlock({
    headline: '小明 (抖音号 abc123)',
    folder: '/f',
    counts: counts({ foundDetail: 'of 411 reported' }),
  });
  const done = renderSummaryBlock({
    headline: '小明 (抖音号 abc123)',
    folder: '/f',
    counts: counts({ foundDetail: 'of 411 reported' }),
    downloaded: 405,
    total: 405,
  });

  for (const line of ['folder', 'found']) {
    const inPlan = approved.split('\n').find((l) => l.includes(line));
    const inSummary = done.split('\n').find((l) => l.includes(line));
    assert.equal(inPlan, inSummary, `${line} must line up between the two blocks`);
  }
  assert.match(done, /downloaded\s+405 new, 405 total/);
});

test('the summary repeats the notes the approved block showed', () => {
  const done = renderSummaryBlock({
    headline: 'x',
    folder: '/f',
    counts: counts(),
    notes: [['4 image posts skipped — not yet supported']],
    downloaded: 1,
    total: 1,
  });
  assert.match(done, /note\s+4 image posts skipped/);
});

test('a run that lost posts says so, and how to get them', () => {
  const done = renderSummaryBlock({
    headline: 'x', folder: '/f', counts: counts(), downloaded: 400, total: 400, failed: 5,
  });
  assert.match(done, /warning\s+5 posts could not be fetched/);
  assert.match(done, /re-run --go to retry only those/);
});

test('a clean run raises no warning', () => {
  const done = renderSummaryBlock({
    headline: 'x', folder: '/f', counts: counts(), downloaded: 1, total: 1, failed: 0,
  });
  assert.doesNotMatch(done, /warning/);
});

test('both blocks are boxed the same way', () => {
  const a = renderPlanBlock({ headline: 'x', folder: '/f', counts: counts() }).split('\n');
  const b = renderSummaryBlock({ headline: 'x', folder: '/f', counts: counts(), downloaded: 0, total: 0 }).split('\n');
  assert.equal(a[0], b[0]);
  assert.equal(a.at(-1), b.at(-1));
});
