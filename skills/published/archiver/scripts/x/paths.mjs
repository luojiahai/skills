/**
 * paths.mjs — the single source of truth for where things live.
 *
 * The skill directory is pure source: it may be installed read-only, inside a
 * plugin directory that updates replace, or moved anywhere on disk. So nothing
 * mutable is stored relative to it.
 *
 *   cached cookies → ${XDG_STATE_HOME:-~/.local/state}/archiver/x/cookies.txt
 *   archives       → --archives DIR, else <git root of cwd, else cwd>/archives/
 *
 * Cookies are user-level so a session is extracted once rather than once per
 * project; archives are project-level so an archive lives beside the work it
 * belongs to. The archives root is computed *here and only here* — two answers
 * to it would put one account in two folders and re-download everything.
 */
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const STATE_DIR = path.join(
  process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'),
  'archiver', 'x',
);

/** The cached session, exported from the browser once and reused until X rejects it. */
export const COOKIE_FILE = path.join(STATE_DIR, 'cookies.txt');

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
