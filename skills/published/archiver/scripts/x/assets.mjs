/**
 * assets.mjs — the account's avatar and header, as they are now.
 *
 *   <account>/assets/avatar.<ext>
 *   <account>/assets/banner.<ext>
 *
 * The current look, not a history of it: each run overwrites what is there. An
 * archive of every avatar an account has ever had is a posts-like concern and
 * would want dated names, a completeness rule and a place in the plan — none of
 * which a filename convention can carry.
 *
 * Fetched directly rather than through gallery-dl. The URLs arrive on rows the
 * listing pass has already collected, and they point at a public CDN, so an
 * extra gallery-dl invocation would buy nothing and would spend two more
 * requests against the API that is actually rate-limited. Fetching them
 * ourselves is also why the scheme, the host and the size are all checked here:
 * a URL off a subprocess's stdout is a request this skill makes on the user's
 * behalf, not a fact.
 *
 * Douyin has both concepts too, but nothing over there reads them out of the
 * profile page yet — so `assets/` is optional in the shared layout and a Douyin
 * account folder simply has none.
 */
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const ASSETS_DIR = 'assets';

/** How long to wait for an image nobody is blocked on. */
const TIMEOUT_MS = 20_000;

/**
 * An avatar is a few tens of kilobytes and a banner a few hundred. The cap is
 * far above either and exists because the body is buffered whole: a URL that
 * answers with an endless stream would otherwise be an out-of-memory crash in
 * the middle of a run that has already fetched an account's history.
 */
const MAX_BYTES = 16 * 1024 * 1024;

/**
 * Where an asset may be fetched from.
 *
 * The URLs arrive on gallery-dl's stdout, which is a subprocess's output and not
 * a promise about where it points. Unchecked, a spoofed or compromised row aims
 * this skill's own `fetch` at whatever it likes — a link-local metadata address,
 * a host on the user's network — from the user's machine, and writes the answer
 * into the archive as an avatar.
 */
function isAssetUrl(url) {
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch {
    return false;
  }
  return parsed.protocol === 'https:' && /(^|\.)twimg\.com$/i.test(parsed.hostname);
}

/**
 * The file type, read from the bytes rather than from the URL.
 *
 * X's banner URLs carry no extension at all — `…/profile_banners/55/1699` — so
 * there is nothing in the path to take one from, and hardcoding `.jpg` would be
 * wrong the first time someone uploads a PNG. Four signatures cover everything
 * X serves; anything else is stored as `.bin`, which keeps the bytes without
 * claiming they are an image format they are not.
 */
export function sniffExtension(bytes) {
  const b = bytes ?? [];
  const at = (i) => (b[i] ?? -1);
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'jpg';
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return 'png';
  if (at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x38) return 'gif';
  if (
    at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 &&
    at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50
  ) {
    return 'webp';
  }
  return 'bin';
}

/**
 * Deletes the same asset stored under a different extension.
 *
 * An avatar that was a PNG and is now a JPEG would otherwise leave both on
 * disk, and nothing would say which one the account currently uses.
 */
async function removeOtherExtensions(dir, name, keep) {
  let entries = [];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  await Promise.all(
    entries
      .filter((entry) => entry !== keep && entry.startsWith(`${name}.`) && !entry.slice(name.length + 1).includes('.'))
      .map((entry) => rm(path.join(dir, entry), { force: true })),
  );
}

/**
 * Fetches one asset, or returns null.
 *
 * Never throws. An avatar is decoration beside the posts, and a CDN hiccup must
 * not end a run that is otherwise fetching an account's entire history.
 */
export async function saveAsset(accountDir, name, url, { fetchImpl = fetch } = {}) {
  if (!url || !isAssetUrl(url)) return null;

  let bytes;
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response?.ok) return null;

    // Refused on the declared length where there is one, and on the bytes
    // themselves where there is not, because a header is only what the server
    // chose to say.
    const declared = Number(response.headers?.get?.('content-length'));
    if (Number.isFinite(declared) && declared > MAX_BYTES) return null;

    bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > MAX_BYTES) return null;
  } catch {
    return null;
  }

  if (!bytes.length) return null;

  const dir = path.join(accountDir, ASSETS_DIR);
  const file = `${name}.${sniffExtension(bytes)}`;
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, file), bytes);
  } catch {
    return null;
  }

  await removeOtherExtensions(dir, name, file);
  return file;
}

/** Both of them, as far as the account has them. */
export async function saveProfileAssets(accountDir, { avatar, banner } = {}, options = {}) {
  return {
    avatar: await saveAsset(accountDir, 'avatar', avatar, options),
    banner: await saveAsset(accountDir, 'banner', banner, options),
  };
}
