/**
 * playwright.mjs — finding the browser this platform drives.
 *
 * Douyin's feed API refuses unsigned requests, so an account's post list can
 * only be read out of a real page. That makes Playwright a dependency of this
 * platform and of nothing else — which is why `setup.sh` installs it only when
 * Douyin is asked for by name, and why somebody who only ever archives X is
 * never handed a Chromium download.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { Refusal } from '../shared/errors.mjs';
import { stateDir } from '../shared/paths.mjs';

export const PLATFORM = 'douyin';
export const STATE_DIR = stateDir(PLATFORM);
export const PROFILE_DIR = path.join(STATE_DIR, 'profile');

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
      const expected = path.join(STATE_DIR, 'node_modules', 'playwright');
      throw new Refusal('playwright-missing', 'playwright is not installed', {
        details: { expected_at: expected },
        remedy: { message: "run the skill's setup.sh for Douyin", command: 'setup.sh douyin', run_by: 'user' },
      });
    }
  }

  // playwright is CommonJS: imported by path, its exports land on `.default`
  // rather than as named exports, so `mod.chromium` alone is undefined.
  const api = mod?.chromium ? mod : mod?.default;
  if (!api?.chromium) {
    throw new Refusal('playwright-broken', 'playwright loaded but exposes no chromium export', {
      remedy: { message: "re-run the skill's setup.sh for Douyin", command: 'setup.sh douyin', run_by: 'user' },
    });
  }
  return api;
}
