/**
 * plan.mjs — the confirm step, and every block this skill prints.
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
 *
 * **One renderer, for every platform.** The block a user approves and the block
 * a finished run reports have to agree, and they only reliably agree by being
 * the same code — so the same is true across platforms sharing one archives
 * root. Nothing here branches on which platform is running. What genuinely
 * differs arrives as text the platform wrote: the `headline` naming the account
 * the way that site names accounts, a `detail` beside a count, and `notes` for
 * anything one platform has to say and the other does not — Douyin's
 * unfetchable image posts, X's sweep that stopped early.
 */

/** A plan describes a list the user approved. A day later it describes the past. */
export const DEFAULT_TTL_HOURS = 24;
export const MAX_PLAN_AGE_MS = DEFAULT_TTL_HOURS * 60 * 60 * 1000;

const RULE = '──────────────────────────────────────────';
const LABEL_WIDTH = 11;

const n = (value) => Number(value || 0).toLocaleString('en-US');
const row = (label, value) => ` ${label.padEnd(LABEL_WIDTH)} ${value}`;
const continuation = (value) => ` ${''.padEnd(LABEL_WIDTH)} ${value}`;
const box = (lines) => [RULE, ...lines, RULE].join('\n');

/**
 * The parked plan.
 *
 * `collected` and `pending` hold each post whole rather than its id, because
 * `--go` writes every `post.json` from the plan and must not have to list the
 * account again to do it.
 */
export function buildPlan({
  account,
  collected,
  pending,
  root,
  counts,
  notes = [],
  now,
}) {
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
 * Whether a plan may be acted on: `{ ok }`, or `{ ok: false, reason }`.
 *
 * A plan is refused rather than repaired. The alternative to refusing is
 * downloading a list the user never approved — a different account, a different
 * archive, or one listed before the account posted another fifty things.
 */
export function validatePlan(plan, { accountId, root, now = Date.now(), ttlHours = DEFAULT_TTL_HOURS } = {}) {
  if (!plan) return { ok: false, reason: 'no plan has been made for this account yet' };

  // A plan this build cannot read is no plan at all. It is refused rather than
  // interpreted, because a half-understood plan is a list nobody approved.
  if (!Array.isArray(plan.pending)) {
    return { ok: false, reason: 'the plan is not in a shape this build can read' };
  }

  const age = now - Date.parse(plan.created_at || '');
  if (!Number.isFinite(age)) return { ok: false, reason: 'the plan has no usable timestamp' };
  if (age > ttlHours * 60 * 60 * 1000) {
    return {
      ok: false,
      reason: `the plan is ${describeAge(age)} old — the account may have posted since it was made`,
    };
  }

  // The only identity check, and it compares ids rather than the URL the plan
  // was made from: --go resolves the folder before it reads the plan, and the
  // account.json in that folder has the id. A plan whose url names something
  // other than the account is still that account's plan.
  if (accountId && plan.account?.id && String(plan.account.id) !== String(accountId)) {
    return { ok: false, reason: 'the plan at this folder was made for a different account' };
  }

  if (root && plan.root !== root) {
    return { ok: false, reason: `the plan was made for a different archives root (${plan.root})` };
  }

  // There is no folder check, and none is needed: a plan is read out of the
  // account folder it was written into, so "a plan for another folder" is not a
  // state that can be reached.
  if (plan.pending.length === 0) return { ok: false, reason: 'the plan has nothing left to download' };

  return { ok: true };
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
 * looking like a deletion. Unknown is null and renders as nothing — reporting 0
 * would assert the archive is fully listed, which is precisely what is not known.
 */
export function unlistedCountFromPlan(plan, onDisk) {
  if (!Array.isArray(plan?.collected)) return null;
  const listed = listedIds(plan.collected);
  return [...onDisk].filter((id) => !listed.has(id)).length;
}

export function describeAge(ms) {
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'less than a minute';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'}`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`;
  return `${Math.floor(hours / 24)} days`;
}

/**
 * Notes, as `[label, …continuations]` — a first line beside the `note` label and
 * any further lines indented under it, so a citation or a parenthetical does not
 * have to be squeezed onto one line.
 */
function noteRows(notes) {
  return (notes ?? []).flatMap((note) => {
    const [first, ...rest] = Array.isArray(note) ? note : [note];
    return [row('note', first), ...rest.map(continuation)];
  });
}

/**
 * The block the user answers yes or no to.
 *
 * `folder` is passed in rather than recomputed from the id. It has to be: the
 * folder may be named for an alias, and a block that derived the path itself
 * would print a different one from the one the run is writing into — which is
 * exactly the sort of second answer this file exists to avoid.
 *
 * `movingTo` is set when `--alias` names somewhere this folder is not yet. A
 * plan performs no move, so it says what a `--go` would do and stops there: a
 * preview that silently reorganised the archive would be a preview that lied.
 *
 * `previousRoot` is the root sync.json recorded for the *previous* run — the
 * caller reads it before this run stamps its own, because by the time this
 * renders the file may already say the new one. Left unsaid, a run against a
 * different root starts a second archive in silence, and its `on disk 0` reads
 * as an account that has lost its files.
 */
export function renderPlanBlock({
  headline,
  folder,
  movingTo = null,
  previousRoot = null,
  root = null,
  counts,
  notes = [],
}) {
  const lines = [` ${headline}`, row('folder', folder)];

  if (movingTo && movingTo !== folder) {
    lines.push(row('moves to', `${movingTo} — on --go`));
  }
  if (previousRoot && root && previousRoot !== root) {
    lines.push(row('note', `last run used ${previousRoot}`));
  }

  lines.push(row('found', detailed(counts.found, counts.foundDetail)));
  lines.push(...noteRows(notes));
  lines.push(row('on disk', n(counts.onDisk)));
  lines.push(
    row(
      'to fetch',
      counts.toFetch === 0
        ? '0 — already up to date'
        : detailed(counts.toFetch, counts.toFetchDetail, 'new'),
    ),
  );

  return box(lines);
}

/** What a finished run delivered, in the columns it was approved in. */
export function renderSummaryBlock({ headline, folder, counts, notes = [], downloaded, total, failed }) {
  const lines = [
    ` ${headline}`,
    row('folder', folder),
    row('found', detailed(counts.found, counts.foundDetail)),
    ...noteRows(notes),
    row('downloaded', `${n(downloaded)} new, ${n(total)} total`),
  ];

  if (failed) {
    lines.push(row('warning', `${n(failed)} post${failed === 1 ? '' : 's'} could not be fetched`));
    lines.push(continuation('re-run --go to retry only those'));
  }

  return box(lines);
}

function detailed(count, detail, suffix = '') {
  const head = `${n(count)}${suffix ? ` ${suffix}` : ''}`;
  return detail ? `${head} ${detail}` : head;
}
