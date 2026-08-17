/**
 * plan.mjs — the confirm step: what a run *would* download, decided before it
 * downloads anything. Also every block this skill prints.
 *
 * Collecting an account's post list takes a browser and about half a minute,
 * so the number a user is asked to approve cannot be known without doing that
 * work first. `--plan` does it once and parks the answer in `<folder>/sync.json`;
 * `--go` hands that same list to the download phase, so confirming costs no
 * second collection and what is fetched is exactly what was shown.
 *
 * The plan carries each post whole — id, caption, timestamp — rather than a list
 * of ids to look up again. That is what lets `--go` name every folder and write
 * every `post.json` without opening a browser at all.
 *
 * This module owns what a plan *means*; sync.mjs owns where it lives and how
 * long it lives for. A plan carries no version of its own — sync.json's does the
 * job, and a file it cannot read reads as no plan at all.
 *
 * The plan carries identity (sec_uid / 抖音号) as well as the list, and that is
 * a guard rather than an index: nothing looks a folder up by it — the folder is
 * the account's sec_uid — but a plan whose identity disagrees with the account
 * being downloaded is refused.
 *
 * It is a cache, not state: the post folders under posts/ are the sole record
 * of what has landed (landed.mjs), and a plan that is missing, stale or
 * written for another account or root is refused rather than repaired.
 *
 * The rendering lives here too, and nowhere else. The block a user approves and
 * the block a finished run reports have to agree — same columns, same rule for
 * counting what is on disk — and they only reliably agree by being the same
 * code. Do not hand-align a second copy of it anywhere.
 */
import { unlistedIds } from './landed.mjs';

export const DEFAULT_TTL_HOURS = 24;

const RULE = '──────────────────────────────────────────';
const LABEL_WIDTH = 11;

/** The ids a collected list names, for diffing against what is on disk. */
export function listedIds(posts) {
  const ids = new Set();
  for (const post of posts ?? []) {
    if (post?.id) ids.add(String(post.id));
  }
  return ids;
}

/**
 * The count of on-disk posts the profile no longer lists, for a finished run,
 * which has only the plan to work from.
 *
 * A plan carrying `collected_count` but no `collected` list cannot have the
 * count reconstructed from the numbers: an account that had simply posted since
 * would come out looking like a deletion. Unknown is returned as null and
 * rendered as nothing — reporting 0 would be asserting the archive is fully
 * listed, which is precisely what is not known.
 */
export function unlistedCountFromPlan(plan, ids) {
  if (!Array.isArray(plan?.collected)) return null;
  return unlistedIds(listedIds(plan.collected), ids).length;
}

export function buildPlan({
  account,
  collected,
  pending,
  archivesRoot,
  reported = null,
  skippedImagePosts = null,
  now,
}) {
  return {
    created_at: now.toISOString(),
    sec_uid: account?.sec_uid ?? null,
    douyin_id: account?.douyin_id ?? null,
    nickname: account?.nickname ?? null,
    archives_root: archivesRoot,
    collected_count: collected.length,
    reported_works_count: reported,
    // Carried so the finished run can repeat the note the approved block
    // showed, without re-reading the collector's metadata.
    skipped_image_posts: skippedImagePosts,
    collected,
    pending,
  };
}

function ageLabel(ms) {
  const minutes = Math.floor(ms / 60000);
  if (minutes >= 1440) return `${Math.floor(minutes / 1440)}d`;
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h`;
  return `${minutes}m`;
}

/**
 * Returns null when the plan may be downloaded, else `{ message }`. Every
 * rejection is deliberate: the alternative to refusing a stale or foreign plan
 * is downloading a list the user never saw.
 */
export function validatePlan(plan, { secUid, douyinId, folder, archivesRoot, now, ttlHours }) {
  if (!plan) return { message: `no plan for this account at ${folder}` };

  // Every identifier the caller *has* must agree, and at least one must be
  // given: a plan matched on a stale 抖音号 while its sec_uid disagrees is a
  // plan for someone else.
  const matched = [
    secUid ? plan.sec_uid === secUid : null,
    douyinId ? plan.douyin_id === douyinId : null,
  ].filter((verdict) => verdict !== null);
  if (!matched.length || matched.some((verdict) => verdict === false)) {
    return {
      message:
        `the plan at ${folder} is for a different account — it was made for ` +
        `抖音号 ${plan.douyin_id ?? '?'}`,
    };
  }

  if (plan.archives_root !== archivesRoot) {
    return {
      message:
        `the plan at ${folder} is for a different archives root — it was made ` +
        `for ${plan.archives_root}, not ${archivesRoot}`,
    };
  }

  // There is no folder check any more, and none is needed: a plan is read out
  // of the account folder it was written into, so "a plan for another folder"
  // is not a state that can be reached.

  const age = now.getTime() - new Date(plan.created_at).getTime();
  if (!Number.isFinite(age)) {
    return { message: `the plan at ${folder} has no readable timestamp — it is corrupt` };
  }
  if (age > ttlHours * 3600 * 1000) {
    return {
      message:
        `the plan is ${ageLabel(age)} old — the account may have posted since ` +
        `it was made`,
    };
  }

  if (!Array.isArray(plan.pending) || plan.pending.length === 0) {
    return { message: `the plan at ${folder} has nothing to download` };
  }

  return null;
}

// ---- rendering -------------------------------------------------------------
// `account` is anything carrying `nickname` and `douyin_id` — a plan and the
// collector's metadata both qualify, which is why it is passed whole rather
// than unpicked into arguments at every call site.

const row = (label, value) => ` ${label.padEnd(LABEL_WIDTH)} ${value}`;
const box = (lines) => [RULE, ...lines, RULE].join('\n');

function headline(account) {
  const id = account?.douyin_id ?? '?';
  return account?.nickname ? ` ${account.nickname} (抖音号 ${id})` : ` 抖音号 ${id}`;
}

/**
 * Why the count in the profile header and the number of cards never match.
 *
 * Skipped image posts are subtracted before the gap is reported: they *were*
 * shown in the grid, they are simply not in the collected list, and counting
 * them here as well would blame them twice — once as skipped, once as hidden.
 */
function hiddenPostRows(collected, reported, skipped) {
  if (reported === null || reported === undefined) return [];
  const hidden = reported - collected - (skipped || 0);
  if (hidden <= 0) return [];
  return [
    row('note', `${hidden} post(s) counted but not shown`),
    ` ${''.padEnd(LABEL_WIDTH)} (private, deleted, or region-locked)`,
  ];
}

/**
 * Why the archive can outnumber both the collected list and the profile's own
 * count. Only what was observed is claimed: an id here and not in the listing
 * reads the same whether the post was deleted, hidden, region-locked or missed
 * by a collection that stopped short, and none of those can be told apart
 * without fetching each one.
 *
 * Unknown — a plan carrying no collected list — is not zero, and says nothing
 * rather than a reassuring nothing.
 */
function unlistedPostRows(unlisted) {
  if (!unlisted) return [];
  return [
    row('note', `${unlisted} archived post${unlisted === 1 ? '' : 's'} no longer on the profile`),
  ];
}

/**
 * Image posts (图文) are collected as a count and nothing else: neither yt-dlp
 * nor gallery-dl can fetch them, so an account's archive is short by however
 * many it has. Reporting the number is what keeps that gap visible rather than
 * silent, until issue #39 closes it.
 */
function skippedImageRows(skipped) {
  if (!skipped) return [];
  return [
    row('note', `${skipped} image post${skipped === 1 ? '' : 's'} skipped — not yet supported`),
    ` ${''.padEnd(LABEL_WIDTH)} (see github.com/luojiahai/skills/issues/39)`,
  ];
}

/**
 * The block a user is asked to approve.
 *
 * `movingTo` is set when --alias or --unalias names somewhere this folder is
 * not yet. A plan performs no move, so it says what a --go would do and stops
 * there: a preview that silently reorganised the archive would be a preview
 * that lied.
 */
export function statusBlock({
  account,
  folder,
  movingTo,
  previousRoot,
  archivesRoot,
  collected,
  reported,
  onDisk,
  unlisted,
  skipped,
  pending,
}) {
  const lines = [headline(account), row('folder', folder)];
  if (movingTo && movingTo !== folder) {
    lines.push(row('moves to', `${movingTo} — on --go`));
  }
  if (previousRoot && archivesRoot && previousRoot !== archivesRoot) {
    lines.push(row('note', `last run used ${previousRoot}`));
  }
  lines.push(
    row('collected', reported === null ? `${collected}` : `${collected} of ${reported} reported`),
    ...hiddenPostRows(collected, reported, skipped),
    ...skippedImageRows(skipped),
    ...unlistedPostRows(unlisted),
    row('on disk', `${onDisk}`),
    row('to fetch', pending === 0 ? '0 — already up to date' : `${pending} new`),
  );
  return box(lines);
}

/** The block a finished run reports, in the columns it was approved in. */
export function summaryBlock({
  account,
  folder,
  collected,
  reported,
  unlisted,
  skipped,
  downloaded,
  total,
  failed,
}) {
  const lines = [
    headline(account),
    row('folder', folder),
    row('collected', reported === null ? `${collected}` : `${collected} of ${reported} reported`),
    ...hiddenPostRows(collected, reported, skipped),
    ...skippedImageRows(skipped),
    ...unlistedPostRows(unlisted),
    row('downloaded', `${downloaded} new, ${total} total`),
  ];
  if (failed) {
    lines.push(row('warning', 'some downloads failed — re-run --go to retry only those'));
  }
  return box(lines);
}
