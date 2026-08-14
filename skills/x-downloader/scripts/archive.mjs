/**
 * archive.mjs — what has already landed.
 *
 * There is no archive *file*. The folder is the record: a post is on disk when
 * `posts/<name> [<id>]/` exists, and it is complete when that folder holds as
 * many media files as the post has. Nothing else is consulted, and nothing else
 * is written down.
 *
 * That is a deliberate choice and the reason is worth keeping. gallery-dl's own
 * `--download-archive` is an SQLite database, so using it would mean either a
 * SQLite dependency in every counting path, or a second bookkeeping file we
 * maintain ourselves beside it. A second record is the failure mode to avoid:
 * a run that dies between writing one and the other leaves them disagreeing,
 * and the disagreement is silent and permanent. A record derived from the files
 * themselves cannot disagree with the files.
 *
 * `text.txt` is ours, not media, and never counts toward completeness — a post
 * whose images failed but whose text was written must still read as incomplete.
 */
import { readdir } from 'node:fs/promises';
import path from 'node:path';

import { tweetIdFromFolder } from './naming.mjs';

export const POSTS_DIR = 'posts';
export const TEXT_FILE = 'text.txt';

/** Media files among a folder's entries: everything that is not ours and not noise. */
export function countMedia(names) {
  return names.filter(
    (n) => n !== TEXT_FILE && !n.startsWith('.') && !n.endsWith('.part'),
  ).length;
}

/**
 * Complete when every file the post carries is present.
 *
 * An unknown expected count (a plan written before we knew, or a post fetched
 * by URL alone) falls back to "at least one file" — the most that can honestly
 * be claimed without the count, and it errs toward re-fetching, which is cheap
 * because gallery-dl skips files that already exist.
 */
export function isPostComplete(mediaCount, expectedCount) {
  if (!Number.isInteger(expectedCount) || expectedCount <= 0) return mediaCount > 0;
  return mediaCount >= expectedCount;
}

/**
 * Whether a post still needs fetching, given what is on disk.
 *
 * The one definition of "missing", shared by the plan's diff and the fetch
 * loop's outstanding list. Two copies of this rule is how a block comes to
 * promise a number the download then disagrees with.
 */
export function isMissing(post, archive) {
  const have = archive.get(post.tweetId);
  return !have || !isPostComplete(have.mediaCount, post.count);
}

/**
 * Every post already in an account folder, by tweet id.
 *
 * A missing folder is not an error: an account nobody has downloaded yet has
 * nothing on disk, which is an ordinary answer and not a failure.
 */
export async function readArchive(accountDir) {
  const posts = new Map();
  const root = path.join(accountDir, POSTS_DIR);

  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return posts;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const id = tweetIdFromFolder(entry.name);
    if (!id) continue;

    let names = [];
    try {
      names = await readdir(path.join(root, entry.name));
    } catch {
      // Unreadable is indistinguishable from empty here, and both mean refetch.
    }
    posts.set(id, { folder: entry.name, mediaCount: countMedia(names) });
  }
  return posts;
}
