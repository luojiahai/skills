/**
 * cli.mjs — the argument parsing, file reading, JSON writing and entry-point
 * detection the other modules share.
 *
 * `account.mjs` and `plan.mjs` are small `<verb> --flag value` CLIs called from
 * archive.sh, and they had a copy each of this. The copies then drifted: one
 * learned that a flag with no value of its own must not swallow the flag after
 * it, and the other did not. One copy is how that stops happening again.
 */
import { realpathSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * True when `importMetaUrl` names the file node was asked to run. Each CLI
 * here dispatches only behind this: plan.mjs imports from account.mjs, and a
 * dispatch keyed on argv alone would run account's CLI on plan's arguments.
 * argv[1] is realpath'd because the skill is installed by symlink while node
 * resolves the entry module to its real location.
 */
export function isMainModule(importMetaUrl) {
  if (!process.argv[1]) return false;
  try {
    return pathToFileURL(realpathSync(process.argv[1])).href === importMetaUrl;
  } catch {
    return false;
  }
}

/**
 * `--folder DIR --require-match` → `{ folder: 'DIR', require_match: true }`.
 * Dashes become underscores so keys are readable as identifiers.
 */
export function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '').replace(/-/g, '_');
    const next = argv[i + 1];
    // A valueless flag such as --require-match must not eat the one after it.
    if (next === undefined || next.startsWith('--')) opts[key] = true;
    else opts[key] = argv[++i];
  }
  return opts;
}

/**
 * A flag's value as a string, treating "present but valueless" as absent.
 * archive.sh passes optional flags through unconditionally — `--name ""`
 * rather than omitting them — because a `${NAME:+--name "$NAME"}` that is
 * meant to vanish splits on spaces when it does not.
 */
export function optString(opts, key) {
  const value = opts[key];
  return typeof value === 'string' ? value : '';
}

export function requireOpts(opts, ...keys) {
  for (const key of keys) {
    if (!optString(opts, key)) {
      console.error(`error: --${key.replace(/_/g, '-')} is required`);
      process.exit(2);
    }
  }
}

/** Null rather than a throw: missing metadata or no plan is an ordinary answer. */
export async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Written to a temporary neighbour and renamed over the target, so a reader
 * sees either the old file or the new one and never half of either.
 *
 * post.json is the only copy of a post's caption, and account.json the only
 * thing saying whose folder this is — a plain write interrupted partway leaves
 * unparseable JSON where the record used to be, which reads as corrupt rather
 * than as absent. rename(2) within a directory is atomic, and the temporary
 * name carries the pid so two runs against one archive cannot collide on it.
 *
 * sync.json and archiver.json go through it too, though neither strictly needs
 * to: a truncated sync.json reads as "no plan", which is safe, and archiver.json
 * is one line. They use it because *every JSON file in an archive* going through
 * one write path is a rule that can be checked by looking, where "these two are
 * atomic and that one is not" is a distinction someone has to remember.
 */
export async function writeJson(file, value) {
  const temp = `${file}.${process.pid}.tmp`;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temp, file);
  return value;
}

/** Empty rather than a throw: no archive means nothing has been downloaded. */
export async function readText(file) {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return '';
  }
}

/**
 * A plain write, for the scratch files the shell reads back.
 *
 * Not atomic, and does not need to be: these live in the system temp directory
 * for the length of one run and are cleaned up by an EXIT trap. Only the
 * archive's own files go through writeJson.
 */
export async function writeText(file, contents) {
  await writeFile(file, contents);
}
