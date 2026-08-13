/**
 * paths.mjs — where state lives, and how Playwright is found.
 *
 * The skill directory is pure source: it may be installed read-only, inside a
 * plugin directory that updates replace, or anywhere on disk. So nothing
 * mutable is stored relative to it.
 *
 *   session, cookies, node_modules → ${XDG_STATE_HOME:-~/.local/state}/douyin-downloader/
 *   downloads                      → <git root of cwd, else cwd>/downloads/
 *
 * Session state is user-level so you log in once rather than once per project;
 * downloads are project-level so an archive lives beside the work it belongs to.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const STATE_DIR = path.join(
  process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'),
  'douyin-downloader',
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
 * Downloads belong to the project you are working in, not to the skill — and a
 * cwd inside the skill is how they end up in the skill. Told to run
 * `scripts/download.sh`, an agent tends to cd there first, and then the cwd
 * names the skill rather than the project, so a whole archive lands in a folder
 * the next update replaces. Such a cwd counts for nothing here: the project is
 * recovered from the install path, and if that names none either this throws
 * rather than guessing.
 */
export function downloadsRoot(cwd = process.cwd()) {
  const here = realpathSync(cwd);
  if (here === SKILL_DIR || here.startsWith(SKILL_DIR + path.sep)) {
    const project = projectFromInstall();
    if (project) return path.join(project, 'downloads');
    throw new Error(
      `cannot tell which project these downloads belong to — the working ` +
        `directory is inside the skill (${cwd}), which the next update replaces.\n` +
        `  run from the project directory, or pass --downloads DIR`,
    );
  }

  try {
    const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (root) return path.join(root, 'downloads');
  } catch {
    // Not a git repository — fall through to cwd.
  }
  return path.join(cwd, 'downloads');
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
