#!/usr/bin/env node
/**
 * plan.mjs — the confirm step: what a run *would* download, decided before it
 * downloads anything.
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
 *   clear --folder DIR
 *       Removes the plan, once its downloads have all landed.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

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
  if (!Number.isFinite(age) || age > ttlHours * 3600 * 1000) {
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

/**
 * The block a user is asked to approve. It is also what a finished run reports,
 * so the numbers confirmed and the numbers delivered are read off the same
 * rendering.
 */
export function statusBlock({
  nickname,
  douyinId,
  folder,
  previousRoot,
  downloadsRoot,
  collected,
  reported,
  onDisk,
  pending,
}) {
  const lines = [RULE];
  lines.push(` ${nickname ? `${nickname} (抖音号 ${douyinId})` : `抖音号 ${douyinId}`}`);

  const row = (label, value) => lines.push(` ${label.padEnd(LABEL_WIDTH)} ${value}`);

  row('folder', folder);
  if (previousRoot && downloadsRoot && previousRoot !== downloadsRoot) {
    row('note', `last run used ${previousRoot}`);
  }
  row('collected', reported === null ? `${collected}` : `${collected} of ${reported} reported`);
  if (reported !== null && collected < reported) {
    row('note', `${reported - collected} post(s) counted but not shown`);
    lines.push(` ${''.padEnd(LABEL_WIDTH)} (private, deleted, or region-locked)`);
  }
  row('on disk', `${onDisk}`);
  row('to fetch', pending === 0 ? '0 — already up to date' : `${pending} new`);
  lines.push(RULE);
  return lines.join('\n');
}

// ---- CLI -------------------------------------------------------------------

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '').replace(/-/g, '_');
    opts[key] = argv[++i];
  }
  return opts;
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function readText(file) {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return '';
  }
}

function requireOpts(opts, ...keys) {
  for (const key of keys) {
    if (!opts[key]) {
      console.error(`error: ${key.replace(/_/g, '-')} is required`);
      process.exit(2);
    }
  }
}

async function build(opts) {
  requireOpts(opts, 'meta', 'urls', 'folder', 'downloads');
  const meta = (await readJson(opts.meta)) ?? {};
  const collected = (await readText(opts.urls)).split('\n').filter((line) => line.trim());
  const archive = await readText(path.join(opts.folder, '.archive.txt'));
  const cursor = await readJson(path.join(opts.folder, 'cursor.json'));

  const pending = pendingUrls(collected, archive);
  const planPath = path.join(opts.folder, PLAN_FILE);

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
    await writeFile(planPath, JSON.stringify(plan, null, 2) + '\n');
  } else {
    // A plan left over from an earlier run would otherwise outlive the work it
    // described, and --go would happily download it.
    await rm(planPath, { force: true });
  }

  console.log(
    statusBlock({
      nickname: meta.nickname ?? null,
      douyinId: meta.douyin_id ?? '?',
      folder: opts.folder,
      previousRoot: cursor?.downloads_root ?? null,
      downloadsRoot: opts.downloads,
      collected: collected.length,
      reported: meta.reported_works_count ?? null,
      onDisk: archivedIds(archive).size,
      pending: pending.length,
    }),
  );
}

async function load(opts) {
  requireOpts(opts, 'folder', 'downloads', 'out');
  const plan = await readJson(path.join(opts.folder, PLAN_FILE));
  const error = validatePlan(plan, {
    secUid: opts.sec_uid ?? null,
    douyinId: opts.douyin_id ?? null,
    folder: opts.folder,
    downloadsRoot: opts.downloads,
    now: new Date(),
    ttlHours: Number(opts.ttl_hours ?? DEFAULT_TTL_HOURS),
  });

  if (error) {
    console.error(`error: ${error.message}`);
    if (opts.remedy) console.error(`  run: ${opts.remedy}`);
    process.exit(2);
  }

  await writeFile(opts.out, plan.pending.join('\n') + '\n');
}

async function clear(opts) {
  requireOpts(opts, 'folder');
  await rm(path.join(opts.folder, PLAN_FILE), { force: true });
}

// Importing for tests must not run the CLI; argv[2] is absent then.
const [command, ...rest] = process.argv.slice(2);
if (command) {
  const opts = parseArgs(rest);
  if (command === 'build') await build(opts);
  else if (command === 'load') await load(opts);
  else if (command === 'clear') await clear(opts);
  else {
    console.error(`error: unknown command '${command}' (expected build|load|clear)`);
    process.exit(2);
  }
}
