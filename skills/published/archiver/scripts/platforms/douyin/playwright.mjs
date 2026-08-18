/**
 * playwright.mjs — finding the browser this platform drives.
 *
 * Douyin's feed API refuses unsigned requests, so an account's post list can
 * only be read out of a real page. That makes Playwright a dependency of this
 * platform and of nothing else — which is why the `browser` box is the one built
 * lazily, and why somebody who only ever archives X never downloads Chromium.
 *
 * Playwright and its Chromium both come out of that box, so the version driving
 * the page is the version the manifest pins. `PLAYWRIGHT_BROWSERS_PATH` is set
 * here rather than exported by `ensure-env`, because an environment variable
 * would only exist for a process launched through `archive.sh` and running
 * `run.mjs` directly would silently drive a different browser.
 */
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { Refusal } from '../../shared/errors.mjs';
import { browserBox, stateDir, systemTools } from '../../shared/paths.mjs';

export const PLATFORM = 'douyin';
export const STATE_DIR = stateDir(PLATFORM);
export const PROFILE_DIR = path.join(STATE_DIR, 'profile');

/**
 * The browser this platform drives, out of the box that holds it.
 *
 * The escape hatch is the one path back to an install we did not make: there
 * Playwright is resolved the ordinary way and a machine that has none is
 * refused, because that machine can never be reproduced from here and the
 * refusal is the whole diagnostic.
 */
export async function loadPlaywright() {
  const box = browserBox();

  let mod;
  if (systemTools()) {
    try {
      mod = await import('playwright');
    } catch {
      throw new Refusal('playwright-missing', 'playwright is not installed', {
        details: { expected_at: null },
        remedy: {
          message:
            'install Playwright and its Chromium, or unset ARCHIVER_SYSTEM_TOOLS and let ' +
            'the skill build its own',
          run_by: 'user',
        },
      });
    }
  } else {
    if (!existsSync(box.playwright)) {
      throw new Refusal('playwright-missing', 'the browser box holds no playwright', {
        details: { expected_at: box.playwright },
        remedy: { message: "run the skill's setup.sh for Douyin", command: 'setup.sh douyin', run_by: 'user' },
      });
    }
    process.env.PLAYWRIGHT_BROWSERS_PATH = box.browsers;
    mod = await import(pathToFileURL(box.playwright).href);
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

/**
 * Clears everything from the state directory that is not a session.
 *
 * The state directory holds what must survive the skill being replaced — a
 * session, a cookie jar — and a dependency tree is not that: it is re-derivable,
 * so it belongs in the cache, and a copy sitting here is a hundred megabytes
 * nothing reads. Run on every Douyin command, and a no-op on a state directory
 * that holds only what it should.
 *
 * `cookies.txt` and `profile/` are never touched. Neither is the shared
 * Playwright browser cache at `~/Library/Caches/ms-playwright`: other tools write
 * to it, this skill neither reads nor writes it, and it is not ours to delete.
 */
export async function discardDerivedState(dir = STATE_DIR) {
  await Promise.all(
    ['node_modules', 'package.json', 'package-lock.json', 'chromium-install.log'].map((name) =>
      rm(path.join(dir, name), { recursive: true, force: true }).catch(() => {}),
    ),
  );
}
