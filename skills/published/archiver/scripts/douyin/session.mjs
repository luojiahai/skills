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
import { writeFile, mkdir } from 'node:fs/promises';
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
 * that path. Mode 0600, because this file is a live session.
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

  await mkdir(path.dirname(cookieFile), { recursive: true });
  await writeFile(cookieFile, toNetscape(cookies), { mode: 0o600 });
  return cookieFile;
}
