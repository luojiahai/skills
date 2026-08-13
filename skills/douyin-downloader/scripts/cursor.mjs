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
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { downloadsRoot, normalizeRoot } from './paths.mjs';

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '').replace(/-/g, '_');
    const next = argv[i + 1];
    // A flag with no value of its own, such as --require-match, must not
    // swallow the flag that follows it.
    if (next === undefined || next.startsWith('--')) opts[key] = true;
    else opts[key] = argv[++i];
  }
  return opts;
}

async function readJson(folder, file) {
  try {
    return JSON.parse(await readFile(path.join(folder, file), 'utf8'));
  } catch {
    return null;
  }
}

const readCursor = (folder) => readJson(folder, 'cursor.json');

/** The flag if given, else the default for the current working directory. */
function rootFor(opts) {
  try {
    return opts.downloads && opts.downloads !== true
      ? normalizeRoot(opts.downloads)
      : downloadsRoot();
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
  const { douyin_id: douyinId, sec_uid: secUid, name } = opts;

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
      for (const identity of [await readCursor(folder), await readJson(folder, '.plan.json')]) {
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

  console.log(path.join(downloads, name === true ? douyinId : name || douyinId));
}

/** Filenames are `<upload_date> - <title> [<id>].<ext>`, so the newest upload
 *  is readable off disk without re-querying anything. */
async function newestFrom(videosDir) {
  if (!existsSync(videosDir)) return { id: null, date: null };
  let best = { id: null, date: null };
  for (const name of await readdir(videosDir)) {
    const m = name.match(/^(\d{8}) - .*\[(\d+)\]\./);
    if (m && (!best.date || m[1] > best.date)) best = { date: m[1], id: m[2] };
  }
  return best;
}

async function write(opts) {
  const folder = opts.folder;
  if (!folder) {
    console.error('error: write needs --folder');
    process.exit(2);
  }
  const meta = opts.meta ? JSON.parse(await readFile(opts.meta, 'utf8')) : {};
  const previous = (await readCursor(folder)) ?? {};
  const newest = await newestFrom(path.join(folder, 'videos'));

  const cursor = {
    sec_uid: meta.sec_uid ?? previous.sec_uid ?? null,
    douyin_id: meta.douyin_id ?? previous.douyin_id ?? null,
    nickname: meta.nickname ?? previous.nickname ?? null,
    folder_name: path.basename(folder),
    // Reporting only — the folder cannot be found *through* this, since the
    // file naming the root lives inside it. It is what lets a run say the
    // archive has moved since last time.
    downloads_root:
      opts.downloads && opts.downloads !== true
        ? opts.downloads
        : (previous.downloads_root ?? path.dirname(folder)),
    last_run_at: new Date().toISOString(),
    newest_video_id: newest.id ?? previous.newest_video_id ?? null,
    newest_upload_date: newest.date ?? previous.newest_upload_date ?? null,
    collected_count: meta.collected_count ?? previous.collected_count ?? null,
    reported_works_count: meta.reported_works_count ?? previous.reported_works_count ?? null,
  };

  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, 'cursor.json'), JSON.stringify(cursor, null, 2) + '\n');
}

const [command, ...rest] = process.argv.slice(2);
const opts = parseArgs(rest);

if (command === 'resolve') await resolve(opts);
else if (command === 'write') await write(opts);
else if (command === 'root') console.log(rootFor(opts));
else {
  console.error(`error: unknown command '${command ?? ''}' (expected resolve|write|root)`);
  process.exit(2);
}
