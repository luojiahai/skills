#!/usr/bin/env node
/**
 * plan.mjs — the confirm step: what a run *would* download, decided before it
 * downloads anything. Also every block this skill prints.
 *
 * Collecting an account's post list takes a browser and about half a minute,
 * so the number a user is asked to approve cannot be known without doing that
 * work first. `build` does it once and parks the answer in
 * `<folder>/.plan.json`; `load` hands that same list to the download phase, so
 * confirming costs no second collection and what is fetched is exactly what was
 * shown.
 *
 * The plan carries identity (sec_uid / 抖音号) as well as the list, and that is
 * a guard rather than an index: nothing looks a folder up by it — metadata.json
 * is the only thing that answers which folder an account has — but a plan whose
 * identity disagrees with the account being downloaded is refused.
 *
 * It is a cache, not state: the post folders under posts/ are the sole record
 * of what has landed (archive.mjs), and a plan that is missing, stale or
 * written for another account or root is refused rather than repaired. `load`
 * re-checks the plan's list against disk before handing it on, so a --go that
 * died halfway resumes at the first post still missing.
 *
 * The rendering lives here too, and nowhere else. The block a user approves and
 * the block a finished run reports have to agree — same columns, same rule for
 * counting what is on disk — and they only reliably agree by being the same
 * code. An earlier version hand-aligned two further copies of it in shell.
 *
 * Subcommands:
 *   build --meta FILE --urls FILE --folder DIR --downloads ROOT [--url URL]
 *       Diffs the collected list against what is on disk, records the account's
 *       identity in metadata.json, prints the status block, and writes
 *       .plan.json — unless there is nothing to fetch, in which case no plan is
 *       written and the block says so.
 *
 *   load --folder DIR --downloads ROOT [--sec-uid UID] [--douyin-id ID]
 *        --out FILE [--ttl-hours N] [--remedy TEXT]
 *       Validates the plan and writes the URLs still missing from disk to FILE.
 *
 *   count --folder DIR
 *       Prints how many posts are downloaded — the one counting rule.
 *
 *   summary --folder DIR --before N --after N [--exit-status N]
 *       Prints what a finished run delivered.
 *
 *   post --folder DIR --douyin-id ID --post ID
 *       Prints where a single post would land, and whether it is already here.
 *
 *   clear --folder DIR
 *       Removes the plan, once its downloads have all landed.
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isMainModule, optString, parseArgs, readJson, readText, requireOpts } from './cli.mjs';
import { onDiskIds, unlistedIds } from './archive.mjs';
import { readMetadata, writeMetadata } from './metadata.mjs';

const PLAN_FILE = '.plan.json';
export const DEFAULT_TTL_HOURS = 24;

const RULE = '──────────────────────────────────────────';
const LABEL_WIDTH = 11;

/**
 * Cards link as /video/<id>; the modal overlay uses ?modal_id=<id>.
 *
 * The one place a Douyin post URL is turned into an id. /note/ is matched too
 * so that a note id already on disk is recognised rather than reported as
 * unlisted — the collector does not yet emit them (see issue #39), but the
 * folders would still be there once it does.
 */
export function postIdFromUrl(url) {
  const m = String(url).match(/\/(?:video|note)\/(\d+)/) || String(url).match(/modal_id=(\d+)/);
  return m ? m[1] : null;
}

/** The ids a collected URL list names, for diffing against what is on disk. */
export function listedIds(collected) {
  const ids = new Set();
  for (const url of collected ?? []) {
    const id = postIdFromUrl(url);
    if (id) ids.add(id);
  }
  return ids;
}

/** Feed order is preserved, so the download phase runs in the order shown. */
export function pendingUrls(collected, done) {
  const seen = new Set();
  const pending = [];
  for (const url of collected) {
    const id = postIdFromUrl(url);
    if (!id || done.has(id) || seen.has(id)) continue;
    seen.add(id);
    pending.push(url);
  }
  return pending;
}

/**
 * The count of on-disk posts the profile no longer lists, for a finished run,
 * which has only the plan to work from.
 *
 * A plan written before the note existed carries `collected_count` but no
 * `collected` list, and the count cannot be reconstructed from the numbers: an
 * account that had simply posted since would come out looking like a deletion.
 * Unknown is returned as null and rendered as nothing — reporting 0 would be
 * asserting the archive is fully listed, which is precisely what is not known.
 */
export function unlistedCountFromPlan(plan, ids) {
  if (!Array.isArray(plan?.collected)) return null;
  return unlistedIds(listedIds(plan.collected), ids).length;
}

export function buildPlan({ meta, collected, pending, folder, downloadsRoot, now }) {
  return {
    created_at: now.toISOString(),
    sec_uid: meta.sec_uid ?? null,
    douyin_id: meta.douyin_id ?? null,
    nickname: meta.nickname ?? null,
    downloads_root: downloadsRoot,
    folder,
    collected_count: collected.length,
    reported_works_count: meta.reported_works_count ?? null,
    // Carried so the finished run can repeat the note the approved block
    // showed, without re-reading the collector's metadata.
    skipped_image_posts: meta.skipped_image_posts ?? null,
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
export function validatePlan(plan, { secUid, douyinId, folder, downloadsRoot, now, ttlHours }) {
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

  if (plan.downloads_root !== downloadsRoot) {
    return {
      message:
        `the plan at ${folder} is for a different downloads root — it was made ` +
        `for ${plan.downloads_root}, not ${downloadsRoot}`,
    };
  }

  if (plan.folder !== folder) {
    return { message: `the plan is for a different folder (${plan.folder})` };
  }

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
 * Unknown (a plan written before this note existed carries no collected list)
 * is not zero, and says nothing rather than a reassuring nothing.
 */
function unlistedPostRows(unlisted) {
  if (!unlisted) return [];
  return [
    row('note', `${unlisted} archived post${unlisted === 1 ? '' : 's'} no longer on the profile`),
  ];
}

/**
 * Image posts (图文) are collected as a count and nothing else: neither yt-dlp
 * nor gallery-dl can fetch them, and the harvest used to drop them silently, so
 * an account's archive could be short by however many it had with nothing
 * anywhere saying so. Reporting the number is what makes the gap visible until
 * issue #39 closes it.
 */
function skippedImageRows(skipped) {
  if (!skipped) return [];
  return [
    row('note', `${skipped} image post${skipped === 1 ? '' : 's'} skipped — not yet supported`),
    ` ${''.padEnd(LABEL_WIDTH)} (see github.com/luojiahai/skills/issues/39)`,
  ];
}

/** The block a user is asked to approve. */
export function statusBlock({
  account,
  folder,
  previousRoot,
  downloadsRoot,
  collected,
  reported,
  onDisk,
  unlisted,
  skipped,
  pending,
}) {
  const lines = [headline(account), row('folder', folder)];
  if (previousRoot && downloadsRoot && previousRoot !== downloadsRoot) {
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

/** Where a single named post would land, and whether it is already there. */
export function postBlock({ account, folder, postId, onDisk }) {
  return box([
    headline(account),
    row('folder', folder),
    row('post', postId),
    row('to fetch', onDisk ? '0 — already downloaded' : '1 new'),
  ]);
}

// ---- CLI -------------------------------------------------------------------

const planPath = (folder) => path.join(folder, PLAN_FILE);

async function build(opts) {
  requireOpts(opts, 'meta', 'urls', 'folder', 'downloads');
  const meta = (await readJson(opts.meta)) ?? {};
  const collected = (await readText(opts.urls)).split('\n').filter((line) => line.trim());
  const onDisk = await onDiskIds(opts.folder);

  // Read before the write below, and both before the block is printed: the
  // "last run used …" note compares the root this run was given against the one
  // the file recorded, and writing first would leave nothing to compare.
  const previousRoot = (await readMetadata(opts.folder))?.root ?? null;

  // Written here, at the one point every account run passes through once its
  // folder is known, so a folder that exists always says whose it is — before
  // anything has been downloaded into it.
  await writeMetadata(opts.folder, {
    account: { sec_uid: meta.sec_uid, douyin_id: meta.douyin_id, nickname: meta.nickname },
    url: optString(opts, 'url'),
    root: opts.downloads,
    updated_at: new Date().toISOString(),
  });

  const pending = pendingUrls(collected, onDisk);

  if (pending.length) {
    const plan = buildPlan({
      meta,
      collected,
      pending,
      folder: opts.folder,
      downloadsRoot: opts.downloads,
      now: new Date(),
    });
    await mkdir(opts.folder, { recursive: true });
    await writeFile(planPath(opts.folder), JSON.stringify(plan, null, 2) + '\n');
  } else {
    // A plan left over from an earlier run would otherwise outlive the work it
    // described, and --go would happily download it.
    await rm(planPath(opts.folder), { force: true });
  }

  console.log(
    statusBlock({
      account: meta,
      folder: opts.folder,
      previousRoot,
      downloadsRoot: opts.downloads,
      collected: collected.length,
      reported: meta.reported_works_count ?? null,
      onDisk: onDisk.size,
      unlisted: unlistedIds(listedIds(collected), onDisk).length,
      skipped: meta.skipped_image_posts ?? null,
      pending: pending.length,
    }),
  );
}

async function load(opts) {
  requireOpts(opts, 'folder', 'downloads', 'out');
  const plan = await readJson(planPath(opts.folder));
  const error = validatePlan(plan, {
    secUid: optString(opts, 'sec_uid') || null,
    douyinId: optString(opts, 'douyin_id') || null,
    folder: opts.folder,
    downloadsRoot: opts.downloads,
    now: new Date(),
    ttlHours: Number(optString(opts, 'ttl_hours') || DEFAULT_TTL_HOURS),
  });

  if (error) {
    console.error(`error: ${error.message}`);
    const remedy = optString(opts, 'remedy');
    if (remedy) console.error(`  run: ${remedy}`);
    process.exit(2);
  }

  // Re-checked against disk rather than handed on as written. A --go that died
  // partway leaves a plan still listing what it managed to fetch, and without
  // this every one of those would cost a metadata request to discover it was
  // already there — the fast resume the removed .archive.txt used to give.
  const outstanding = pendingUrls(plan.pending, await onDiskIds(opts.folder));
  await writeFile(opts.out, outstanding.length ? outstanding.join('\n') + '\n' : '');
}

async function count(opts) {
  requireOpts(opts, 'folder');
  console.log((await onDiskIds(opts.folder)).size);
}

async function summary(opts) {
  requireOpts(opts, 'folder', 'before', 'after');
  const plan = (await readJson(planPath(opts.folder))) ?? {};
  const onDisk = await onDiskIds(opts.folder);
  console.log(
    summaryBlock({
      account: plan,
      folder: opts.folder,
      collected: plan.collected_count ?? '?',
      reported: plan.reported_works_count ?? null,
      unlisted: unlistedCountFromPlan(plan, onDisk),
      skipped: plan.skipped_image_posts ?? null,
      downloaded: Number(opts.after) - Number(opts.before),
      total: Number(opts.after),
      failed: Number(optString(opts, 'exit_status') || 0) !== 0,
    }),
  );
}

async function post(opts) {
  requireOpts(opts, 'folder', 'douyin_id', 'post');
  console.log(
    postBlock({
      account: { douyin_id: opts.douyin_id, nickname: null },
      folder: opts.folder,
      postId: opts.post,
      onDisk: (await onDiskIds(opts.folder)).has(opts.post),
    }),
  );
}

async function clear(opts) {
  requireOpts(opts, 'folder');
  await rm(planPath(opts.folder), { force: true });
}

// Tests import this file, and it imports metadata.mjs, so the CLI dispatches
// only when it is the entry point — argv alone cannot tell whose arguments
// these are.
if (isMainModule(import.meta.url)) {
  const [command, ...rest] = process.argv.slice(2);
  const commands = { build, load, count, summary, post, clear };
  if (commands[command]) await commands[command](parseArgs(rest));
  else {
    console.error(
      `error: unknown command '${command ?? ''}' (expected ${Object.keys(commands).join('|')})`,
    );
    process.exit(2);
  }
}
