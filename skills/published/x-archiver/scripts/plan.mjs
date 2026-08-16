/**
 * plan.mjs — the confirm step, and every block this skill prints.
 *
 * Nothing about an account can be reported before it has been enumerated: not
 * the display name, not how many posts there are, and certainly not how many
 * are new. So a run is split. `--plan` enumerates, diffs against what is on
 * disk, and reports; `--go` downloads what that report described. In between,
 * the list waits in `<folder>/.plan.json`, which is why confirming costs no
 * second enumeration and why what is fetched is exactly what was shown.
 *
 * Every block is rendered here, and the counts are derived in exactly one
 * place. Hand-aligned copies of "how many are there" across two languages is
 * how a run comes to contradict the number the user approved.
 */
import { writeFile, rm } from 'node:fs/promises';
import path from 'node:path';

import { isMissing } from './landed.mjs';
import { readJson } from './cli.mjs';

const PLAN_FILE = '.plan.json';
export const PLAN_VERSION = 1;

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
    post.files.push({ num: row.num, ext: row.ext || '' });
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
export function validatePlan(plan, { account, url, root, folder, now = Date.now() } = {}) {
  if (!plan) return { ok: false, reason: 'no plan has been made for this account yet' };
  if (plan.version !== PLAN_VERSION) return { ok: false, reason: 'the plan was written by a different version of this skill' };

  const age = now - Date.parse(plan.createdAt || '');
  if (!Number.isFinite(age)) return { ok: false, reason: 'the plan has no usable timestamp' };
  if (age > MAX_PLAN_AGE_MS) {
    return { ok: false, reason: `the plan is ${describeAge(age)} old, and a plan expires after 24 hours` };
  }
  if (account && plan.account?.id && String(plan.account.id) !== String(account.id)) {
    return { ok: false, reason: `the plan is for @${plan.account.handle} (id ${plan.account.id}), not this account` };
  }
  // The check that actually fires. `--go` enumerates nothing, so it has no
  // numeric id to compare — the URL it was given is the only handle it has on
  // which account the user means.
  if (url && plan.url && plan.url !== url) {
    return { ok: false, reason: `the plan is for @${plan.account?.handle} (${plan.url}), not this account` };
  }
  if (root && plan.root !== root) {
    return { ok: false, reason: `the plan was made for a different archives root (${plan.root})` };
  }
  if (folder && plan.folder !== folder) {
    return { ok: false, reason: `the plan was made for a different folder (${plan.folder})` };
  }
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
 * Every line here is a question they would otherwise have to ask, and three of
 * them exist because the obvious-looking block would mislead: a folder whose
 * name no longer matches the handle, an archives root that has moved since the
 * last run, and a sweep that stopped early. Without the sweep line, `to fetch
 * 0` cannot be told apart from "gave up before reaching anything new".
 *
 * `previousRoot` is the root recorded in metadata.json *before* this run
 * overwrote it — the caller reads it first and passes it in, because by the
 * time this renders, the file already says the new one.
 */
export function renderPlanBlock(plan, { now = Date.now(), previousRoot = null } = {}) {
  const { account, folder, root, counts, mode, stoppedEarly, abortThreshold, createdAt, named } = plan;
  const lines = [];

  const nickname = account.nickname ? ` (${account.nickname})` : '';
  lines.push(`@${account.handle}${nickname} · id ${account.id}`);

  // A folder whose name no longer matches the handle is not an error and is not
  // renamed — but left unsaid it reads as the wrong account, so it is said.
  // A folder the user named with --name never drifted; it was never the handle.
  const drift = account.handle && !named && folder !== account.handle
    ? `   (folder was created as @${folder})`
    : '';
  lines.push(`  → ${path.join(root, folder)}${drift}`);

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

/** What a finished run reports. The same numbers, after the fact. */
export function renderSummaryBlock({ account, root, folder, fetched, failed, remaining }) {
  const lines = [];
  lines.push(`@${account.handle} · ${path.join(root, folder)}`);
  lines.push(`  downloaded ${n(fetched.posts)} posts · ${n(fetched.files)} files`);
  if (failed) lines.push(`  skipped    ${n(failed)} posts whose media could not be fetched`);
  if (remaining) {
    lines.push(`  remaining  ${n(remaining)} posts still to fetch — re-run the same command with --go`);
  } else {
    lines.push('  the plan is complete');
  }
  return lines.join('\n');
}

export async function savePlan(accountDir, plan) {
  await writeFile(path.join(accountDir, PLAN_FILE), `${JSON.stringify(plan, null, 2)}\n`);
}

export async function loadPlan(accountDir) {
  return readJson(path.join(accountDir, PLAN_FILE));
}

export async function deletePlan(accountDir) {
  await rm(path.join(accountDir, PLAN_FILE), { force: true });
}

