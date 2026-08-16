/**
 * plan.mjs — the confirm step, and every block this skill prints.
 *
 * Nothing about an account can be reported before it has been enumerated: not
 * the display name, not how many posts there are, and certainly not how many
 * are new. So a run is split. `--plan` enumerates, diffs against what is on
 * disk, and reports; `--go` downloads what that report described. In between,
 * the list waits in `<account>/sync.json`, which is why confirming costs no
 * second enumeration and why what is fetched is exactly what was shown.
 *
 * This module owns what a plan *means*; sync.mjs owns where it lives and how
 * long it lives for. A plan carries no version of its own — sync.json's does the
 * job, and a file it cannot read reads as no plan at all.
 *
 * Every block is rendered here, and the counts are derived in exactly one
 * place. Hand-aligned copies of "how many are there" across two languages is
 * how a run comes to contradict the number the user approved.
 */
import { isMissing } from './landed.mjs';

/** A plan describes a list the user approved. A day later it describes the past. */
export const MAX_PLAN_AGE_MS = 24 * 60 * 60 * 1000;

const VIDEO_EXT = new Set(['mp4', 'm4v', 'mov', 'webm', 'mkv', 'ts']);

/**
 * The per-file rows the listing pass emits, folded into one row per post.
 *
 * Order is preserved as enumerated — newest first — because that is the order
 * `--go` fetches in, and a run stopped partway should have got the recent
 * things rather than an arbitrary slice.
 */
export function groupFiles(rows) {
  const posts = new Map();
  for (const row of rows) {
    const id = String(row.tweetId);
    let post = posts.get(id);
    if (!post) {
      post = {
        tweetId: id,
        date: row.date || '',
        content: row.content || '',
        replyId: row.replyId || '',
        handle: row.user?.name || '',
        count: 0,
        files: [],
      };
      posts.set(id, post);
    }
    post.files.push({
      num: row.num,
      ext: row.ext || '',
      // Already in the shape post.json's media list wants, so the plan's file
      // records are handed to buildPost unchanged. `id` is blank for anything
      // whose basename is not an identity — parseRow decides that, so the rule
      // lives in one place.
      url: row.url || '',
      type: row.type || '',
      id: row.mediaId || '',
    });
    // The extractor reports how many files the post carries; trust it over our
    // own tally, which is short whenever enumeration was cut off mid-post.
    post.count = Math.max(Number(row.count) || 0, post.files.length);
  }
  return [...posts.values()];
}

/** Images versus videos, for the one line of the block that says what you are getting. */
export function classify(posts) {
  let images = 0;
  let videos = 0;
  for (const post of posts) {
    for (const file of post.files) {
      if (VIDEO_EXT.has(String(file.ext).toLowerCase())) videos++;
      else images++;
    }
  }
  return { images, videos };
}

/**
 * What is missing: every enumerated post whose folder does not already hold all
 * of its files. Incomplete counts as missing, so a run that died mid-post is
 * finished rather than abandoned.
 */
export function diff(posts, archive) {
  const toFetch = posts.filter((post) => isMissing(post, archive));

  const foundFiles = posts.reduce((n, p) => n + p.files.length, 0);
  const onDisk = posts.length - toFetch.length;

  return {
    toFetch,
    counts: {
      foundPosts: posts.length,
      foundFiles,
      onDiskPosts: onDisk,
      fetchPosts: toFetch.length,
      fetchFiles: toFetch.reduce((n, p) => n + p.files.length, 0),
      ...classify(toFetch),
    },
  };
}

/**
 * Whether a plan may be acted on.
 *
 * A plan is refused rather than repaired. The alternative to refusing is
 * downloading a list the user never approved — a different account, a different
 * archive, or one collected before the account posted another fifty things.
 */
export function validatePlan(plan, { account, root, now = Date.now() } = {}) {
  if (!plan) return { ok: false, reason: 'no plan has been made for this account yet' };

  const age = now - Date.parse(plan.createdAt || '');
  if (!Number.isFinite(age)) return { ok: false, reason: 'the plan has no usable timestamp' };
  if (age > MAX_PLAN_AGE_MS) {
    return { ok: false, reason: `the plan is ${describeAge(age)} old, and a plan expires after 24 hours` };
  }
  // The only identity check, and it compares ids. `--go` used to have no id to
  // compare and fell back to matching the URL the plan was made from, which was
  // a second answer to this question and a wrong one: an archive made before
  // single-post runs were removed may hold a parked plan whose url names a
  // *post*, and the next account-level --go was refused as "for another account"
  // when it was for this one. Nothing writes such a plan any more, and the ones
  // already on disk still have to load. --go resolves the folder before it reads
  // the plan, and the account.json in that folder has the id.
  if (account?.id && plan.account?.id && String(plan.account.id) !== String(account.id)) {
    return { ok: false, reason: `the plan is for @${plan.account.handle} (id ${plan.account.id}), not this account` };
  }
  if (root && plan.root !== root) {
    return { ok: false, reason: `the plan was made for a different archives root (${plan.root})` };
  }
  // There is no folder check either, and none is needed: a plan is read out of
  // the account folder it was written into, so "a plan for another folder" is
  // not a state that can be reached.
  return { ok: true };
}

export function describeAge(ms) {
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'less than a minute';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'}`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`;
  return `${Math.floor(hours / 24)} days`;
}

const n = (value) => Number(value || 0).toLocaleString('en-US');

/**
 * The block the user answers yes or no to.
 *
 * Every line here is a question they would otherwise have to ask, and two of
 * them exist because the obvious-looking block would mislead: an archives root
 * that has moved since the last run, and a sweep that stopped early. Without the
 * sweep line, `to fetch 0` cannot be told apart from "gave up before reaching
 * anything new".
 *
 * The folder-drift note that used to sit here is gone with the layout that
 * needed it. A folder named for a handle could fall out of step with the
 * account; a folder named for the id or for an alias the user chose cannot, so
 * there is nothing left to warn about — and the path may now be a name rather
 * than a number, which is why the handle and id are on the line above it.
 *
 * `folder` is passed in rather than recomputed from the id. It has to be: the
 * folder may be named for an alias, and a block that derived the path itself
 * would print a different one from the one the run is writing into — which is
 * exactly the sort of second answer this file exists to avoid.
 *
 * `movingTo` is set when `--alias` names somewhere this folder is not yet. A
 * plan performs no move, so it says what a `--go` would do and stops there.
 *
 * `previousRoot` is the root sync.json recorded for the *previous* run — the
 * caller reads it before this run stamps its own, because by the time this
 * renders the file may already say the new one.
 */
export function renderPlanBlock(plan, { now = Date.now(), previousRoot = null, folder, movingTo = null } = {}) {
  const { account, root, counts, mode, stoppedEarly, abortThreshold, createdAt } = plan;
  const lines = [];

  const nickname = account.nickname ? ` (${account.nickname})` : '';
  lines.push(`@${account.handle}${nickname} · id ${account.id}`);
  lines.push(`  → ${folder}`);
  if (movingTo && movingTo !== folder) {
    lines.push(`  moves to ${movingTo} when you --go`);
  }

  // The archive is found by the identity inside it, so a run against another
  // root starts a second one in silence. Left unsaid, its "on disk 0" reads as
  // an account that has lost its files.
  if (previousRoot && previousRoot !== root) {
    lines.push(`  last run used ${previousRoot}`);
  }

  const created = Date.parse(createdAt);
  const age = Number.isFinite(created)
    ? `plan collected ${describeAge(now - created)} ago`
    : 'plan collected just now';
  const sweep = mode === 'full'
    ? 'full sweep'
    : stoppedEarly
      ? `incremental sweep · stopped after ${n(abortThreshold)} consecutive known posts`
      : 'incremental sweep · reached the end of the timeline';
  lines.push(`  ${age} · ${sweep}`);

  lines.push(`  found      ${n(counts.foundPosts)} posts · ${n(counts.foundFiles)} files`);
  lines.push(`  on disk    ${n(counts.onDiskPosts)} posts`);

  const mix = counts.fetchFiles
    ? `   (${n(counts.images)} images, ${n(counts.videos)} videos)`
    : '';
  lines.push(`  to fetch   ${n(counts.fetchPosts)} posts · ${n(counts.fetchFiles)} files${mix}`);

  return lines.join('\n');
}

/**
 * What a finished run reports. The same numbers, after the fact — and, like the
 * plan block, the folder it was actually given rather than one derived here.
 */
export function renderSummaryBlock({ account, folder, fetched, failed, remaining }) {
  const lines = [];
  lines.push(`@${account.handle} · ${folder}`);
  lines.push(`  downloaded ${n(fetched.posts)} posts · ${n(fetched.files)} files`);
  if (failed) lines.push(`  skipped    ${n(failed)} posts whose media could not be fetched`);
  if (remaining) {
    lines.push(`  remaining  ${n(remaining)} posts still to fetch — re-run the same command with --go`);
  } else {
    lines.push('  the plan is complete');
  }
  return lines.join('\n');
}


