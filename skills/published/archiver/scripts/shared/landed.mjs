/**
 * landed.mjs — what has already landed.
 *
 * There is no archive *file*. The folder is the record: a post is on disk when
 * `posts/<date>_<id>/` exists, holds a readable `post.json`, and holds every
 * file that `post.json` lists. Nothing else is consulted, and nothing else is
 * written down.
 *
 * That is a deliberate choice and the reason is worth keeping. gallery-dl's own
 * `--download-archive` is an SQLite database, so using it would mean either a
 * SQLite dependency in every counting path, or a second bookkeeping file we
 * maintain ourselves beside it. A second record is the failure mode to avoid: a
 * run that dies between writing one and the other leaves them disagreeing, and
 * the disagreement is silent and permanent. A record derived from the files
 * themselves cannot disagree with the files.
 *
 * `post.json` does not weaken that. It is written *before* the media rather than
 * after, so it is a description of the post rather than a claim about it — the
 * question "did this land" is still answered by looking for the files. What it
 * adds is the list to look for, which is why a post whose fourth image failed
 * now reads as incomplete instead of as done.
 *
 * Both platforms write into one archives root, so this rule has one home and
 * both import it from here. A per-platform copy is the thing to refuse: two
 * definitions of "landed" drift, and the drift shows up as a block promising a
 * number the download then disagrees with.
 */
import { readdir } from 'node:fs/promises';
import path from 'node:path';

import { postIdFromFolder } from './naming.mjs';

/**
 * Re-exported because what counts as a post folder is part of what "already
 * downloaded" means, and callers asking that question should not have to know
 * naming.mjs builds the name too.
 */
export { postIdFromFolder };
import { isComplete, readPost } from './post.mjs';

export const POSTS_DIR = 'posts';

/** Whether one archived post holds everything it says it does. */
export function isLanded(entry) {
  return isComplete(entry?.post, entry?.names);
}

/**
 * Whether a post still needs fetching, given what is on disk.
 *
 * X's rule, used by its plan diff, its collection pass's stopping rule and its
 * fetch loop's outstanding list — one definition across all three, because three
 * copies is how a block comes to promise a number the download then disagrees
 * with. It keys on `tweetId`, which only X's posts carry; Douyin asks the same
 * question of `isLanded` directly.
 */
export function isMissing(post, archive) {
  return !isLanded(archive.get(post.tweetId));
}

/**
 * Every post already in an account folder, by post id.
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
    const id = postIdFromFolder(entry.name);
    if (!id) continue;

    const dir = path.join(root, entry.name);
    let names = [];
    try {
      names = await readdir(dir);
    } catch {
      // Unreadable is indistinguishable from empty here, and both mean refetch.
    }
    posts.set(id, { folder: entry.name, names, post: await readPost(dir) });
  }
  return posts;
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
 * On disk but no longer listed by the account. Only what was observed is
 * claimed: an id here reads the same whether the post was deleted, hidden,
 * region-locked or missed by a listing that stopped short, and none of those can
 * be told apart without fetching each one.
 *
 * Both arguments are id sets. Turning a platform's posts into ids belongs to the
 * platform, and stays there.
 */
export function unlistedIds(listed, onDisk) {
  return [...onDisk].filter((id) => !listed.has(id));
}
