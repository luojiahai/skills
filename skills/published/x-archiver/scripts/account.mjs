/**
 * account.mjs — where an account's folder is, and the identity written inside it.
 *
 * The folder is the account's numeric id:
 *
 *   <archives root>/x/<user id>/account.json
 *
 * The id rather than the handle, because handles are mutable and the id never
 * changes. That is the same fact the previous layout worked around by naming the
 * folder for the handle and then scanning every folder's metadata to find the
 * one an account already had; putting the id in the path answers it with a
 * `stat` instead. A renamed account keeps its folder without anything having to
 * notice the rename at all.
 *
 * `account.json` is authoritative for *identity* — which account is this folder
 * — and never for *progress*. What has been downloaded is answered by the post
 * folders (landed.mjs) and by nothing else: a stored count or newest-post id
 * would be a second account of the same thing, free to disagree after a run that
 * died between two writes. What the last run *did* is run history and lives in
 * sync.json, which may be deleted without losing anything.
 *
 * `--name` is a label, not a location. It rides inside this file beside the
 * handle, so it survives a folder being copied to another disk and cannot
 * collide with a name chosen on the other platform — a single root-level map of
 * names would have had one namespace for both skills, and would have been a file
 * whose absence cost the user a re-download.
 */
import { readdir } from 'node:fs/promises';
import path from 'node:path';

import { readJson, writeJson } from './cli.mjs';

export const ACCOUNT_FILE = 'account.json';
export const ACCOUNT_VERSION = 1;

/**
 * The directory this skill's accounts live under, inside a root it shares with
 * douyin-archiver. Two platforms, two folders, so an X user id and a sec_uid
 * cannot name the same directory.
 */
export const PLATFORM = 'x';

/** Every account this skill has archived, whatever their ids. */
export const platformDir = (root) => path.join(root, PLATFORM);

/**
 * An id that may be used as a directory name.
 *
 * X ids are decimal and could simply be trusted, but the id arrives from a
 * subprocess's stdout and lands in a path — so it is checked here rather than
 * anywhere it is joined. A separator or a `..` in this position does not produce
 * a badly named folder, it produces a tree somewhere else entirely.
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
 * A run that fetched one post by URL knows the handle but not the nickname, and
 * an enumeration that yielded rows but never named the account falls back to
 * blanks. Spread as-is, those blanks would overwrite what an earlier run had
 * already recorded.
 */
function known(fields) {
  return Object.fromEntries(
    Object.entries(fields || {}).filter(([, value]) => value !== null && value !== undefined && value !== ''),
  );
}

/**
 * Who the account is, in a fixed order and holding nothing else.
 *
 * The order is for the person who opens the file: the same lines in the same
 * places whichever run happened to learn which first. Listing them is also what
 * keeps a key this skill has stopped writing from living on in an archive by
 * being copied forward run after run.
 */
const ACCOUNT_KEYS = ['id', 'handle', 'nickname', 'name'];

function identity(existing, next) {
  const merged = { ...known(existing), ...known(next) };
  return Object.fromEntries(ACCOUNT_KEYS.filter((key) => key in merged).map((key) => [key, merged[key]]));
}

/**
 * Later facts win, but nothing already known is dropped.
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
 * The folder for an account whose id we do not know, or null.
 *
 * `--go` enumerates nothing, so it never learns the numeric id and cannot go
 * straight to the folder the way a plan can. Three keys are tried, in the order
 * of how much they prove:
 *
 *   url     the very URL the archive was made from — exact, and survives a rename
 *   name    what the user called it with --name — theirs, so it outranks a guess
 *   handle  what the account is called today — right until it is renamed
 *
 * One pass over the directory, because the answer is wanted once and the
 * alternative is three passes that each stop at a different folder.
 */
export async function findAccountDir(root, { url, name, handle } = {}) {
  const found = { url: null, name: null, handle: null };

  for await (const [dir, json] of accounts(root)) {
    if (url && json.url === url) return dir;
    if (name && json.account?.name === name) found.name ??= dir;
    if (handle && json.account?.handle === handle) found.handle ??= dir;
  }

  return found.name ?? found.handle ?? null;
}
