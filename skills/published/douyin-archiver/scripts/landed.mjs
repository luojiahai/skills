/**
 * landed.mjs — what is already downloaded, answered by the files themselves.
 *
 * There is no archive file. A post is downloaded when its folder exists, holds
 * a readable `post.json`, and holds every file that `post.json` lists. Deleting
 * any of the media re-downloads the post, and that is the whole rule.
 *
 * Do not add yt-dlp's `--download-archive` beside this, or any other list of
 * what has landed. Such a file keys on ids rather than paths, so it goes on
 * claiming a post is done after its files are deleted, and a user who removes a
 * bad download gets silence instead of a re-fetch. Two records of the same thing
 * are free to disagree, and the one that cannot is the media on disk.
 *
 * `post.json` does not weaken that, because it is written *before* the media
 * rather than after — a description of the post, not a claim about it. What it
 * adds is the list to look for. Before it, this skill could only ever ask "does
 * the folder hold at least one file", since yt-dlp reports no expected count
 * for Douyin; now a post whose download failed after writing its description
 * reads as incomplete instead of as done.
 *
 * The layout is shared with x-archiver, which holds the same rules in its own
 * landed.mjs and post.mjs. They are duplicated on purpose — a skill is a
 * self-contained folder under skills/, so there is nowhere a shared module could
 * live that is still a skill. Change a rule here and change it there:
 *
 *   posts/<YYYY-MM-DD|undated>_<id>/   one folder per post
 *     post.json                        what the post is, written first
 *     1.mp4                            its media, numbered by position
 */
import { readdir } from 'node:fs/promises';
import path from 'node:path';

import { isComplete, readPost } from './post.mjs';

export const POSTS_DIR = 'posts';

/**
 * `undated` is a literal, not a wildcard: it has to be recognised on the way
 * back out, or a post fetched without a date would be re-downloaded forever.
 *
 * Nothing here *builds* a folder name — yt-dlp's output template in
 * download-douyin.sh does, and this regex has to keep agreeing with it.
 * landed.test.mjs reads that template and checks the two still match.
 */
const POST_FOLDER = /^(?:\d{4}-\d{2}-\d{2}|undated)_(\d+)$/;

/** The id back out of a folder name, or null if this is not a post folder. */
export function postIdFromFolder(name) {
  const m = POST_FOLDER.exec(String(name ?? ''));
  return m ? m[1] : null;
}

/** Whether one archived post holds everything it says it does. */
export function isLanded(entry) {
  return isComplete(entry?.post, entry?.names);
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

    const dir = path.join(postsDir, entry.name);
    let names = [];
    try {
      names = await readdir(dir);
    } catch {
      // Unreadable is indistinguishable from empty here, and both mean refetch.
    }
    archive.set(id, { folder: entry.name, names, post: await readPost(dir) });
  }
  return archive;
}

/**
 * The ids that count as downloaded. A post whose media failed leaves a folder
 * holding only its post.json, and that has to read as still-missing or a run cut
 * short would report itself complete.
 */
export async function onDiskIds(accountDir) {
  const ids = new Set();
  for (const [id, entry] of await readArchive(accountDir)) {
    if (isLanded(entry)) ids.add(id);
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
