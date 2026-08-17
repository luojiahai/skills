/**
 * run.mjs — Douyin's entry point, as the dispatcher expects to find it.
 *
 * Every platform exposes `main(argv)` and owns everything past it: its own flag
 * set, its own tool preflight, its own exit code. Here that run is orchestrated
 * by archive.sh, which this hands the command line to and waits on.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { EXIT } from '../shared/exit.mjs';

const ARCHIVE_SH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'archive.sh');

export function main(argv) {
  return new Promise((resolve) => {
    const child = spawn(ARCHIVE_SH, argv, { stdio: 'inherit' });

    child.on('error', (error) => {
      console.error(`error: could not run the Douyin archiver — ${error.message}`);
      resolve(EXIT.FAILED);
    });

    // A signal is not an exit code, and reporting 0 for one would tell the
    // caller a run that was killed had finished.
    child.on('close', (code, signal) => {
      resolve(signal ? EXIT.FAILED : (code ?? EXIT.FAILED));
    });
  });
}
