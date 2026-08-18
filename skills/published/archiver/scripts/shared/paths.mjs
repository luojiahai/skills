/**
 * paths.mjs — the single source of truth for where things live.
 *
 * The skill directory is pure source: it may be installed read-only, inside a
 * plugin directory that updates replace, or moved anywhere on disk. So nothing
 * mutable is stored relative to it.
 *
 *   sessions and cookies    → ${XDG_STATE_HOME:-~/.local/state}/archiver/<platform>/
 *   the tools this skill runs → ${XDG_CACHE_HOME:-~/.cache}/archiver/<box>-<key>/
 *   archives                → --archives DIR, else <git root of cwd, else cwd>/archives/
 *
 * State is user-level so a session is established once rather than once per
 * project, and split per platform because signing in to one says nothing about
 * the other. Tools are cache because they are re-derivable from the manifest,
 * which is what makes deleting the whole cache root unconditionally safe — no
 * support answer ever has to warn somebody they are about to lose a login that
 * cost them a QR scan. Archives are project-level so an archive lives beside the
 * work it belongs to, and one root holds every platform — which is why the root
 * is computed *here and only here*: two answers to it would put one account in
 * two folders and re-download everything.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Refusal } from './errors.mjs';

/** Where one platform keeps what it must not lose when the skill is replaced. */
export function stateDir(platform) {
  return path.join(
    process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'),
    'archiver',
    platform,
  );
}

/** The cached session, minted once and reused until the platform rejects it. */
export function cookieFile(platform) {
  return path.join(stateDir(platform), 'cookies.txt');
}

/** Symlinks resolved, so a symlinked install still compares equal to a cwd inside it. */
const SKILL_DIR = realpathSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..'));

/**
 * <project>/.claude/skills/<skill> and <project>/.agents/skills/<skill> are the
 * two install layouts that name their own project. Null for any other.
 */
function projectFromInstall() {
  const skills = path.dirname(SKILL_DIR);
  const harness = path.dirname(skills);
  if (path.basename(skills) !== 'skills') return null;
  if (path.basename(harness) !== '.claude' && path.basename(harness) !== '.agents') return null;
  return path.dirname(harness);
}

/**
 * Archives belong to the project you are working in, not to the skill — and a
 * cwd inside the skill is how they end up in the skill. Told to run
 * `scripts/archive.sh`, an agent tends to cd there first, and then the cwd
 * names the skill rather than the project, so a whole archive lands in a folder
 * the next update replaces. Such a cwd counts for nothing here: the project is
 * recovered from the install path, and where that names none this throws rather
 * than guessing. Guessing is the one thing it must not do.
 */
export function archivesRoot(cwd = process.cwd()) {
  const here = realpathSync(cwd);
  if (here === SKILL_DIR || here.startsWith(SKILL_DIR + path.sep)) {
    const project = projectFromInstall();
    if (project) return path.join(project, 'archives');
    throw new Refusal(
      'root-in-skill',
      `cannot tell which project this archive belongs to — the working ` +
        `directory is inside the skill (${cwd}), which the next update replaces`,
      {
        details: { cwd: String(cwd) },
        remedy: {
          message: 'run this from the project directory, or name the archives root explicitly',
          run_by: 'agent',
        },
      },
    );
  }

  try {
    const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (root) return path.join(root, 'archives');
  } catch {
    // Not a git repository — fall through to cwd.
  }
  return path.join(cwd, 'archives');
}

/**
 * An archives root given on the command line, made absolute and tilde-free.
 *
 * The agent passes the user's flag through as typed, and a quoted `~/data`
 * never reaches the shell's expansion — so the expansion happens here instead,
 * once, where every caller agrees on the answer. Storing anything relative
 * would be worse than useless: `./archives` resolved from a different working
 * directory is a different archive.
 */
export function normalizeRoot(dir, cwd = process.cwd()) {
  let expanded = String(dir);
  if (expanded === '~') expanded = os.homedir();
  else if (expanded.startsWith('~/')) expanded = path.join(os.homedir(), expanded.slice(2));
  return realpathPrefix(path.resolve(cwd, expanded));
}

/**
 * The path with symlinks resolved as far as it exists, keeping the rest as
 * given. An archives root often does not exist yet, so plain realpath is not
 * available — but the *default* root is read off the real filesystem, so
 * `--archives /tmp/x` has to normalise the same way `/tmp` itself does, or a
 * plan made one way is refused the other. On macOS that is not hypothetical:
 * /tmp is a symlink to /private/tmp.
 */
function realpathPrefix(target) {
  const tail = [];
  let head = target;
  for (;;) {
    try {
      return path.join(realpathSync(head), ...tail);
    } catch {
      const parent = path.dirname(head);
      if (parent === head) return target;
      tail.unshift(path.basename(head));
      head = parent;
    }
  }
}

// ---- the tool boxes --------------------------------------------------------
//
// The skill runs its downloaders out of directories it built itself, keyed by
// the manifest they were built from. `env/ensure-env` builds them; this resolves
// them, and the two compute the key the same way on purpose — one puts the box
// on disk and the other has to find the same box again.
//
// Resolved here rather than exported as environment variables by `ensure-env`,
// because those would only exist for a process launched through `archive.sh`.
// Running `run.mjs` directly — which happens constantly while debugging — would
// then silently take a different path.

/** Where `env/` is: the manifest, the pins, and the builder. */
export const ENV_DIR = path.join(SKILL_DIR, 'env');

/**
 * `setup.sh`, spelled the way the invocation that reached here spelled it.
 *
 * A refusal naming it is a command somebody has to be able to run, and the
 * skill is routinely installed by symlink — so the path the caller used beats
 * the one this file resolved itself to.
 */
export function setupScript() {
  const invoked = process.env.ARCHIVE_SELF;
  if (!invoked) return path.join(SKILL_DIR, 'setup.sh');
  return path.join(path.dirname(path.dirname(invoked)), 'setup.sh');
}

/** The three boxes, partitioned by volatility and size rather than by platform. */
export const BOXES = ['runtime', 'tools', 'browser'];

/** Everything the boxes are built into, and the one directory `clean` deletes. */
export function cacheRoot() {
  return path.join(
    process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'),
    'archiver',
  );
}

/**
 * Back to whatever is on PATH. Documented as unsupported and all-or-nothing:
 * per-tool hatches would multiply the configuration space that owning the
 * environment exists to eliminate.
 */
export function systemTools() {
  return process.env.ARCHIVER_SYSTEM_TOOLS === '1';
}

/**
 * The manifest's `key = value` lines, per section, with comments and blank lines
 * dropped and the whitespace around `=` collapsed.
 *
 * Normalising before anything is hashed is what lets the comments in that file
 * be rewritten freely: a box key answers to its versions, so re-wording a note
 * never costs anybody a re-download.
 */
export function parseManifest(text) {
  const sections = new Map();
  let current = null;
  for (const line of String(text).split('\n')) {
    if (line.startsWith('[')) {
      const name = /^\[([^\]]+)\]$/.exec(line);
      current = name ? name[1] : null;
      if (current) sections.set(current, []);
      continue;
    }
    if (!current) continue;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const at = trimmed.indexOf('=');
    if (at < 0) continue;
    sections.get(current).push(`${trimmed.slice(0, at).trim()}=${trimmed.slice(at + 1).trim()}`);
  }
  return sections;
}

let manifestCache = null;

function manifest() {
  manifestCache ??= parseManifest(readFileSync(path.join(ENV_DIR, 'manifest'), 'utf8'));
  return manifestCache;
}

/** One pinned value, or null for a section or key the manifest does not carry. */
export function pin(section, key, sections = manifest()) {
  const line = (sections.get(section) ?? []).find((entry) => entry.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1) : null;
}

/**
 * What a box's key is computed over.
 *
 * Its own section always. For `tools` also the interpreter it resolves against
 * and the two files that pin the downloaders — uv resolves tools against the
 * CPython it was given, so a Python bump has to invalidate them, and the lock is
 * what fixes the transitive tree. Deliberately *not* for `runtime` and
 * `browser`: folding the lock into those would re-download a hundred megabytes
 * of interpreter and browser for a yt-dlp patch, which is the exact cost the
 * partition by volatility exists to avoid.
 */
function keyInput(box, sections, readFile) {
  const lines = (sections.get(box) ?? []).map((entry) => `${entry}\n`).join('');
  if (box !== 'tools') return lines;
  return (
    lines +
    `python=${pin('runtime', 'python', sections)}\n` +
    readFile(pin('tools', 'pinned-by', sections)) +
    readFile(pin('tools', 'locked-by', sections))
  );
}

/** A box's short key: the first 12 hex characters of that input's SHA-256. */
export function boxKey(box, sections = manifest(), readFile = readEnvFile) {
  if (sections !== manifest() || readFile !== readEnvFile) return digest(box, sections, readFile);
  keyCache[box] ??= digest(box, sections, readFile);
  return keyCache[box];
}

const keyCache = {};

function digest(box, sections, readFile) {
  return createHash('sha256').update(keyInput(box, sections, readFile)).digest('hex').slice(0, 12);
}

function readEnvFile(name) {
  return readFileSync(path.join(ENV_DIR, name), 'utf8');
}

/**
 * Where a box is.
 *
 * `tools` answers to a refresh that is still current: the override records the
 * shipped key it was taken against, so a refreshed box stays in use until a
 * shipped bump passes it, and then stops applying by itself rather than needing
 * anybody to remember to clear it.
 */
export function boxDir(box, root = cacheRoot()) {
  const key = boxKey(box);
  if (box === 'tools' && refreshedPast(key, root)) {
    return path.join(root, `tools-latest-${key}`);
  }
  return path.join(root, `${box}-${key}`);
}

function refreshedPast(key, root) {
  try {
    return readFileSync(path.join(root, 'tools-override'), 'utf8') === key;
  } catch {
    return false;
  }
}

/** Roughly what a cold build of a box pulls down, in megabytes. */
export function downloadSize(box) {
  return Number(pin('download', box)) || 0;
}

/**
 * Where one tool is. A resolved path into a box we built, or the bare name for
 * a shell to find on PATH when the escape hatch is set — never a mixture, and
 * never a fallback: a build that failed must not quietly become a different
 * version of the tool, which is the ambiguity owning the environment removes.
 */
export function toolPath(tool) {
  if (systemTools()) return tool;
  if (tool !== 'yt-dlp' && tool !== 'gallery-dl') {
    throw new Error(`no box holds a tool called '${tool}'`);
  }
  return path.join(boxDir('tools'), 'venv', 'bin', tool);
}

/** Playwright's package, and the browsers directory it is pointed at. */
export function browserBox(root = cacheRoot()) {
  const dir = boxDir('browser', root);
  return {
    playwright: path.join(dir, 'node_modules', 'playwright', 'index.js'),
    browsers: path.join(dir, 'browsers'),
  };
}
