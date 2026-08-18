/**
 * session.mjs — the Douyin session: whether there is one, and handing it to yt-dlp.
 *
 * The Playwright profile is the single source of session truth. It is signed in
 * by construction, whereas your everyday browser may have no Douyin session at
 * all. yt-dlp cannot read a Playwright profile directly but it accepts
 * `--cookies <netscape-file>`, so the profile is exported on demand and the file
 * is a cache — re-minted only when Douyin actually rejects it, so the common
 * path costs no browser launch.
 */
import { chmod, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

import { Refusal } from '../shared/errors.mjs';
import { loadPlaywright } from './playwright.mjs';

/**
 * The cookies that mean somebody signed in, as opposed to merely having visited.
 *
 * Douyin issues a pile of tracking cookies to anonymous visitors, so "the
 * profile has douyin cookies" is not the same question as "the profile has a
 * session" — and answering the first when the second was asked is what makes a
 * run get all the way to a browser before reporting an empty grid.
 */
const SESSION_COOKIES = ['sessionid', 'sessionid_ss', 'sid_tt'];

/** Anchored on a label boundary: a lookalike ending in `…notdouyin.com` does not qualify. */
const DOUYIN_DOMAIN = /(^|\.)douyin\.com$/;

export function isSessionCookie(cookie) {
  return (
    DOUYIN_DOMAIN.test(cookie?.domain ?? '') &&
    SESSION_COOKIES.includes(cookie?.name) &&
    Boolean(cookie?.value)
  );
}

export function douyinCookies(cookies) {
  return (cookies ?? []).filter((cookie) => DOUYIN_DOMAIN.test(cookie?.domain ?? ''));
}

export function hasSession(cookies) {
  return (cookies ?? []).some(isSessionCookie);
}

/**
 * Netscape format: domain, includeSubdomains, path, secure, expiry, name, value.
 * Session cookies (expires === -1) get 0, which yt-dlp reads as non-expiring.
 */
export function toNetscape(cookies) {
  return [
    '# Netscape HTTP Cookie File',
    '# Minted from the Douyin browser profile — regenerated automatically when stale.',
    ...cookies.map((c) =>
      [
        c.domain,
        c.domain.startsWith('.') ? 'TRUE' : 'FALSE',
        c.path || '/',
        c.secure ? 'TRUE' : 'FALSE',
        c.expires && c.expires > 0 ? Math.floor(c.expires) : 0,
        c.name,
        c.value,
      ].join('\t'),
    ),
  ].join('\n') + '\n';
}

/**
 * Whether the cached cookies.txt still holds a live session, read off the file
 * and without opening anything.
 *
 * This is the check that makes the cache a cache. Minting reads the Playwright
 * profile, which means launching Chromium — the slowest thing in the skill — so
 * a `--go` that could have used the file on disk and launched a browser anyway
 * is paying the whole cost of not having a cache at all.
 *
 * Freshness is the cookies' own expiry rather than the file's age: the file
 * says when each cookie dies, and a made-up TTL would either re-mint a session
 * that is good for weeks or trust one that expired yesterday. `0` in the expiry
 * column is how `toNetscape` spells a session cookie with no expiry of its own,
 * and reads as live.
 *
 * It cannot say whether Douyin still *accepts* the session — nothing local can.
 * That is answered by yt-dlp asking for fresh cookies mid-download, which is
 * what re-mints them.
 */
export async function hasFreshCookies(cookieFile, now = Date.now()) {
  let text;
  try {
    text = await readFile(cookieFile, 'utf8');
  } catch {
    return false;
  }

  const seconds = Math.floor(now / 1000);
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const [domain, , , , expires, name, value] = line.split('\t');
    if (!DOUYIN_DOMAIN.test(domain ?? '')) continue;
    if (!SESSION_COOKIES.includes(name) || !value) continue;
    const at = Number(expires);
    if (!Number.isFinite(at) || at === 0 || at > seconds) return true;
  }
  return false;
}

/** Throws the cached session away, so the next run mints a new one. */
export async function discardCookies(cookieFile) {
  await rm(cookieFile, { force: true });
}

/** Whether the profile holds a session, without downloading anything. */
export async function profileHasSession(profileDir, { launch } = {}) {
  return hasSession(await readProfileCookies(profileDir, { launch }));
}

async function readProfileCookies(profileDir, { launch } = {}) {
  const chromium = launch ?? (await loadPlaywright()).chromium;
  const context = await chromium.launchPersistentContext(profileDir, { headless: true });
  try {
    return await context.cookies();
  } finally {
    await context.close();
  }
}

/**
 * Writes the profile's Douyin cookies where yt-dlp can read them, and returns
 * that path.
 *
 * The directory is 0700 and the file 0600, and both are set rather than
 * requested. `writeFile`'s `mode` applies only when it *creates* the file, so a
 * cookies.txt left at 0644 by a restore or by hand is overwritten with a live
 * session at its old permissions — and the directory mode is what makes the
 * file unreachable regardless of its own.
 */
export async function mintCookies(profileDir, cookieFile, { launch } = {}) {
  const cookies = douyinCookies(await readProfileCookies(profileDir, { launch }));

  if (!cookies.length) {
    throw new Refusal(
      'session-empty',
      'no douyin.com cookies in the browser profile — the session is empty',
      { details: { profile_dir: profileDir } },
    );
  }

  const dir = path.dirname(cookieFile);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700).catch(() => {});
  await writeFile(cookieFile, toNetscape(cookies), { mode: 0o600 });
  await chmod(cookieFile, 0o600);
  return cookieFile;
}
