/**
 * archiver.mjs — the archives root's schema version, and the alias map.
 *
 * `archiver.json` is the one file that sits above the platform folders:
 *
 *   {
 *     "schema": 3,
 *     "accounts": { "x": { "1458023001234567890": "jia" } }
 *   }
 *
 * The schema is advisory on the way in and load-bearing on the way out. Missing
 * is an ordinary answer — an archive copied out subtree-first, say — and reads
 * as "the current schema", because refusing
 * to read an archive whose layout is in fact correct would be the worse failure.
 * A version this build does not know is the opposite: the layout may put an
 * account's folder somewhere else entirely, so the run stops and says so rather
 * than enumerating an empty tree and silently re-downloading an entire archive.
 *
 * `accounts` maps an account's immutable id to the alias its folder is named
 * for, nested per platform. Keyed by the id because the id is the half that
 * cannot change, and because an object then cannot hold two aliases for one
 * account. Nested per platform because the Douyin platform writes this same file in
 * this same root, and an X account and a Douyin account may both be called jia.
 *
 * An account with no alias has no entry. Its folder is its id, which the
 * directory listing already says, and an entry saying it again is one more thing
 * to go stale.
 *
 * The map is a cache, not an authority. Which accounts are here, and which
 * folder belongs to whom, are answerable by scanning the account.json files, and
 * that scan is what repairs this file after a folder is moved by hand — see
 * resolveAccountDir in account.mjs. So a stale entry costs a scan, never an
 * archive. What is *not* tolerated is a file this build cannot parse: that may
 * be a schema from the future, and rebuilding it would clobber it.
 *
 * The same file, with the same number, is written by the Douyin platform. The two
 * skills share an archives root and share this contract; the copy of this module
 * over there has to keep agreeing with this one.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { readJson, writeJson } from './cli.mjs';

export const ARCHIVER_FILE = 'archiver.json';

/**
 * 3, not 2. Schema 2 filed every account under its id and had no alias map; 3
 * lets a folder be named for an alias instead. Nothing moved between them, which
 * is why 2 is *readable* rather than refused — see READABLE_SCHEMAS.
 *
 * Schema 1 is the flat `x_<handle>` / `douyin_<抖音号>` layout, which has no root
 * file at all — so it is indistinguishable from the "missing" case and reads as
 * current. Nothing here can guard against it, and nothing should try: that
 * layout is invisible to this build, and converting one is a job the user does
 * by hand.
 */
export const SCHEMA_VERSION = 3;

/**
 * Schemas this build may write into.
 *
 * 2 is here because every schema-2 account folder — named for the account's id,
 * with no alias anywhere — is already a legal schema-3 folder. The upgrade adds
 * a number and an empty map and moves nothing, so refusing a schema-2 archive
 * would strand every existing archive on a change that costs it nothing.
 * stampRoot performs the upgrade the first time such a root is written into.
 */
const READABLE_SCHEMAS = new Set([2, SCHEMA_VERSION]);

/**
 * The root file as it was parsed, or null when there is not a readable one.
 *
 * The second reader of this file, and deliberately the blunter one: readSchema
 * below tells "absent" from "present but unparseable" because the difference
 * decides whether a run may proceed, while this collapses both to null because
 * by the time anything asks for the alias map, checkRoot has already refused
 * every archive where that distinction mattered. Nothing here may be called
 * before that refusal.
 */
async function readArchiverFile(root) {
  return readJson(path.join(root, ARCHIVER_FILE));
}

/**
 * `{ present, schema }` for the root's archiver.json.
 *
 * `schema` is whatever the file held, unexamined — a string, an object, a
 * missing key. Judging it is checkSchema's job, so that "what does the file say"
 * and "may we act on it" stay two questions with one answer each.
 *
 * Absent and unreadable are told apart *here*, and it matters more than it
 * looks. Absent means "carry on", so anything that collapses into it is a way
 * of reaching the one permissive answer by accident — a file truncated by a
 * full disk would read as no file at all, and the run would then overwrite it
 * with a stamp claiming a schema nobody verified. A file that exists but cannot
 * be parsed is reported as present with no schema, which checkSchema refuses.
 */
export async function readSchema(root) {
  let raw;
  try {
    raw = await readFile(path.join(root, ARCHIVER_FILE), 'utf8');
  } catch {
    return { present: false, schema: null };
  }

  try {
    const json = JSON.parse(raw);
    if (json === null || typeof json !== 'object') return { present: true, schema: null };
    return { present: true, schema: json.schema ?? null };
  } catch {
    return { present: true, schema: null };
  }
}

/**
 * Whether this build may write into an archive that said `schema`.
 *
 * A file that is present but does not carry an integer is refused rather than
 * ignored. Ignoring it would treat a corrupt or half-written root file as an
 * absent one, and absent means "carry on" — which is the one answer that must
 * not be reachable by accident.
 */
export function checkSchema({ present, schema }) {
  if (!present) return { ok: true };
  if (READABLE_SCHEMAS.has(schema)) return { ok: true };

  if (!Number.isInteger(schema)) {
    return {
      ok: false,
      reason:
        `${ARCHIVER_FILE} does not say which schema this archive uses.\n` +
        `  This build writes schema ${SCHEMA_VERSION}. Repair or remove that file before running again.`,
    };
  }

  return {
    ok: false,
    reason:
      `this archive is schema ${schema}, and this build writes schema ${SCHEMA_VERSION}.\n` +
      `  ${schema > SCHEMA_VERSION ? 'It was written by a newer version of this skill — update it.' : 'It was written by an older version of this skill.'}\n` +
      `  Nothing has been read or written. Point --archives at a different root, or migrate this one.`,
  };
}

/**
 * Refuse to go on if this archive is one this build cannot read.
 *
 * Called once per run, before anything is enumerated or fetched, so a refusal
 * costs nothing and lands before the first API call. Throws rather than
 * returning a verdict: every caller's answer to a mismatch is the same, and an
 * ignorable return value is how it comes to be ignored.
 *
 * Reads and never writes. Checking is what has to happen early; stamping has to
 * happen *late*, or a mistyped `--archives` would leave a stamped empty
 * directory behind on a run that then went nowhere.
 */
export async function checkRoot(root) {
  const verdict = checkSchema(await readSchema(root));
  if (!verdict.ok) throw new Error(verdict.reason);
  return SCHEMA_VERSION;
}

/**
 * Stamp a root that has never been stamped, or lift a schema-2 one to 3.
 *
 * Called once the run is committed to writing into this root — after the
 * account folder is resolved — so the only directories that acquire an
 * `archiver.json` are ones that are really becoming archives.
 *
 * The upgrade rewrites the number and adds an empty map, and touches nothing
 * else in the file or in the tree: a schema-2 archive is a schema-3 archive in
 * which no account has been given an alias yet.
 *
 * Silent when the root already says 3, whatever else it says: checkRoot has
 * already passed judgement on that, and re-deciding it here would be a second
 * answer.
 */
export async function stampRoot(root) {
  const { present, schema } = await readSchema(root);
  if (present && schema === SCHEMA_VERSION) return SCHEMA_VERSION;

  if (!present) {
    await writeJson(path.join(root, ARCHIVER_FILE), { schema: SCHEMA_VERSION, accounts: {} });
    return SCHEMA_VERSION;
  }

  // Present and readable but not current — schema 2, the only other member of
  // READABLE_SCHEMAS. Anything else never reaches here, because checkRoot threw.
  const file = (await readArchiverFile(root)) ?? {};
  await writeJson(path.join(root, ARCHIVER_FILE), {
    ...file,
    schema: SCHEMA_VERSION,
    accounts: aliasTable(file.accounts),
  });
  return SCHEMA_VERSION;
}

/** The `accounts` object, or an empty one when it is missing or the wrong shape. */
function aliasTable(accounts) {
  if (!accounts || typeof accounts !== 'object' || Array.isArray(accounts)) return {};
  return accounts;
}

/**
 * This platform's `{ id: alias }` map, holding only entries that could name a
 * folder.
 *
 * An entry that is not two non-empty strings is dropped rather than repaired.
 * The file is a cache a human is invited to read, so it is also one a human can
 * mistype, and the cost of dropping a junk entry is a scan — where the cost of
 * trusting it is a number or a null reaching a path.
 */
export async function readAliases(root, platform) {
  const byPlatform = aliasTable((await readArchiverFile(root))?.accounts);
  const table = aliasTable(byPlatform[platform]);

  return Object.fromEntries(
    Object.entries(table).filter(
      ([id, alias]) => typeof id === 'string' && id !== '' && typeof alias === 'string' && alias !== '',
    ),
  );
}

/**
 * Record — or, with a null alias, forget — one account's alias.
 *
 * Read-modify-write rather than a rewrite of the whole shape: the other
 * platform's entries are in this file, and so is anything a future version of
 * either skill has started keeping here.
 *
 * This is the last of the three writes an alias change makes — the folder moves
 * first, then account.json inside it, then this. It is the only one that is
 * merely a cache, so a crash before it lands is repaired by the next scan.
 */
export async function writeAlias(root, platform, id, alias) {
  const file = (await readArchiverFile(root)) ?? {};
  const accounts = { ...aliasTable(file.accounts) };
  const table = { ...aliasTable(accounts[platform]) };

  if (alias) table[String(id)] = String(alias);
  else delete table[String(id)];

  accounts[platform] = table;
  await writeJson(path.join(root, ARCHIVER_FILE), { ...file, schema: SCHEMA_VERSION, accounts });
  return table;
}
