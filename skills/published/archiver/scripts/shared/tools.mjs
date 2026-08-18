/**
 * tools.mjs — is the external tool there, and what does the user do if not.
 *
 * Reachable only through `ARCHIVER_SYSTEM_TOOLS=1`. Off that hatch a platform's
 * downloader comes out of a box this skill built, so "is it installed" is not a
 * question anybody has to ask; on it, the user is back on their own PATH and a
 * tool can simply not be there.
 *
 * The refusal is as precise here as anywhere else. A machine reached through the
 * hatch can never be reproduced from here, so the message is the entire
 * diagnostic.
 *
 * Nothing here installs anything, and nothing here names a package manager this
 * skill does not ship. A command suggested to somebody who does not have that
 * package manager is not a remedy, it is a second thing to go and install first.
 */
import { access, constants, stat } from 'node:fs/promises';
import path from 'node:path';

import { Refusal } from './errors.mjs';
import { systemTools } from './paths.mjs';

/**
 * Whether `bin` can be executed, searching PATH the way a shell would.
 *
 * `env` is injected so this is testable without depending on what happens to be
 * installed on the machine running the tests — which is the whole failure mode
 * a preflight test would otherwise have.
 */
export async function onPath(bin, env = {}) {
  const canExecute = env.canExecute ?? defaultCanExecute;

  // A name carrying a separator is a path already. Searching PATH for it would
  // look for `/usr/bin/./gallery-dl` and find nothing.
  if (bin.includes(path.sep) || bin.includes('/')) return canExecute(bin);

  const dirs = String(env.PATH ?? process.env.PATH ?? '')
    .split(path.delimiter)
    .filter(Boolean);
  for (const dir of dirs) {
    if (await canExecute(path.join(dir, bin))) return true;
  }
  return false;
}

async function defaultCanExecute(candidate) {
  try {
    // A directory carries the execute bit too, so `access` alone answers yes for
    // a folder named `yt-dlp` on PATH — the preflight passes and the failure
    // resurfaces later as an opaque spawn error nobody can read.
    const info = await stat(candidate);
    if (!info.isFile()) return false;
    await access(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * The refusal for a tool that is not installed, as a code, its facts, and a
 * remedy that is the user's to run — nothing here installs anything for anyone.
 */
export function missingTool(bin, { install = null, docs } = {}) {
  return new Refusal('tool-missing', `${bin} is not installed`, {
    details: { tool: bin, install },
    remedy: {
      message: docs ? `install ${bin} — see ${docs}` : `install ${bin}`,
      ...(install ? { command: install } : {}),
      run_by: 'user',
    },
  });
}

/**
 * The refusal for a downloader this machine does not have, or null when there is
 * nothing to refuse.
 *
 * Off the escape hatch there never is: the tool comes out of a box, and a box
 * that could not be built has refused already with a code of its own. Both
 * platforms ask the same question about a different binary, so they ask it here
 * rather than each keeping a copy of the answer.
 */
export async function hatchToolMissing(bin, { install, docs }, onPathImpl = onPath) {
  if (!systemTools()) return null;
  if (await onPathImpl(bin)) return null;
  return missingTool(bin, { install, docs });
}
