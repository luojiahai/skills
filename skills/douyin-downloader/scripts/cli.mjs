/**
 * cli.mjs — the argument parsing and file reading shared by cursor.mjs and
 * plan.mjs.
 *
 * Both are small `<verb> --flag value` CLIs called from download.sh, and they
 * had a copy each of this. The copies then drifted: one learned that a flag
 * with no value of its own must not swallow the flag after it, and the other
 * did not. One copy is how that stops happening again.
 */
import { readFile } from 'node:fs/promises';

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
 * download.sh passes optional flags through unconditionally — `--name ""`
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

/** Null rather than a throw: a missing cursor or plan is an ordinary answer. */
export async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Empty rather than a throw: no archive means nothing has been downloaded. */
export async function readText(file) {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return '';
  }
}
