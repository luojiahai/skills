#!/usr/bin/env node
/**
 * cursor.mjs — per-account folder resolution and cursor state.
 *
 * The cursor records *identity and last-run state*. It deliberately does not
 * record which videos are downloaded: yt-dlp's .archive.txt is the sole truth
 * for that, so the two files own disjoint data and cannot drift.
 *
 * Subcommands:
 *   resolve --douyin-id ID [--sec-uid UID] [--name NAME] [--downloads DIR]
 *           [--require-match]
 *       Prints the folder path for an account, creating nothing. Resolution
 *       order: existing folder whose cursor.json or .plan.json matches sec_uid
 *       or douyin_id, then --name, then douyin_id. --require-match exits 3
 *       rather than naming a folder that does not exist yet.
 *
 *   write --folder DIR --meta FILE [--downloads DIR]
 *       Merges collector metadata into <folder>/cursor.json, deriving the
 *       newest upload from the files actually on disk.
 *
 *   root [--downloads DIR]
 *       Prints the downloads root: the flag if given, else the default for the
 *       current working directory. The single place that answer is computed.
 */
import { writeFile, readdir, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { isMainModule, optString, parseArgs, readJson } from './cli.mjs';
import { downloadsRoot, normalizeRoot } from './paths.mjs';
import { PLAN_FILE } from './plan.mjs';

const readIn = (folder, file) => readJson(path.join(folder, file));
const readCursor = (folder) => readIn(folder, 'cursor.json');

/** The flag if given, else the default for the current working directory. */
function rootFor(opts) {
  try {
    const given = optString(opts, 'downloads');
    return given ? normalizeRoot(given) : downloadsRoot();
  } catch (err) {
    console.error(`error: ${err.message}`);
    process.exit(2);
  }
}

/**
 * An account may live under a --name folder rather than its 抖音号, so a later
 * run (or a single-video download, which only knows the 抖音号) has to find it
 * by identity rather than by guessing the path.
 */
async function resolve(opts) {
  const downloads = rootFor(opts);
  const douyinId = optString(opts, 'douyin_id');
  const secUid = optString(opts, 'sec_uid');
  const name = optString(opts, 'name');

  if (!douyinId && !secUid) {
    console.error('error: resolve needs --douyin-id or --sec-uid');
    process.exit(2);
  }

  if (existsSync(downloads)) {
    for (const entry of await readdir(downloads, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const folder = path.join(downloads, entry.name);
      // .plan.json as well as cursor.json: an account planned but never
      // downloaded has no cursor yet, and --go still has to find its folder
      // from the sec_uid in the URL alone.
      for (const identity of [await readCursor(folder), await readIn(folder, PLAN_FILE)]) {
        if (!identity) continue;
        if (
          (secUid && identity.sec_uid === secUid) ||
          (douyinId && identity.douyin_id === douyinId)
        ) {
          console.log(folder);
          return;
        }
      }
    }
  }

  if (opts.require_match) process.exit(3);

  if (!name && !douyinId) {
    console.error('error: no folder matches this account, and no --name or 抖音号 to name one');
    process.exit(3);
  }

  console.log(path.join(downloads, name || douyinId));
}

/** Filenames are `<upload_date> - <title> [<id>].<ext>`, so the newest upload
 *  is readable off disk without re-querying anything. */
export async function newestFrom(videosDir) {
  if (!existsSync(videosDir)) return { id: null, date: null };
  let best = { id: null, date: null };
  for (const name of await readdir(videosDir)) {
    const m = name.match(/^(\d{8}) - .*\[(\d+)\]\./);
    if (m && (!best.date || m[1] > best.date)) best = { date: m[1], id: m[2] };
  }
  return best;
}

/** What a fresh run knows wins; what only the previous cursor knew survives. */
export function mergeCursor({ meta, previous, newest, folder, downloads, now }) {
  return {
    sec_uid: meta.sec_uid ?? previous.sec_uid ?? null,
    douyin_id: meta.douyin_id ?? previous.douyin_id ?? null,
    nickname: meta.nickname ?? previous.nickname ?? null,
    folder_name: path.basename(folder),
    // Reporting only — the folder cannot be found *through* this, since the
    // file naming the root lives inside it. It is what lets a run say the
    // archive has moved since last time.
    downloads_root: downloads || previous.downloads_root || path.dirname(folder),
    last_run_at: now.toISOString(),
    newest_video_id: newest.id ?? previous.newest_video_id ?? null,
    newest_upload_date: newest.date ?? previous.newest_upload_date ?? null,
    collected_count: meta.collected_count ?? previous.collected_count ?? null,
    reported_works_count: meta.reported_works_count ?? previous.reported_works_count ?? null,
  };
}

async function write(opts) {
  const folder = opts.folder;
  if (!folder) {
    console.error('error: write needs --folder');
    process.exit(2);
  }
  const cursor = mergeCursor({
    meta: optString(opts, 'meta') ? ((await readJson(opts.meta)) ?? {}) : {},
    previous: (await readCursor(folder)) ?? {},
    newest: await newestFrom(path.join(folder, 'videos')),
    folder,
    downloads: optString(opts, 'downloads'),
    now: new Date(),
  });

  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, 'cursor.json'), JSON.stringify(cursor, null, 2) + '\n');
}

// Tests import this file, so the CLI dispatches only when it is the entry point.
if (isMainModule(import.meta.url)) {
  const [command, ...rest] = process.argv.slice(2);
  const opts = parseArgs(rest);

  if (command === 'resolve') await resolve(opts);
  else if (command === 'write') await write(opts);
  else if (command === 'root') console.log(rootFor(opts));
  else {
    console.error(`error: unknown command '${command ?? ''}' (expected resolve|write|root)`);
    process.exit(2);
  }
}
