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
 *       Prints the folder path for an account, creating nothing. Resolution
 *       order: existing folder whose cursor.json matches sec_uid or douyin_id,
 *       then --name, then douyin_id.
 *
 *   write --folder DIR --meta FILE
 *       Merges collector metadata into <folder>/cursor.json, deriving the
 *       newest upload from the files actually on disk.
 */
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { downloadsRoot } from './paths.mjs';

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '').replace(/-/g, '_');
    opts[key] = argv[++i];
  }
  return opts;
}

async function readCursor(folder) {
  try {
    return JSON.parse(await readFile(path.join(folder, 'cursor.json'), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * An account may live under a --name folder rather than its 抖音号, so a later
 * run (or a single-video download, which only knows the 抖音号) has to find it
 * by identity rather than by guessing the path.
 */
async function resolve(opts) {
  let downloads = opts.downloads;
  if (!downloads) {
    try {
      downloads = downloadsRoot();
    } catch (err) {
      console.error(`error: ${err.message}`);
      process.exit(2);
    }
  }
  const { douyin_id: douyinId, sec_uid: secUid, name } = opts;

  if (!douyinId && !secUid) {
    console.error('error: resolve needs --douyin-id or --sec-uid');
    process.exit(2);
  }

  if (existsSync(downloads)) {
    for (const entry of await readdir(downloads, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const folder = path.join(downloads, entry.name);
      const cursor = await readCursor(folder);
      if (!cursor) continue;
      if ((secUid && cursor.sec_uid === secUid) || (douyinId && cursor.douyin_id === douyinId)) {
        console.log(folder);
        return;
      }
    }
  }

  console.log(path.join(downloads, name || douyinId));
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
else {
  console.error(`error: unknown command '${command ?? ''}' (expected resolve|write)`);
  process.exit(2);
}
