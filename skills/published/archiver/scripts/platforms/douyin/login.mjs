/**
 * login.mjs — sign in to Douyin once, and stop.
 *
 * This is its own step, and finishing it does not start anything. Only a human
 * can pass Douyin's login, so the browser opens, the person signs in, and the
 * run ends having established a session and nothing else. Whether to archive
 * anything is a separate question, asked afterwards.
 *
 * It waits by *observing* the session rather than by asking. A keypress is the
 * user asserting they are signed in; the cookie appearing is the fact. Trust the
 * assertion and an Enter pressed a moment early is indistinguishable from an
 * expired session — both produce a collection that finds zero posts.
 *
 * Enter is still honoured, as the way out for somebody who has given up or who
 * hit a verification wall this cannot see past. It ends the wait; it does not
 * claim success, which is decided by looking either way.
 */
import { createInterface } from 'node:readline';

import { progress } from '../../shared/output.mjs';
import { loadPlaywright } from './playwright.mjs';
import { hasSession } from './session.mjs';

const POLL_MS = 1000;
const TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Resolves `{ ok }`, or `{ ok: false, code, reason, details }`. `ok` means the
 * profile now holds a Douyin session — never merely that the browser was opened
 * and closed.
 *
 * Giving up and running out of time are two codes, because they lead to
 * different things being said: one person stopped waiting, the other never got
 * as far as the login.
 */
export async function login({
  url,
  profileDir,
  log = progress,
  launch,
  pollMs = POLL_MS,
  timeoutMs = TIMEOUT_MS,
  input = process.stdin,
} = {}) {
  const chromium = launch ?? (await loadPlaywright()).chromium;

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    viewport: { width: 1280, height: 900 },
    locale: 'zh-CN',
  });

  let giveUp = false;
  const keys = input?.readable ? createInterface({ input }) : null;
  keys?.on('line', () => {
    giveUp = true;
  });

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

    log(
      '\n[douyin] A browser is open. Sign in to Douyin there.\n' +
        '         This will notice by itself and close when you are signed in.\n' +
        '         Press Enter here to stop waiting.\n',
    );

    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (hasSession(await context.cookies())) {
        log('[douyin] signed in — the session is saved and every later run is headless.');
        return { ok: true };
      }
      if (giveUp) {
        return {
          ok: false,
          code: 'login-abandoned',
          reason: 'the wait was ended before a Douyin session appeared',
        };
      }
      if (Date.now() >= deadline) {
        return {
          ok: false,
          code: 'login-timed-out',
          reason: 'gave up waiting for a sign-in',
          details: { waited_seconds: Math.round(timeoutMs / 1000) },
        };
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  } finally {
    keys?.close();
    await context.close();
  }
}
