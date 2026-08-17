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
 * The refusal for a tool that is not installed, as lines ready to print.
 *
 * The brew form is offered only where brew can actually run it: a `brew install`
 * suggested to someone without brew is not a remedy, it is a second thing to go
 * and install first.
 */
export function missingTool(bin, { brew, otherwise, darwin, hasBrew } = {}) {
  const onMac = darwin ?? os.platform() === 'darwin';
  const lines = [`error: ${bin} is not installed`];
  if (brew && onMac && hasBrew) lines.push(`  Install it with:  ${brew}`);
  else if (otherwise) lines.push(`  Install it with:  ${otherwise}`);
  return lines.join('\n');
}
