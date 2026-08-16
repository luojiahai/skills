/**
 * paths.mjs — where state lives, and how Playwright is found.
 *
 * The skill directory is pure source: it may be installed read-only, inside a
 * plugin directory that updates replace, or anywhere on disk. So nothing
 * mutable is stored relative to it.
 *
 *   session, cookies, node_modules → ${XDG_STATE_HOME:-~/.local/state}/douyin-archiver/
 *   archives                       → <git root of cwd, else cwd>/archives/
 *
 * Session state is user-level so you log in once rather than once per project;
 * archives are project-level so an archive lives beside the work it belongs to.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const STATE_DIR = path.join(
  process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'),
  'douyin-archiver',
);

export const PROFILE_DIR = path.join(STATE_DIR, 'profile');
export const COOKIE_FILE = path.join(STATE_DIR, 'cookies.txt');

/** Symlinks resolved, so a symlinked install still compares equal to a cwd inside it. */
const SKILL_DIR = realpathSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));

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
 * recovered from the install path, and if that names none either this throws
 * rather than guessing.
 */
export function archivesRoot(cwd = process.cwd()) {
  const here = realpathSync(cwd);
  if (here === SKILL_DIR || here.startsWith(SKILL_DIR + path.sep)) {
    const project = projectFromInstall();
    if (project) return path.join(project, 'archives');
    throw new Error(
      `cannot tell which project this archive belongs to — the working ` +
        `directory is inside the skill (${cwd}), which the next update replaces.\n` +
        `  run from the project directory, or pass --archives DIR`,
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
 * `--archives /tmp/dy` has to normalise the same way `/tmp` itself does or a
 * plan made one way is refused the other.
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

/**
 * Playwright is installed into the state directory by setup.sh, which is
 * outside Node's upward module resolution — so it is loaded by explicit path.
 * Falls back to normal resolution so the scripts still run from a checkout
 * that has its own node_modules (development, or a repo-local install).
 */
export async function loadPlaywright() {
  const installed = path.join(STATE_DIR, 'node_modules', 'playwright', 'index.js');

  let mod;
  if (existsSync(installed)) {
    mod = await import(pathToFileURL(installed).href);
  } else {
    try {
      mod = await import('playwright');
    } catch {
      throw new Error(
        "playwright not installed — run the skill's setup.sh\n" +
          `  expected at: ${path.join(STATE_DIR, 'node_modules', 'playwright')}`,
      );
    }
  }

  // playwright is CommonJS: imported by path, its exports land on `.default`
  // rather than as named exports, so `mod.chromium` alone is undefined.
  const api = mod?.chromium ? mod : mod?.default;
  if (!api?.chromium) {
    throw new Error('playwright loaded but exposes no chromium export');
  }
  return api;
}
