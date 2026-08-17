import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_TTL_HOURS, approved, buildPlan, describeAge, validatePlan } from './plan.mjs';

const HOUR = 3600 * 1000;
const NOW = Date.parse('2026-08-14T10:00:00Z');

const plan = (over = {}) =>
  buildPlan({
    account: { id: 'MS4wSEC', douyin_id: 'abc123', nickname: '小明' },
    collected: [{ id: '7111' }, { id: '7222' }],
    pending: [{ id: '7222' }],
    root: '/data',
    counts: { found: 2, on_disk: 1, to_fetch: 1, platform: {} },
    now: new Date(NOW),
    ...over,
  });

test('the plan carries each post whole, so --go needs no second listing', () => {
  assert.deepEqual(plan().pending, [{ id: '7222' }]);
});

test('the plan carries the counts the finished run will report', () => {
  // Composed once, by the half that did the listing. A --go recomposing them
  // would be describing an account it never listed.
  assert.deepEqual(plan().counts, { found: 2, on_disk: 1, to_fetch: 1, platform: {} });
});

test('--go is handed what the plan counted as new, never the whole listing', () => {
  // The plan saw both posts and counted one as new. Handing over the listing
  // would let a run fetch more than the number the user said yes to.
  assert.deepEqual(approved(plan()), [{ id: '7222' }]);
});

test('a plan with no list to hand over hands over nothing', () => {
  assert.deepEqual(approved({}), []);
  assert.deepEqual(approved(null), []);
});

test('a fresh plan for this account and root may be acted on', () => {
  assert.deepEqual(validatePlan(plan(), { accountId: 'MS4wSEC', root: '/data', now: NOW }), { ok: true });
});

test('no plan at all is refused, not treated as an empty one', () => {
  const missing = validatePlan(null, { root: '/data', now: NOW });
  assert.equal(missing.ok, false);
  assert.equal(missing.code, 'plan-missing');
});

test('a plan past its day is refused, and says how old it is as a number', () => {
  // So that "the plan is nine hours old" needs no parsing back out of a message.
  const stale = validatePlan(plan(), { accountId: 'MS4wSEC', root: '/data', now: NOW + 30 * HOUR });
  assert.equal(stale.ok, false);
  assert.equal(stale.code, 'plan-stale');
  assert.equal(stale.details.age_hours, 30);
  assert.equal(stale.details.ttl_hours, DEFAULT_TTL_HOURS);
  assert.equal(stale.details.created_at, new Date(NOW).toISOString());
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
  assert.equal(wrong.code, 'plan-foreign-account');
});

test('a plan made for another archives root is refused, and names that root', () => {
  const wrong = validatePlan(plan(), { accountId: 'MS4wSEC', root: '/elsewhere', now: NOW });
  assert.equal(wrong.ok, false);
  assert.equal(wrong.code, 'plan-foreign-root');
  assert.equal(wrong.details.plan_root, '/data');
});

test('a plan with nothing left to download is not a plan', () => {
  const empty = validatePlan(plan({ pending: [] }), { accountId: 'MS4wSEC', root: '/data', now: NOW });
  assert.equal(empty.ok, false);
  assert.equal(empty.code, 'plan-empty');
});

test('a plan this build cannot read is refused rather than interpreted', () => {
  // A half-understood plan is a list nobody approved.
  for (const junk of [{ created_at: new Date(NOW).toISOString() }, { pending: 'lots' }, {}]) {
    const verdict = validatePlan(junk, { root: '/data', now: NOW });
    assert.equal(verdict.ok, false, JSON.stringify(junk));
    assert.equal(verdict.code, 'plan-unreadable', JSON.stringify(junk));
  }
});

test('a plan whose timestamp is unreadable is refused', () => {
  // Not something buildPlan can produce — this is a plan already on disk that
  // has been corrupted, and it must refuse rather than compute an age of NaN
  // and let it fall through the comparison as "not older than a day".
  const broken = validatePlan({ ...plan(), created_at: 'sometime' }, { root: '/data', now: NOW });
  assert.equal(broken.ok, false);
  assert.equal(broken.code, 'plan-no-timestamp');
});

test('every way a plan can be refused has its own code', () => {
  // They share one exit code, which is exactly why they must not share an
  // identity: the agent says something different for each.
  const codes = new Set(
    [
      validatePlan(null, { root: '/data', now: NOW }),
      validatePlan({}, { root: '/data', now: NOW }),
      validatePlan({ ...plan(), created_at: 'sometime' }, { root: '/data', now: NOW }),
      validatePlan(plan(), { root: '/data', now: NOW + 30 * HOUR }),
      validatePlan(plan(), { accountId: 'MS4wOTHER', root: '/data', now: NOW }),
      validatePlan(plan(), { root: '/elsewhere', now: NOW }),
      validatePlan(plan({ pending: [] }), { root: '/data', now: NOW }),
    ].map((verdict) => verdict.code),
  );
  assert.equal(codes.size, 7);
});

test('an age reads in the largest unit that is still honest', () => {
  // The fallback sentence only; the refusal carries the number beside it.
  assert.equal(describeAge(30 * 1000), 'less than a minute');
  assert.equal(describeAge(90 * 1000), '1 minute');
  assert.equal(describeAge(3 * HOUR), '3 hours');
  assert.equal(describeAge(72 * HOUR), '3 days');
});
