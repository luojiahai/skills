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
import { isMissing, unlistedIds } from './landed.mjs';

/** A plan describes a list the user approved. A day later it describes the past. */
export const DEFAULT_TTL_HOURS = 24;

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

  if (forAnotherAccount(plan, accountId)) {
    return refusal('plan-foreign-account', 'the plan at this folder was made for a different account');
  }

  if (forAnotherRoot(plan, root)) {
    return refusal(
      'plan-foreign-root',
      `the plan was made for a different archives root (${plan.root})`,
      { plan_root: plan.root ?? null },
    );
  }

  if (plan.pending.length === 0) {
    return refusal('plan-empty', 'the plan has nothing left to download');
  }

  return { ok: true };
}

/**
 * Whether a plan parked in this folder lists posts that never landed.
 *
 * `clearPlan` retires a plan only once every post in it is on disk, so one still
 * parked with posts missing is a download that never finished. Usually that is a
 * `--go` that stopped partway, and then the archive is a set with holes in it
 * rather than the unbroken run of newest posts an incremental sweep's stopping
 * rule assumes — a streak of familiar posts at the top proves nothing about what
 * is under them. A run that finds this sweeps the whole account instead.
 *
 * It is also true of a plan nobody ever ran, where the archive is still whole
 * and the full sweep buys nothing. The two cannot be told apart from disk, and
 * this answers yes to both: the cost of the false yes is one slow sweep, and the
 * cost of a false no is an archive that stays short and says it is complete.
 *
 * The evidence is the plan's own list checked against the folders, every time it
 * is read, by the same rule `--go` fetches by. It is not a remembered count
 * sitting beside the archive, so there is nothing here that can come to disagree
 * with what is on disk.
 *
 * **The TTL is deliberately ignored, and that is the point.** Expiry is what
 * makes the hole permanent: `--go` refuses a day-old plan and sends the user
 * back to `--plan`, so the posts the interrupted run never fetched are exactly
 * the ones nothing asks for again. A guard that expired with the plan would
 * protect only the runs that never needed protecting.
 *
 * `pendingCount` in `listing.mjs` computes almost this predicate and does gate
 * on `validatePlan`, because it offers work `--go` has to be willing to accept.
 * The two look alike and must differ.
 *
 * Whose plan it is, and which root it was made for, are `validatePlan`'s own two
 * rules called here rather than restated — the TTL is the one thing the two are
 * allowed to answer differently, so it is the only thing they spell separately.
 * Whether a post is still missing is `landed.mjs`'s single definition, for the
 * same reason `--go` fetches by it.
 */
export function planUnfinished(plan, { accountId, root, archive, postIdKey }) {
  if (!Array.isArray(plan?.pending)) return false;
  if (forAnotherAccount(plan, accountId) || forAnotherRoot(plan, root)) return false;
  return plan.pending.some((post) => isMissing(post ?? {}, archive, postIdKey));
}

/**
 * The only identity check, and it compares ids rather than the URL the plan was
 * made from: `--go` resolves the folder before it reads the plan, and the
 * account.json in that folder has the id. A plan whose url names something other
 * than the account is still that account's plan.
 *
 * A plan that does not say whose it is, or a caller that cannot say whose it is
 * asking about, is not foreign — there is simply nothing to compare.
 */
function forAnotherAccount(plan, accountId) {
  return Boolean(accountId && plan.account?.id && String(plan.account.id) !== String(accountId));
}

/**
 * There is no folder check beside this one, and none is needed: a plan is read
 * out of the account folder it was written into, so "a plan for another folder"
 * is not a state that can be reached.
 */
function forAnotherRoot(plan, root) {
  return Boolean(root && plan.root !== root);
}

function refusal(code, reason, details = null) {
  return { ok: false, code, reason, details };
}

/** The verdict as something a run can hand straight to the serialiser. */
export function planRefusal(verdict) {
  return new Refusal(verdict.code, verdict.reason, { details: verdict.details });
}

/**
 * The ids a collected list names, for diffing against what is on disk.
 *
 * `postIdKey` is what this platform's collected posts call their own id, and
 * comes from the registry in `platforms.mjs`. Written in rather than passed, it
 * would answer for one platform and silently return nothing for the other —
 * which would report an entire archive as unlisted.
 */
export function listedIds(posts, postIdKey) {
  const ids = new Set();
  for (const post of posts ?? []) {
    const id = post?.[postIdKey];
    if (id) ids.add(String(id));
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
export function unlistedCountFromPlan(plan, onDisk, postIdKey) {
  if (!Array.isArray(plan?.collected)) return null;
  return unlistedIds(listedIds(plan.collected, postIdKey), onDisk).length;
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
