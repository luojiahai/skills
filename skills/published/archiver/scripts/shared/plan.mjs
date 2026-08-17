/**
 * plan.mjs — the confirm step: what a plan is, and when it may be acted on.
 *
 * Nothing about an account can be reported before it has been listed: not the
 * display name, not how many posts there are, and certainly not how many are
 * new. So a run is split. `--plan` lists, diffs against what is on disk, and
 * reports; `--go` downloads what that report described. In between, the list
 * waits in `<account>/sync.json`, which is why confirming costs no second
 * listing and why what is fetched is exactly what was shown.
 *
 * This module owns what a plan *means*; sync.mjs owns where it lives and how
 * long it lives for. A plan carries no version of its own — sync.json's does the
 * job, and a file it cannot read reads as no plan at all.
 */
import { Refusal } from './errors.mjs';

/** A plan describes a list the user approved. A day later it describes the past. */
export const DEFAULT_TTL_HOURS = 24;
export const MAX_PLAN_AGE_MS = DEFAULT_TTL_HOURS * 60 * 60 * 1000;

/**
 * The parked plan.
 *
 * `collected` and `pending` hold each post whole rather than its id, because
 * `--go` writes every `post.json` from the plan and must not have to list the
 * account again to do it.
 *
 * `counts` and `notes` are carried in the shape the finished run will report
 * them in, so a `--go` describes its account without listing it a second time
 * and without either half of the run composing numbers the other did not.
 */
export function buildPlan({ account, collected, pending, root, counts, notes = [], now }) {
  return {
    created_at: now.toISOString(),
    root,
    account,
    counts,
    notes,
    collected,
    pending,
  };
}

/**
 * The posts `--go` fetches: what the approved report counted as new, never more.
 *
 * `pending` is that list. `collected` is everything the listing pass saw, and is
 * kept for one other job — telling a finished run how many archived posts the
 * account no longer lists. Fetching from `collected` would let a run exceed the
 * number the user said yes to: a post that left the disk after the report was
 * made was never counted as new, and the next `--plan` is what offers it.
 *
 * Every platform's `--go` reads its list through here, so the field is named in
 * one place and two platforms cannot come to answer this differently.
 */
export function approved(plan) {
  return plan?.pending ?? [];
}

/**
 * Whether a plan may be acted on: `{ ok: true }`, or `{ ok: false, code, reason,
 * details }`.
 *
 * A plan is refused rather than repaired. The alternative to refusing is
 * downloading a list the user never approved — a different account, a different
 * archive, or one listed before the account posted another fifty things.
 *
 * Each refusal carries its own code, because "the plan is stale" and "the plan
 * is for somebody else" lead the agent to say different things while sharing one
 * exit code.
 */
export function validatePlan(plan, { accountId, root, now = Date.now(), ttlHours = DEFAULT_TTL_HOURS } = {}) {
  if (!plan) {
    return refusal('plan-missing', 'no plan has been made for this account yet');
  }

  // A plan this build cannot read is no plan at all. It is refused rather than
  // interpreted, because a half-understood plan is a list nobody approved.
  if (!Array.isArray(plan.pending)) {
    return refusal('plan-unreadable', 'the plan is not in a shape this build can read');
  }

  const age = now - Date.parse(plan.created_at || '');
  if (!Number.isFinite(age)) {
    return refusal('plan-no-timestamp', 'the plan has no usable timestamp');
  }
  if (age > ttlHours * 60 * 60 * 1000) {
    return refusal(
      'plan-stale',
      `the plan is ${describeAge(age)} old — the account may have posted since it was made`,
      { created_at: plan.created_at, age_hours: Math.round(age / 360_000) / 10, ttl_hours: ttlHours },
    );
  }

  // The only identity check, and it compares ids rather than the URL the plan
  // was made from: --go resolves the folder before it reads the plan, and the
  // account.json in that folder has the id. A plan whose url names something
  // other than the account is still that account's plan.
  if (accountId && plan.account?.id && String(plan.account.id) !== String(accountId)) {
    return refusal('plan-foreign-account', 'the plan at this folder was made for a different account');
  }

  if (root && plan.root !== root) {
    return refusal(
      'plan-foreign-root',
      `the plan was made for a different archives root (${plan.root})`,
      { plan_root: plan.root ?? null },
    );
  }

  // There is no folder check, and none is needed: a plan is read out of the
  // account folder it was written into, so "a plan for another folder" is not a
  // state that can be reached.
  if (plan.pending.length === 0) {
    return refusal('plan-empty', 'the plan has nothing left to download');
  }

  return { ok: true };
}

function refusal(code, reason, details = null) {
  return { ok: false, code, reason, details };
}

/** The verdict as something a run can hand straight to the serialiser. */
export function planRefusal(verdict) {
  return new Refusal(verdict.code, verdict.reason, { details: verdict.details });
}

/** The ids a collected list names, for diffing against what is on disk. */
export function listedIds(posts) {
  const ids = new Set();
  for (const post of posts ?? []) {
    if (post?.id) ids.add(String(post.id));
  }
  return ids;
}

/**
 * How many archived posts the account no longer lists, for a finished run that
 * has only the plan to work from.
 *
 * A plan carrying counts but no `collected` list cannot have this reconstructed
 * from the numbers: an account that had simply posted since would come out
 * looking like a deletion. Unknown is null and says nothing — reporting 0 would
 * assert the archive is fully listed, which is precisely what is not known.
 */
export function unlistedCountFromPlan(plan, onDisk) {
  if (!Array.isArray(plan?.collected)) return null;
  const listed = listedIds(plan.collected);
  return [...onDisk].filter((id) => !listed.has(id)).length;
}

/**
 * An age in the largest unit that is still honest.
 *
 * The only prose left in this module, and it is a fallback: the refusal it lands
 * in carries `age_hours` and `ttl_hours` beside it, so the agent says how old a
 * plan is without reading it back out of a sentence.
 */
export function describeAge(ms) {
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'less than a minute';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'}`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`;
  return `${Math.floor(hours / 24)} days`;
}
