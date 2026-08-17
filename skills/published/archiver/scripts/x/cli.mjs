/**
 * cli.mjs — argument parsing, file reading and entry-point detection.
 *
 * run.mjs is the only entry point; every other module here is a library it
 * calls. This file is what those two facts are expressed through: one command
 * line parser, and one answer to "was I the file node was asked to run".
 */
import { realpathSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * True when `importMetaUrl` names the file node was asked to run. Each CLI
 * dispatches only behind this: the modules import from each other, and a
 * dispatch keyed on argv alone would run one module's CLI on another's
 * arguments. argv[1] is realpath'd because the skill is installed by symlink
 * while node resolves the entry module to its real location.
 */
export function isMainModule(importMetaUrl) {
  if (!process.argv[1]) return false;
  try {
    return pathToFileURL(realpathSync(process.argv[1])).href === importMetaUrl;
  } catch {
    return false;
  }
}

/** Flags that are on or off. Everything else takes the argument after it. */
export const BOOLEAN_FLAGS = new Set(['plan', 'go', 'yes', 'y', 'full', 'unalias', 'help', 'h']);

/** Every flag this entry point accepts. Anything else is a usage error. */
export const KNOWN_FLAGS = new Set([
  ...BOOLEAN_FLAGS,
  'archives',
  'alias',
  'browser',
  'cookies',
]);

/**
 * A command line into `{ opts, positional, unknown }`.
 *
 * Boolean flags are declared rather than guessed: `--full --archives DIR`
 * must not read DIR as the value of --full, and `--alias --plan` must not
 * silently name a folder "--plan".
 */
export function parseCommandLine(argv, { booleans = BOOLEAN_FLAGS, known = KNOWN_FLAGS } = {}) {
  const opts = {};
  const positional = [];
  const unknown = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--') {
      positional.push(...argv.slice(i + 1));
      break;
    }

    if (arg.length > 1 && arg.startsWith('-')) {
      const key = arg.replace(/^--?/, '').replace(/-/g, '_');
      if (known && !known.has(key)) {
        unknown.push(arg);
        continue;
      }
      if (booleans.has(key)) {
        opts[key] = true;
        continue;
      }
      const next = argv[i + 1];
      opts[key] = next === undefined || next.startsWith('-') ? true : argv[++i];
      continue;
    }

    positional.push(arg);
  }

  return { opts, positional, unknown };
}

/**
 * A flag's value as a string, treating "present but valueless" as absent.
 * archive.sh passes optional flags through unconditionally — `--alias ""`
 * rather than omitting them — because a `${ALIAS:+--alias "$ALIAS"}` that is
 * meant to vanish splits on spaces when it does not.
 *
 * It is also why an empty `--alias` cannot mean "remove the alias": an empty
 * value is how a flag says nothing at all. `--unalias` is the removal.
 */
export function optString(opts, key) {
  const value = opts[key];
  return typeof value === 'string' ? value : '';
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
 * post.json is the only copy of a post's words, and account.json the only thing
 * saying whose folder this is — a plain write interrupted partway leaves
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
