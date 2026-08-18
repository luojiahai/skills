/**
 * session.mjs — the browser session a gallery-dl platform runs on, as a file.
 *
 * X's login cannot be scripted, and Instagram's can only be scripted into a
 * checkpoint. Both are therefore the same shape: the session comes out of a
 * browser a human has already signed in to, once, and every later run reads the
 * export instead. There is no sign-in to automate here and there never will be.
 *
 * Threaded with `{ platform, label }` rather than copied per platform, because
 * two copies of a cookie cache is two places for a file mode, a refusal code or
 * an export invocation to drift — and the platform that drifts is the one whose
 * live session token ends up world-readable. `platform` names the state
 * directory, `label` is what a refusal calls the site.
 *
 * Douyin does not come through here: it drives a real browser profile rather
 * than a cookie jar, which is `douyin/session.mjs`.
 */
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, chmod, mkdir, rm } from 'node:fs/promises';

import { Refusal } from './errors.mjs';
import { cookieFile, stateDir } from './paths.mjs';

/** The browsers gallery-dl can read a session out of, for a refusal that lists them. */
export const BROWSERS = ['chrome', 'firefox', 'safari', 'edge', 'brave', 'chromium', 'opera', 'vivaldi'];

/**
 * Always a cookies.txt path, never a live browser read.
 *
 * The session is resolved to a file before any downloading invocation is built.
 * Reading a browser profile prompts for Keychain access on macOS and wants the
 * browser closed, and a plan and a go would each pay it; twice per download is
 * the friction that makes people paste a raw token instead.
 */
export function cookieArgs({ cookies }) {
  return cookies ? ['--cookies', cookies] : [];
}

/** Seed the cache: read the browser once, write what it found to `cookies`. */
export function cookieExportArgs({ browser, cookies, url }) {
  return [
    '--config-ignore',
    '--cookies-from-browser',
    browser,
    '--cookies-export',
    cookies,
    '--simulate',
    '--range',
    '1',
    url,
  ];
}

/**
 * The session for one platform, as a cookies.txt path: the file the user named,
 * else the cached export, else one minted from a browser they name.
 *
 * `bin` is gallery-dl, and only the minting branch uses it — which is why a run
 * with a cached session needs no downloader to answer.
 */
export async function ensureCookies(
  { platform, label },
  { cookies, browser, url, bin, spawnImpl = spawn } = {},
) {
  if (cookies) return cookies;

  const file = cookieFile(platform);
  try {
    await access(file, constants.R_OK);
    return file;
  } catch {
    // No cache yet — fall through and make one.
  }

  if (!browser) {
    throw new Refusal(
      'no-session-source',
      `no saved ${label} session yet, and no browser to read one from`,
      {
        details: { browsers: BROWSERS },
        remedy: {
          message:
            `sign in to ${label} in a browser and say which one to read the session from, ` +
            'or point this at an exported cookies.txt',
          run_by: 'user',
        },
      },
    );
  }

  // 0700 before gallery-dl is started, not after it finishes. The export is
  // written by the child at its own umask, and that window is the whole of the
  // run — seconds to minutes with a keychain prompt pending — during which a
  // live session token would otherwise be readable by anyone on the machine.
  // The directory mode closes it whatever mode the file lands with.
  const dir = stateDir(platform);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700).catch(() => {});

  const code = await new Promise((resolve) => {
    const child = spawnImpl(bin, cookieExportArgs({ browser, cookies: file, url }), {
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    child.on('close', resolve);
    child.on('error', () => resolve(-1));
  });

  if (code !== 0) {
    throw new Refusal('session-unreadable', `could not read a ${label} session from ${browser}`, {
      details: { browser },
      remedy: {
        message: `close ${browser} and try again, or sign in to ${label} in it first`,
        run_by: 'user',
      },
    });
  }

  // It is a live session token sitting in a file; nobody else on this machine
  // needs to be able to read it.
  await chmod(file, 0o600).catch(() => {});
  return file;
}

/**
 * A rejected session is discarded, so the next run reads the browser again.
 *
 * Per platform, because the refusal that calls this is per platform: X
 * rejecting a session says nothing about the Instagram one, and throwing both
 * away would charge the user a second Keychain prompt for a login that works.
 */
export async function discardCookies(platform) {
  await rm(cookieFile(platform), { force: true });
}
