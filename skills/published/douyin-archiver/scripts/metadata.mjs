#!/usr/bin/env node
/**
 * metadata.mjs — per-account folder resolution, and the identity written inside
 * the folder.
 *
 * `metadata.json` is authoritative for *identity* — which folder is this
 * account's — and never for *progress*. What has been downloaded is answered by
 * the post folders under posts/ (landed.mjs) and by nothing else: a stored
 * count or newest-post id would be a second record of the same thing, free to
 * disagree with the files after a run that died between two writes. So this
 * file holds identity, the profile URL it was archived from, the archives root
 * it last ran against, and nothing more.
 *
 * It is written the moment a folder is resolved, before anything is
 * downloaded — which is what lets every later run, including a --go that opens
 * no browser, find the folder an account already has.
 *
 * Subcommands:
 *   resolve --douyin-id ID [--sec-uid UID] [--name NAME] [--archives DIR]
 *           [--require-match]
 *       Prints the folder path for an account, creating nothing. Resolution
 *       order: existing folder whose metadata.json matches sec_uid or
 *       douyin_id, then --name, then douyin_id. --require-match exits 3 rather
 *       than naming a folder that does not exist yet.
 *
 *   write --folder DIR [--meta FILE] [--sec-uid UID] [--douyin-id ID]
 *         [--url URL] [--archives DIR]
 *       Merges what this run knows into <folder>/metadata.json. Fields it was
 *       not given are left as the previous run recorded them.
 *
 *   root [--archives DIR]
 *       Prints the archives root: the flag if given, else the default for the
 *       current working directory. The single place that answer is computed.
 */
import { writeFile, readdir, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { isMainModule, optString, parseArgs, readJson } from './cli.mjs';
import { archivesRoot, normalizeRoot } from './paths.mjs';

export const METADATA_FILE = 'metadata.json';
export const METADATA_VERSION = 1;

/**
 * Namespaces this skill's folders inside an archives root it shares with
 * x-archiver, whose folders are `x_`. Both default to the same root —
 * <git root>/archives — so without a prefix a 抖音号 and an X handle that
 * happen to match would archive into one folder and interleave two accounts.
 */
export const FOLDER_PREFIX = 'douyin_';

/**
 * A folder name from what the user asked for, falling back to the 抖音号.
 *
 * `--name` renames the account part, not the whole folder: the prefix is what
 * keeps two skills apart in one root, and a name free to drop it would re-open
 * the clash exactly where nobody is looking for it.
 */
export function folderNameFor({ douyinId, name }) {
  return FOLDER_PREFIX + (String(name || '').trim() || String(douyinId || '').trim());
}

/**
 * The fields a caller actually knows.
 *
 * The collector's metadata carries every key it knows *of*, null where it found
 * nothing, and a single-post run knows only the 抖音号. Spread as-is, those
 * blanks would overwrite what a full sweep had already recorded.
 */
function known(fields) {
  return Object.fromEntries(
    Object.entries(fields || {}).filter(([, value]) => value !== null && value !== undefined && value !== ''),
  );
}

/**
 * Who the account is, in a fixed order and holding nothing else.
 *
 * The order is for the person who opens the file: the same three lines in the
 * same places whichever run happened to learn which first. Listing them is also
 * what keeps a key this skill has stopped writing from living on in an archive
 * by being copied forward run after run.
 */
const ACCOUNT_KEYS = ['sec_uid', 'douyin_id', 'nickname'];

function account(existing, next) {
  const merged = { ...known(existing), ...known(next) };
  return Object.fromEntries(ACCOUNT_KEYS.filter((key) => key in merged).map((key) => [key, merged[key]]));
}

/**
 * What this run knows wins; what only the previous run knew survives.
 *
 * The shape is written out rather than spread from the old file, so a field
 * this skill no longer keeps cannot survive in an archive by being copied
 * forward run after run.
 */
export function mergeMetadata(existing, next) {
  return {
    version: METADATA_VERSION,
    account: account(existing?.account, next?.account),
    url: next?.url || existing?.url || null,
    root: next?.root || existing?.root || null,
    updated_at: next?.updated_at || existing?.updated_at || null,
  };
}

/** An account folder's metadata, or null if it has none. */
export async function readMetadata(folder) {
  return readJson(path.join(folder, METADATA_FILE));
}

export async function writeMetadata(folder, next) {
  const merged = mergeMetadata(await readMetadata(folder), next);
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, METADATA_FILE), JSON.stringify(merged, null, 2) + '\n');
  return merged;
}

/**
 * The folder holding this account's archive, or null.
 *
 * An account may live under a --name folder rather than its 抖音号, and a
 * single-post download knows only the 抖音号 while --go knows only the sec_uid
 * from the URL — so the folder is found by the identity written inside it
 * rather than by guessing the path. Either identifier is enough.
 *
 * A file written by a version that numbered its fields differently is skipped
 * rather than guessed at: it reads as no archive at all, which is the same
 * answer as a folder nobody has archived into, and the run makes a new one.
 */
export async function findAccountFolder(archives, { secUid, douyinId } = {}) {
  if (!secUid && !douyinId) return null;

  let entries;
  try {
    entries = await readdir(archives, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const metadata = await readMetadata(path.join(archives, entry.name));
    if (metadata?.version !== METADATA_VERSION) continue;
    const identity = metadata.account;
    if (!identity) continue;
    if ((secUid && identity.sec_uid === secUid) || (douyinId && identity.douyin_id === douyinId)) {
      return entry.name;
    }
  }
  return null;
}

// ---- CLI -------------------------------------------------------------------

/** The flag if given, else the default for the current working directory. */
function rootFor(opts) {
  try {
    const given = optString(opts, 'archives');
    return given ? normalizeRoot(given) : archivesRoot();
  } catch (err) {
    console.error(`error: ${err.message}`);
    process.exit(2);
  }
}

async function resolve(opts) {
  const archives = rootFor(opts);
  const douyinId = optString(opts, 'douyin_id');
  const secUid = optString(opts, 'sec_uid');
  const name = optString(opts, 'name');

  if (!douyinId && !secUid) {
    console.error('error: resolve needs --douyin-id or --sec-uid');
    process.exit(2);
  }

  const existing = await findAccountFolder(archives, { secUid, douyinId });
  if (existing) {
    console.log(path.join(archives, existing));
    return;
  }

  if (opts.require_match) process.exit(3);

  if (!name && !douyinId) {
    console.error('error: no folder matches this account, and no --name or 抖音号 to name one');
    process.exit(3);
  }

  console.log(path.join(archives, folderNameFor({ douyinId, name })));
}

async function write(opts) {
  const folder = opts.folder;
  if (!folder) {
    console.error('error: write needs --folder');
    process.exit(2);
  }

  // --meta is the collector's metadata or the plan written from it; the flags
  // are for the paths that never ran a collection at all.
  const meta = optString(opts, 'meta') ? ((await readJson(opts.meta)) ?? {}) : {};

  await writeMetadata(folder, {
    account: {
      sec_uid: optString(opts, 'sec_uid') || meta.sec_uid,
      douyin_id: optString(opts, 'douyin_id') || meta.douyin_id,
      nickname: meta.nickname,
    },
    url: optString(opts, 'url'),
    root: optString(opts, 'archives'),
    updated_at: new Date().toISOString(),
  });
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
