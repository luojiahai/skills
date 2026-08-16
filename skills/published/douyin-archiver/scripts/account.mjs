#!/usr/bin/env node
/**
 * account.mjs — where an account's folder is, and the identity written inside it.
 *
 * The folder is the account's sec_uid:
 *
 *   <archives root>/douyin/<sec_uid>/account.json
 *
 * The sec_uid rather than the 抖音号, because a user can change their 抖音号 and
 * the sec_uid never changes. That is the same fact the previous layout worked
 * around by naming the folder for the 抖音号 and then scanning every folder's
 * metadata to find the one an account already had; putting the sec_uid in the
 * path answers it with a `stat` instead.
 *
 * The 抖音号 is still kept inside the file, because it is the identifier a human
 * can actually read and type, and because a single-post download may learn it
 * before it learns anything else.
 *
 * `account.json` is authoritative for *identity* — which account is this folder
 * — and never for *progress*. What has been downloaded is answered by the post
 * folders under posts/ (landed.mjs) and by nothing else: a stored count or
 * newest-post id would be a second record of the same thing, free to disagree
 * with the files after a run that died between two writes. What the last run
 * *did* is run history and lives in sync.json, which may be deleted without
 * losing anything.
 *
 * `--name` is a label, not a location. It rides inside this file beside the
 * 抖音号, so it survives a folder being copied to another disk and cannot
 * collide with a name chosen on the other platform.
 *
 * Subcommands:
 *   resolve --sec-uid UID [--douyin-id ID] [--archives DIR] [--require-match]
 *       Prints the folder path for an account, creating nothing. A sec_uid
 *       names its folder directly; without one, the 抖音号 or --name is looked
 *       up by scanning. --require-match exits 3 rather than naming a folder
 *       that does not exist yet.
 *
 *   write --folder DIR [--meta FILE] [--sec-uid UID] [--douyin-id ID]
 *         [--name NAME] [--url URL]
 *       Merges what this run knows into <folder>/account.json. Fields it was
 *       not given are left as the previous run recorded them.
 *
 *   root [--archives DIR]
 *       Prints the archives root: the flag if given, else the default for the
 *       current working directory. The single place that answer is computed.
 */
import { readdir } from 'node:fs/promises';
import path from 'node:path';

import { isMainModule, optString, parseArgs, readJson, writeJson } from './cli.mjs';
import { archivesRoot, normalizeRoot } from './paths.mjs';

export const ACCOUNT_FILE = 'account.json';
export const ACCOUNT_VERSION = 1;

/**
 * The directory this skill's accounts live under, inside a root it shares with
 * x-archiver. Two platforms, two folders, so a sec_uid and an X user id cannot
 * name the same directory.
 */
export const PLATFORM = 'douyin';

/** Every account this skill has archived, whatever their ids. */
export const platformDir = (root) => path.join(root, PLATFORM);

/**
 * An id that may be used as a directory name.
 *
 * A sec_uid is `MS4wLjABAAAA…` — long, opaque, and made of characters that are
 * safe in a path. It is checked anyway, here rather than at every place it is
 * joined, because it arrives from a URL or a subprocess's stdout: a separator
 * or a `..` in this position does not produce a badly named folder, it produces
 * a tree somewhere else entirely.
 */
export function isSafeId(accountId) {
  const id = String(accountId ?? '');
  return id.length > 0 && id.length <= 128 && /^[A-Za-z0-9._-]+$/.test(id) && id !== '.' && id !== '..';
}

/** Where this account's folder is, whether or not it exists yet. */
export function accountDirFor(root, accountId) {
  if (!isSafeId(accountId)) {
    throw new Error(`refusing to use ${JSON.stringify(String(accountId ?? ''))} as an account folder name`);
  }
  return path.join(platformDir(root), String(accountId));
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
 * `id` is the sec_uid — the same key x-archiver uses for the X user id, so both
 * platforms' account.json read the same way. Listing the keys is also what keeps
 * one this skill has stopped writing from living on in an archive by being
 * copied forward run after run.
 */
const ACCOUNT_KEYS = ['id', 'douyin_id', 'nickname', 'name'];

function identity(existing, next) {
  const merged = { ...known(existing), ...known(next) };
  return Object.fromEntries(ACCOUNT_KEYS.filter((key) => key in merged).map((key) => [key, merged[key]]));
}

/**
 * What this run knows wins; what only the previous run knew survives.
 *
 * The shape is written out rather than spread from the old file, so the fields
 * this skill no longer keeps — `root` and `updated_at`, which moved to
 * sync.json's last_run — cannot survive in an archive by being copied forward.
 *
 * `platform` is stamped even though the parent directory already says it. It is
 * what makes a lone account.json self-describing when it has been copied out of
 * the tree, which matters more now that no spec ships beside the skill.
 */
export function mergeAccount(existing, next) {
  return {
    version: ACCOUNT_VERSION,
    platform: PLATFORM,
    account: identity(existing?.account, next?.account),
    url: next?.url || existing?.url || null,
  };
}

/** An account folder's identity, or null if it has none. */
export async function readAccount(dir) {
  return readJson(path.join(dir, ACCOUNT_FILE));
}

export async function writeAccount(dir, next) {
  const merged = mergeAccount(await readAccount(dir), next);
  await writeJson(path.join(dir, ACCOUNT_FILE), merged);
  return merged;
}

/**
 * Every account folder under the root that this build can read, as it is found.
 *
 * Lazy, so a match in the first folder does not cost a read of every other one.
 * A file written by a version that numbered its fields differently is skipped
 * rather than guessed at: it reads as no archive at all, which is the same
 * answer as a folder nobody has archived into.
 */
async function* accounts(root) {
  let entries;
  try {
    entries = await readdir(platformDir(root), { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(platformDir(root), entry.name);
    const json = await readAccount(dir);
    if (json?.version !== ACCOUNT_VERSION) continue;
    yield [dir, json];
  }
}

/**
 * The folder for an account whose sec_uid we do not know, or null.
 *
 * A single-post download learns the 抖音号 before anything else, and a user may
 * only remember what they called it with --name. Both are looked up by the
 * identity written inside the folders rather than by guessing a path — and
 * --name outranks the 抖音号, because the name is the user's own word for this
 * archive while the 抖音号 is what the platform calls it today.
 *
 * One pass over the directory, because the answer is wanted once and the
 * alternative is two passes that stop at different folders.
 */
export async function findAccountDir(root, { name, douyinId, url } = {}) {
  const found = { name: null, douyinId: null };

  for await (const [dir, json] of accounts(root)) {
    if (url && json.url === url) return dir;
    if (name && json.account?.name === name) found.name ??= dir;
    if (douyinId && json.account?.douyin_id === douyinId) found.douyinId ??= dir;
  }

  return found.name ?? found.douyinId ?? null;
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
  const root = rootFor(opts);
  const secUid = optString(opts, 'sec_uid');
  const douyinId = optString(opts, 'douyin_id');
  const name = optString(opts, 'name');

  if (!secUid && !douyinId && !name) {
    console.error('error: resolve needs --sec-uid, --douyin-id or --name');
    process.exit(2);
  }

  // The sec_uid *is* the folder, so there is nothing to look up — but an
  // account that has never been archived has no folder yet, and --require-match
  // is how the caller asks to be told that rather than given a path.
  if (secUid) {
    let dir;
    try {
      dir = accountDirFor(root, secUid);
    } catch (err) {
      console.error(`error: ${err.message}`);
      process.exit(2);
    }
    if (opts.require_match && !(await readAccount(dir))) process.exit(3);
    console.log(dir);
    return;
  }

  const existing = await findAccountDir(root, { name, douyinId });
  if (existing) {
    console.log(existing);
    return;
  }

  // Without a sec_uid there is no folder name to invent: the 抖音号 cannot be
  // one, because it is the mutable identifier this layout stopped filing by.
  process.exit(3);
}

async function write(opts) {
  const folder = optString(opts, 'folder');
  if (!folder) {
    console.error('error: write needs --folder');
    process.exit(2);
  }

  // --meta is the collector's metadata; the flags are for the paths that never
  // ran a collection at all.
  const meta = optString(opts, 'meta') ? ((await readJson(opts.meta)) ?? {}) : {};

  await writeAccount(folder, {
    account: {
      id: optString(opts, 'sec_uid') || meta.sec_uid,
      douyin_id: optString(opts, 'douyin_id') || meta.douyin_id,
      nickname: meta.nickname,
      name: optString(opts, 'name'),
    },
    url: optString(opts, 'url'),
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
