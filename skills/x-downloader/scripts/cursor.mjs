/**
 * cursor.mjs — which folder an account's archive is in, and what the last run
 * did.
 *
 * The folder is named for the handle, but the handle is not the identity: X
 * handles are mutable and the numeric user id never changes. So the folder is
 * found by reading the identity written inside it, and a renamed account keeps
 * filling the folder it already has. Renaming that folder to match would move
 * an archive the user may have organised, and starting a new one would
 * re-download everything.
 *
 * `cursor.json` gates nothing. It records identity and what the last run did,
 * and every question about what has been downloaded is answered by the files
 * themselves (archive.mjs). A cursor that claimed to know would be a second
 * account of the same thing, free to disagree after a run that died between
 * two writes.
 */
import { readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { readJson } from './cli.mjs';
import { PLAN_FILE } from './plan.mjs';


export const CURSOR_FILE = 'cursor.json';
export const CURSOR_VERSION = 1;

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

/** True when a cursor or plan describes the account we are looking for. */
export function matchesAccount(json, accountId) {
  return Boolean(json?.account?.id) && String(json.account.id) === String(accountId);
}

/**
 * Later facts win, but nothing already known is dropped.
 *
 * A run that fetched one post by URL knows the account's id and handle but not
 * what the last full sweep found, and must not erase it.
 */
export function mergeCursor(existing, next) {
  return {
    ...(existing || {}),
    ...next,
    version: CURSOR_VERSION,
    account: { ...(existing?.account || {}), ...(next?.account || {}) },
  };
}

/**
 * The folder holding this account's archive, or null.
 *
 * Both `cursor.json` and `.plan.json` are consulted: the second is what finds
 * an account that was planned but whose download never ran, which by definition
 * has no cursor yet.
 */
export async function findAccountFolder(root, accountId) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(root, entry.name);
    for (const file of [CURSOR_FILE, PLAN_FILE]) {
      if (matchesAccount(await readJson(path.join(dir, file)), accountId)) return entry.name;
    }
  }
  return null;
}

/** The existing folder for this account if it has one, else the name it should get. */
export async function resolveFolder({ root, accountId, handle, name }) {
  const existing = accountId ? await findAccountFolder(root, accountId) : null;
  return existing || folderNameFor({ handle, name });
}

/**
 * The folder whose plan or cursor was written for this URL, or null.
 *
 * `--go` runs no enumeration, so it never learns the numeric id and cannot use
 * `findAccountFolder`. The URL is the next best key: the plan it is looking for
 * was written from the very URL it was given. Without this, a renamed account's
 * `--go` looks in a folder named for the new handle, finds no plan, and refuses
 * with a hint that walks the user straight back into the same loop.
 */
export async function findFolderByUrl(root, url) {
  if (!url) return null;

  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const file of [PLAN_FILE, CURSOR_FILE]) {
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const json = await readJson(path.join(root, entry.name, file));
      if (json?.url === url) return entry.name;
    }
  }
  return null;
}

export async function writeCursor(accountDir, next) {
  const file = path.join(accountDir, CURSOR_FILE);
  const merged = mergeCursor(await readJson(file), next);
  await mkdir(accountDir, { recursive: true });
  await writeFile(file, `${JSON.stringify(merged, null, 2)}\n`);
  return merged;
}

