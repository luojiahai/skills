/**
 * archive.mjs — what is already downloaded, answered by the files themselves.
 *
 * There is no archive file. A post is downloaded when its folder exists and
 * holds media; deleting the folder re-downloads it, and that is the whole rule.
 * yt-dlp's `--download-archive` used to own this and was removed deliberately:
 * it keyed on ids rather than paths, so it went on claiming a post was done
 * after its files had been deleted, and a user who removed a bad download got
 * silence instead of a re-fetch. Two records of the same thing are free to
 * disagree, and the one that cannot is the media on disk.
 *
 * The layout is shared with x-downloader, which holds the same rules in its own
 * archive.mjs and naming.mjs. They are duplicated on purpose — a skill is a
 * self-contained folder under skills/, so there is nowhere a shared module
 * could live that is still a skill. Change a rule here and change it there:
 *
 *   posts/<YYYY-MM-DD|undated>_<id>/   one folder per post
 *     1.mp4, 2.jpg, …                  its media, numbered by position
 *     text.txt                         permalink, timestamp, blank line, caption
 */
import { readdir } from 'node:fs/promises';
import path from 'node:path';

export const POSTS_DIR = 'posts';
export const TEXT_FILE = 'text.txt';

/**
 * `undated` is a literal, not a wildcard: it has to be recognised on the way
 * back out, or a post fetched without a date would be re-downloaded forever.
 *
 * Unlike x-downloader, nothing here *builds* a folder name — yt-dlp's output
 * template in download-douyin.sh does, and this regex has to keep agreeing with
 * it. archive.test.mjs reads that template and checks the two still match.
 */
const POST_FOLDER = /^(?:\d{4}-\d{2}-\d{2}|undated)_(\d+)$/;

/** The id back out of a folder name, or null if this is not a post folder. */
export function postIdFromFolder(name) {
  const m = POST_FOLDER.exec(String(name ?? ''));
  return m ? m[1] : null;
}

/**
 * Media files among a folder's entries.
 *
 * Finished media is named by position — `1.mp4`, `2.jpg` — so exactly one dot,
 * and matching that shape is what makes the count trustworthy. Everything
 * yt-dlp leaves behind mid-flight carries an extra one: `1.mp4.part` for a
 * transfer that stopped, `1.mp4.ytdl` for its resume state, and `1.f137.mp4` /
 * `1.f140.m4a` for separate video and audio streams that were fetched but never
 * merged. That last case is the one an exclusion list misses: the streams are
 * whole files, so a folder holding them looks finished while the post is not
 * playable, and counting them would retire a post that never actually landed.
 *
 * `text.txt` and dotfiles fail the same test, since neither starts with digits.
 */
const MEDIA_FILE = /^\d+\.[^.]+$/;

export function countMedia(names) {
  return names.filter((n) => MEDIA_FILE.test(n)).length;
}

/**
 * How many files a post should hold is unknowable here — the collector yields
 * ids and nothing else, so unlike x-downloader there is no expected count to
 * check against. One media file is the most that can be verified, and it is
 * enough to tell a fetched post from the text-only folder left behind when a
 * download failed.
 */
export function isPostComplete(mediaCount) {
  return mediaCount > 0;
}

/** Every post folder under an account, by id. */
export async function readArchive(accountDir) {
  const postsDir = path.join(accountDir, POSTS_DIR);
  let entries;
  try {
    entries = await readdir(postsDir, { withFileTypes: true });
  } catch {
    return new Map();
  }

  const archive = new Map();
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const id = postIdFromFolder(entry.name);
    if (!id) continue;
    const names = await readdir(path.join(postsDir, entry.name));
    archive.set(id, { folder: entry.name, mediaCount: countMedia(names) });
  }
  return archive;
}

/**
 * The ids that count as downloaded. A post whose media failed leaves a folder
 * holding only its text.txt, and that has to read as still-missing or a run cut
 * short would report itself complete.
 */
export async function onDiskIds(accountDir) {
  const ids = new Set();
  for (const [id, have] of await readArchive(accountDir)) {
    if (isPostComplete(have.mediaCount)) ids.add(id);
  }
  return ids;
}

/**
 * On disk but no longer listed on the profile. Only what was observed is
 * claimed: an id here reads the same whether the post was deleted, hidden,
 * region-locked or missed by a collection that stopped short, and none of those
 * can be told apart without fetching each one.
 *
 * Both arguments are id sets. Turning URLs into ids is plan.mjs' job and stays
 * there, so the shape of a Douyin URL is written down in exactly one place.
 */
export function unlistedIds(listed, onDisk) {
  return [...onDisk].filter((id) => !listed.has(id));
}
