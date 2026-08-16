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
 * The layout is shared with douyin-archiver, which holds the same rules in its
 * own landed.mjs and post.mjs. They are duplicated on purpose — a skill is a
 * self-contained folder under skills/, so there is nowhere a shared module could
 * live that is still a skill. Change a rule here and change it there.
 */
import { readdir } from 'node:fs/promises';
import path from 'node:path';

import { tweetIdFromFolder } from './naming.mjs';
import { isComplete, readPost } from './post.mjs';

export const POSTS_DIR = 'posts';

/** Whether one archived post holds everything it says it does. */
export function isLanded(entry) {
  return isComplete(entry?.post, entry?.names);
}

/**
 * Whether a post still needs fetching, given what is on disk.
 *
 * The one definition of "missing", shared by the plan's diff, the listing pass's
 * stopping rule and the fetch loop's outstanding list. Three copies of this rule
 * is how a block comes to promise a number the download then disagrees with.
 */
export function isMissing(post, archive) {
  return !isLanded(archive.get(post.tweetId));
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
