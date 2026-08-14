#!/usr/bin/env node
/**
 * plan.mjs — the confirm step: what a run *would* download, decided before it
 * downloads anything. Also every block this skill prints.
 *
 * Collecting an account's video list takes a browser and about half a minute,
 * so the number a user is asked to approve cannot be known without doing that
 * work first. `build` does it once and parks the answer in
 * `<folder>/.plan.json`; `load` hands that same list to the download phase, so
 * confirming costs no second collection and what is fetched is exactly what was
 * shown.
 *
 * The plan carries identity (sec_uid / 抖音号) as well as the list. That is what
 * lets `--go` find the folder for an account that has never been downloaded —
 * cursor.json does not exist yet, because no run has happened.
 *
 * It is a cache, not state: .archive.txt remains the sole record of what has
 * landed, and a plan that is missing, stale or written for another account or
 * root is refused rather than repaired.
 *
 * The rendering lives here too, and nowhere else. The block a user approves and
 * the block a finished run reports have to agree — same columns, same rule for
 * counting what is on disk — and they only reliably agree by being the same
 * code. An earlier version hand-aligned two further copies of it in shell.
 *
 * Subcommands:
 *   build --meta FILE --urls FILE --folder DIR --downloads ROOT
 *       Diffs the collected list against the archive, prints the status block,
 *       and writes .plan.json — unless there is nothing to fetch, in which case
 *       no plan is written and the block says so.
 *
 *   load --folder DIR --downloads ROOT [--sec-uid UID] [--douyin-id ID]
 *        --out FILE [--ttl-hours N] [--remedy TEXT]
 *       Validates the plan and writes its pending URLs to FILE.
 *
 *   count --folder DIR
 *       Prints how many videos the archive records — the one counting rule.
 *
 *   summary --folder DIR --before N --after N [--exit-status N]
 *       Prints what a finished run delivered.
 *
 *   video --folder DIR --douyin-id ID --video ID
 *       Prints where a single video would land, and whether it is already here.
 *
 *   clear --folder DIR
 *       Removes the plan, once its downloads have all landed.
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isMainModule, optString, parseArgs, readJson, readText, requireOpts } from './cli.mjs';

export const PLAN_FILE = '.plan.json';
export const DEFAULT_TTL_HOURS = 24;

const RULE = '──────────────────────────────────────────';
const LABEL_WIDTH = 11;

/** Cards link as /video/<id>; the modal overlay uses ?modal_id=<id>. */
export function videoIdFrom(url) {
  const m = String(url).match(/\/video\/(\d+)/) || String(url).match(/modal_id=(\d+)/);
  return m ? m[1] : null;
}

/**
 * yt-dlp writes `<extractor> <id>` per line. The id is the last field, which
 * holds whether or not the extractor name ever changes.
 *
 * This is the only place the archive is counted or searched. Counting its lines
 * instead — which shell makes tempting — disagrees with this the moment a line
 * is blank or a trailing newline is missing, and then the total a run reports
 * contradicts the number the user approved.
 */
export function archivedIds(text) {
  const ids = new Set();
  for (const line of (text ?? '').split('\n')) {
    const fields = line.trim().split(/\s+/).filter(Boolean);
    if (fields.length) ids.add(fields[fields.length - 1]);
  }
  return ids;
}

/** Feed order is preserved, so the download phase runs in the order shown. */
export function pendingUrls(collected, archiveText) {
  const done = archivedIds(archiveText);
  const seen = new Set();
  const pending = [];
  for (const url of collected) {
    const id = videoIdFrom(url);
    if (!id || done.has(id) || seen.has(id)) continue;
    seen.add(id);
    pending.push(url);
  }
  return pending;
}

/**
 * The ids the archive holds that the profile no longer lists — the question
 * pendingUrls asks, the other way round. Derived on every run and never
 * recorded; see README, "Counts will not match".
 */
export function unlistedArchivedIds(collected, archiveText) {
  const listed = new Set();
  for (const url of collected ?? []) {
    const id = videoIdFrom(url);
    if (id) listed.add(id);
  }
  return [...archivedIds(archiveText)].filter((id) => !listed.has(id));
}

/**
 * The same count for a finished run, which has only the plan to work from.
 *
 * A plan written before the note existed carries `collected_count` but no
 * `collected` list, and the count cannot be reconstructed from the numbers: an
 * account that had simply posted since would come out looking like a deletion.
 * Unknown is returned as null and rendered as nothing — reporting 0 would be
 * asserting the archive is fully listed, which is precisely what is not known.
 */
export function unlistedCountFromPlan(plan, archiveText) {
  if (!Array.isArray(plan?.collected)) return null;
  return unlistedArchivedIds(plan.collected, archiveText).length;
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
// `account` is anything carrying `nickname` and `douyin_id` — a plan, a cursor
// and the collector's metadata all qualify, which is why it is passed whole
// rather than unpicked into arguments at every call site.

const row = (label, value) => ` ${label.padEnd(LABEL_WIDTH)} ${value}`;
const box = (lines) => [RULE, ...lines, RULE].join('\n');

function headline(account) {
  const id = account?.douyin_id ?? '?';
  return account?.nickname ? ` ${account.nickname} (抖音号 ${id})` : ` 抖音号 ${id}`;
}

/** Why the count in the profile header and the number of cards never match. */
function hiddenPostRows(collected, reported) {
  if (reported === null || reported === undefined) return [];
  if (!(collected < reported)) return [];
  return [
    row('note', `${reported - collected} post(s) counted but not shown`),
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
  pending,
}) {
  const lines = [headline(account), row('folder', folder)];
  if (previousRoot && downloadsRoot && previousRoot !== downloadsRoot) {
    lines.push(row('note', `last run used ${previousRoot}`));
  }
  lines.push(
    row('collected', reported === null ? `${collected}` : `${collected} of ${reported} reported`),
    ...hiddenPostRows(collected, reported),
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
  downloaded,
  total,
  failed,
}) {
  const lines = [
    headline(account),
    row('folder', folder),
    row('collected', reported === null ? `${collected}` : `${collected} of ${reported} reported`),
    ...hiddenPostRows(collected, reported),
    ...unlistedPostRows(unlisted),
    row('downloaded', `${downloaded} new, ${total} total`),
  ];
  if (failed) {
    lines.push(row('warning', 'some downloads failed — re-run --go to retry only those'));
  }
  return box(lines);
}

/** Where a single named video would land, and whether it is already there. */
export function videoBlock({ account, folder, videoId, onDisk }) {
  return box([
    headline(account),
    row('folder', folder),
    row('video', videoId),
    row('to fetch', onDisk ? '0 — already downloaded' : '1 new'),
  ]);
}

// ---- CLI -------------------------------------------------------------------

const archivePath = (folder) => path.join(folder, '.archive.txt');
const planPath = (folder) => path.join(folder, PLAN_FILE);

async function build(opts) {
  requireOpts(opts, 'meta', 'urls', 'folder', 'downloads');
  const meta = (await readJson(opts.meta)) ?? {};
  const collected = (await readText(opts.urls)).split('\n').filter((line) => line.trim());
  const archive = await readText(archivePath(opts.folder));
  const cursor = await readJson(path.join(opts.folder, 'cursor.json'));

  const pending = pendingUrls(collected, archive);

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
      previousRoot: cursor?.downloads_root ?? null,
      downloadsRoot: opts.downloads,
      collected: collected.length,
      reported: meta.reported_works_count ?? null,
      onDisk: archivedIds(archive).size,
      unlisted: unlistedArchivedIds(collected, archive).length,
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

  await writeFile(opts.out, plan.pending.join('\n') + '\n');
}

async function count(opts) {
  requireOpts(opts, 'folder');
  console.log(archivedIds(await readText(archivePath(opts.folder))).size);
}

async function summary(opts) {
  requireOpts(opts, 'folder', 'before', 'after');
  const plan = (await readJson(planPath(opts.folder))) ?? {};
  const unlisted = unlistedCountFromPlan(plan, await readText(archivePath(opts.folder)));
  console.log(
    summaryBlock({
      account: plan,
      folder: opts.folder,
      collected: plan.collected_count ?? '?',
      reported: plan.reported_works_count ?? null,
      unlisted,
      downloaded: Number(opts.after) - Number(opts.before),
      total: Number(opts.after),
      failed: Number(optString(opts, 'exit_status') || 0) !== 0,
    }),
  );
}

async function video(opts) {
  requireOpts(opts, 'folder', 'douyin_id', 'video');
  const archive = await readText(archivePath(opts.folder));
  console.log(
    videoBlock({
      account: { douyin_id: opts.douyin_id, nickname: null },
      folder: opts.folder,
      videoId: opts.video,
      onDisk: archivedIds(archive).has(opts.video),
    }),
  );
}

async function clear(opts) {
  requireOpts(opts, 'folder');
  await rm(planPath(opts.folder), { force: true });
}

// Tests and cursor.mjs import this file, so the CLI dispatches only when it
// is the entry point — argv alone cannot tell whose arguments these are.
if (isMainModule(import.meta.url)) {
  const [command, ...rest] = process.argv.slice(2);
  const commands = { build, load, count, summary, video, clear };
  if (commands[command]) await commands[command](parseArgs(rest));
  else {
    console.error(
      `error: unknown command '${command ?? ''}' (expected ${Object.keys(commands).join('|')})`,
    );
    process.exit(2);
  }
}
