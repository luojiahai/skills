/**
 * tools.mjs — is the external tool there, and what does the user do if not.
 *
 * Each platform runs on a downloader it cannot install for anyone: yt-dlp for
 * Douyin, gallery-dl for X. The preflight belongs to the platform — the
 * dispatcher checks nothing but node — and this is the shape they share.
 *
 * Nothing here installs anything. It reports, with the command that fixes it.
 */
import { access, constants } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { Refusal } from './errors.mjs';

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
    await access(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * The command that installs a tool on *this* machine, or null.
 *
 * The brew form is offered only where brew can actually run it: a `brew install`
 * suggested to someone without brew is not a remedy, it is a second thing to go
 * and install first.
 */
export function installCommand(bin, { brew, otherwise, darwin, hasBrew } = {}) {
  const onMac = darwin ?? os.platform() === 'darwin';
  if (brew && onMac && hasBrew) return brew;
  return otherwise ?? null;
}

/**
 * The refusal for a tool that is not installed, as a code, its facts, and a
 * remedy that is the user's to run — nothing here installs anything for anyone.
 */
export function missingTool(bin, { brew, otherwise, docs, darwin, hasBrew } = {}) {
  const install = installCommand(bin, { brew, otherwise, darwin, hasBrew });
  return new Refusal('tool-missing', `${bin} is not installed`, {
    details: { tool: bin, install },
    remedy: {
      message: docs ? `install ${bin} — see ${docs}` : `install ${bin}`,
      ...(install ? { command: install } : {}),
      run_by: 'user',
    },
  });
}
