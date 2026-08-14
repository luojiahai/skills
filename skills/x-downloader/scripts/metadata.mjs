/**
 * metadata.mjs — which folder an account's archive is in.
 *
 * The folder is named for the handle, but the handle is not the identity: X
 * handles are mutable and the numeric user id never changes. So the folder is
 * found by reading the identity written inside it, and a renamed account keeps
 * filling the folder it already has. Renaming that folder to match would move
 * an archive the user may have organised, and starting a new one would
 * re-download everything.
 *
 * `metadata.json` is authoritative for *identity* — which folder is this
 * account's — and never for *progress*. What has been downloaded is answered by
 * the post folders themselves (archive.mjs) and by nothing else: a stored count
 * or newest-post id would be a second account of the same thing, free to
 * disagree after a run that died between two writes. Which is why this file
 * holds identity, the URL it was archived from, the root it last ran against,
 * and nothing more.
 */
import { readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { readJson } from './cli.mjs';


export const METADATA_FILE = 'metadata.json';
export const METADATA_VERSION = 1;

/**
 * Namespaces this skill's folders inside a downloads root it shares with
 * douyin-downloader, whose folders are `douyin_`. Both default to the same root
 * — <git root>/downloads — so without a prefix an X handle and a 抖音号 that
 * happen to match would archive into one folder and interleave two accounts.
 */
export const FOLDER_PREFIX = 'x_';

/**
 * A folder name from what the user asked for, falling back to the handle.
 *
 * `--name` renames the account part, not the whole folder: the prefix is what
 * keeps two skills apart in one root, and a name free to drop it would re-open
 * the clash exactly where nobody is looking for it.
 */
export function folderNameFor({ handle, name }) {
  const chosen = String(name || '').trim() || String(handle || '').trim();
  return FOLDER_PREFIX + chosen.replace(/^@/, '');
}

/** True when metadata describes the account we are looking for. */
export function matchesAccount(json, accountId) {
  return Boolean(json?.account?.id) && String(json.account.id) === String(accountId);
}

/**
 * The fields a caller actually knows.
 *
 * An enumeration that yielded rows but never named the account falls back to
 * blanks for the id and the display name. Spread as-is, those blanks would
 * overwrite what an earlier run had already recorded.
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
const ACCOUNT_KEYS = ['id', 'handle', 'nickname'];

function account(existing, next) {
  const merged = { ...known(existing), ...known(next) };
  return Object.fromEntries(ACCOUNT_KEYS.filter((key) => key in merged).map((key) => [key, merged[key]]));
}

/**
 * Later facts win, but nothing already known is dropped.
 *
 * A run that fetched one post by URL knows the account's id and handle but was
 * never told which root it ran against, and must not erase it.
 *
 * The shape is written out rather than spread from the old file, so the fields
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
export async function readMetadata(accountDir) {
  return readJson(path.join(accountDir, METADATA_FILE));
}

/**
 * Every archive in the downloads root this version can read, as it is found.
 *
 * Lazy, so a match in the first folder does not cost a read of every other one.
 * A file written by a version that numbered its fields differently is skipped
 * rather than guessed at: it reads as no archive at all, which is the same
 * answer as a folder nobody has archived into, and the run makes a new one.
 * Trusting a shape we do not know would be the loud, wrong alternative.
 */
async function* archives(root) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const metadata = await readMetadata(path.join(root, entry.name));
    if (metadata?.version !== METADATA_VERSION) continue;
    yield [entry.name, metadata];
  }
}

/**
 * The folder holding this account's archive, or null.
 *
 * Only `metadata.json` is consulted. It is written the moment a folder is
 * resolved — before anything is downloaded — so an account that has been
 * planned but never fetched already has one, and reading identity out of the
 * plan as well would be a second answer free to disagree with this one.
 */
export async function findAccountFolder(root, accountId) {
  for await (const [name, metadata] of archives(root)) {
    if (matchesAccount(metadata, accountId)) return name;
  }
  return null;
}

/** The existing folder for this account if it has one, else the name it should get. */
export async function resolveFolder({ root, accountId, handle, name }) {
  const existing = accountId ? await findAccountFolder(root, accountId) : null;
  return existing || folderNameFor({ handle, name });
}

/**
 * The folder archived from this URL, or null.
 *
 * `--go` runs no enumeration, so it never learns the numeric id and cannot use
 * `findAccountFolder`. The URL is the next best key: it is the very URL the
 * archive was made from. Without this, a renamed account's `--go` looks in a
 * folder named for the new handle, finds no plan, and refuses with a hint that
 * walks the user straight back into the same loop.
 */
export async function findFolderByUrl(root, url) {
  if (!url) return null;

  for await (const [name, metadata] of archives(root)) {
    if (metadata.url === url) return name;
  }
  return null;
}

export async function writeMetadata(accountDir, next) {
  const merged = mergeMetadata(await readMetadata(accountDir), next);
  await mkdir(accountDir, { recursive: true });
  await writeFile(path.join(accountDir, METADATA_FILE), `${JSON.stringify(merged, null, 2)}\n`);
  return merged;
}
