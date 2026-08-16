/**
 * archiver.mjs — the archives root's schema version, and nothing else.
 *
 * `archiver.json` is the one file that sits above the platform folders, and it
 * holds a single number:
 *
 *   { "schema": 2 }
 *
 * It is advisory on the way in and load-bearing on the way out. Missing is an
 * ordinary answer — an archive copied out subtree-first, or one made before this
 * file existed — and reads as "the current schema", because refusing to read an
 * archive whose layout is in fact correct would be the worse failure. A version
 * this build does not know is the opposite: the layout may put an account's
 * folder somewhere else entirely, so the run stops and says so rather than
 * enumerating an empty tree and silently re-downloading an entire archive.
 *
 * It is deliberately not an index. Which accounts are here, and which folder
 * belongs to whom, are answered by scanning the account.json files — an index
 * would be a second answer to a question the directory tree already settles,
 * and one that goes stale the moment a folder is moved by hand.
 *
 * The same file, with the same number, is written by douyin-archiver. The two
 * skills share an archives root and share this contract; the copy of this module
 * over there has to keep agreeing with this one.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { writeJson } from './cli.mjs';

export const ARCHIVER_FILE = 'archiver.json';

/**
 * 2, not 1. Schema 1 is the flat `x_<handle>` / `douyin_<抖音号>` layout that
 * had no root file at all — so an archive in the old shape is exactly the
 * "missing" case, and would be read as current. That is why nothing here is the
 * guard against an old archive: it cannot be. The old layout is simply invisible
 * to this build, and the migration is a one-off the user runs by hand.
 */
export const SCHEMA_VERSION = 2;

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
  if (schema === SCHEMA_VERSION) return { ok: true };

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
 * Stamp a root that has never been stamped.
 *
 * Called once the run is committed to writing into this root — after the
 * account folder is resolved — so the only directories that acquire an
 * `archiver.json` are ones that are really becoming archives.
 *
 * Silent when the file already exists, whatever it says: checkRoot has already
 * passed judgement on that, and re-deciding it here would be a second answer.
 */
export async function stampRoot(root) {
  if ((await readSchema(root)).present) return SCHEMA_VERSION;
  await writeJson(path.join(root, ARCHIVER_FILE), { schema: SCHEMA_VERSION });
  return SCHEMA_VERSION;
}
