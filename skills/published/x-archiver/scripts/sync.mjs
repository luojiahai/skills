/**
 * sync.mjs — the account folder's working file.
 *
 *   { "version": 1,
 *     "plan": { … } | null,        the list awaiting approval, or nothing
 *     "last_run": { … } }          what the previous run did
 *
 * **Deleting sync.json loses no archive content.** That sentence is the whole
 * specification of this file, and every field in it has to keep the sentence
 * true. What has been downloaded is answered by the post folders and by nothing
 * else; a cursor, a newest-post id, or a count of what has landed would all be a
 * second record of that, free to disagree with the files after a run that died
 * between two writes — and the disagreement would be silent and permanent. If a
 * field is ever added here whose loss costs the user a post, the field is wrong,
 * not the sentence.
 *
 * It replaces the hidden `.plan.json`, unhidden because an archive you browse
 * should not have working files you cannot see, and it absorbs the `updated_at`
 * that used to sit in the identity file — run history is not identity.
 *
 * One lifetime per key: `plan` expires after a day (a plan describes a list the
 * user approved, and a day later it describes the past), `last_run` does not
 * expire at all. That is why they are two keys rather than a flat file.
 *
 * The `plan` payload is the enumeration's own rows, parked between `--plan` and
 * `--go` and handed back unchanged. It is deliberately opaque here: this module
 * owns *when* a plan is kept and *where* it lives, and plan.mjs owns what one
 * means.
 */
import path from 'node:path';

import { readJson, writeJson } from './cli.mjs';

export const SYNC_FILE = 'sync.json';
export const SYNC_VERSION = 1;

const syncPath = (accountDir) => path.join(accountDir, SYNC_FILE);

/**
 * What the file holds, in a fixed order, written out rather than spread.
 *
 * Same reason as account.json: a key this skill has stopped writing must not
 * survive in an archive by being copied forward run after run. Passing a key as
 * `undefined` keeps what is already there; passing it as null clears it, which
 * is how a completed plan is retired.
 */
export function mergeSync(existing, next) {
  const merged = {
    version: SYNC_VERSION,
    plan: next?.plan === undefined ? (existing?.plan ?? null) : next.plan,
    last_run: next?.last_run === undefined ? (existing?.last_run ?? null) : next.last_run,
  };
  return merged;
}

/**
 * The file's contents, or null.
 *
 * A file written by a version that numbered its fields differently reads as
 * nothing at all — which is the correct answer, because a plan is a cache and
 * the honest thing to do with one we cannot read is make a new one.
 */
export async function readSync(accountDir) {
  const json = await readJson(syncPath(accountDir));
  return json?.version === SYNC_VERSION ? json : null;
}

export async function writeSync(accountDir, next) {
  const merged = mergeSync(await readSync(accountDir), next);
  await writeJson(syncPath(accountDir), merged);
  return merged;
}

/** The parked plan, or null if there is none to act on. */
export async function loadPlan(accountDir) {
  return (await readSync(accountDir))?.plan ?? null;
}

export async function savePlan(accountDir, plan) {
  return writeSync(accountDir, { plan });
}

/**
 * Retires the plan, keeping the run history beside it.
 *
 * Called only once every post in the plan has landed. A plan kept after a run
 * that stopped partway is what makes the retry fetch just the remainder.
 */
export async function clearPlan(accountDir) {
  return writeSync(accountDir, { plan: null });
}

/** The root the previous run used, for the block's "last run used …" note. */
export async function previousRoot(accountDir) {
  return (await readSync(accountDir))?.last_run?.root ?? null;
}

/**
 * What this run did, stamped after it did it.
 *
 * Reporting only. Nothing reads these numbers back to decide what to fetch —
 * that is derived from the post folders every time — so a run that dies before
 * writing them costs the archive nothing.
 */
export async function recordRun(accountDir, { root, found, landed, failed, at = new Date().toISOString() }) {
  return writeSync(accountDir, {
    last_run: {
      at,
      root: root ?? null,
      found: found ?? null,
      landed: landed ?? null,
      failed: failed ?? null,
    },
  });
}
