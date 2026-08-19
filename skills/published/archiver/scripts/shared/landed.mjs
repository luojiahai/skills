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
 * adds is the list to look for, which is what makes a post whose fourth image
 * failed read as incomplete rather than as done.
 *
 * Both platforms write into one archives root, so this rule has one home and
 * both import it from here. A per-platform copy is the thing to refuse: two
 * definitions of "landed" drift, and the drift shows up as a block promising a
 * number the download then disagrees with.
 */
import { readdir } from 'node:fs/promises';
import path from 'node:path';

import { postFolderName, postIdFromFolder } from './naming.mjs';
import { isComplete, readPost } from './post.mjs';

/**
 * Re-exported because what counts as a post folder is part of what "already
 * downloaded" means, and callers asking that question should not have to know
 * naming.mjs builds the name too.
 */
export { postIdFromFolder };

export const POSTS_DIR = 'posts';

/** Whether one archived post holds everything it says it does. */
export function isLanded(entry) {
  return isComplete(entry?.post, entry?.names);
}

/**
 * Whether a post still needs fetching, given what is on disk.
 *
 * One definition, used by a plan diff, a collection pass's stopping rule and a
 * fetch loop's outstanding list — because three copies is how a block comes to
 * promise a number the download then disagrees with.
 *
 * `postIdKey` is what a collected post calls its own id, and comes from the
 * platform registry rather than being written in here: `platforms.mjs` names it
 * precisely so this has one parameterised answer instead of one platform's
 * spelling and a comment explaining why the other cannot use it.
 */
export function isMissing(post, archive, postIdKey) {
  return !isLanded(archive.get(post[postIdKey]));
}

/**
 * The posts in a list that are not yet fully on disk, in the order they were
 * collected.
 *
 * Derived, never stored. A remembered "still to do" list would be a second
 * account of what has downloaded sitting beside the files, free to disagree with
 * them after a run that died at the wrong moment.
 */
export function outstanding(posts, archive, postIdKey) {
  return posts.filter((post) => isMissing(post, archive, postIdKey));
}

/**
 * Where one post's folder is. The date and the id are the platform's to name —
 * they are spelled differently on each — and everything below them is this
 * module's and naming.mjs's.
 */
export function postDirFor(accountDir, { date, postId }) {
  return path.join(accountDir, POSTS_DIR, postFolderName({ date, postId }));
}

/**
 * Every post already in an account folder, by post id.
 *
 * A missing folder is not an error: an account nobody has downloaded yet has
 * nothing on disk, which is an ordinary answer and not a failure.
 *
 * One id can name two folders — `undated_5` from a run that could not date the
 * post and `2024-01-01_5` from a later one that could. The landed folder wins,
 * so which one answers for the post is decided by what is in it rather than by
 * whichever `readdir` happened to yield last. The map holds one entry per id
 * either way, which means the other folder's media is counted by nothing:
 * `duplicateFolders` below is how a run says so.
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
    const found = { folder: entry.name, names, post: await readPost(dir) };

    const held = posts.get(id);
    posts.set(id, held ? pickFolder(held, found) : found);
  }

  return posts;
}

/**
 * Which of two folders for one id answers for the post.
 *
 * The landed one, and where both or neither landed the folder that sorts first —
 * so two machines reading one archive give the same answer, whatever order their
 * filesystems yielded the folders in.
 */
function pickFolder(a, b) {
  if (isLanded(a) !== isLanded(b)) return isLanded(a) ? a : b;
  return a.folder <= b.folder ? a : b;
}

/**
 * How many post ids this account folder holds in more than one folder.
 *
 * Asked of the directory names alone, which is why it is its own pass rather
 * than something `readArchive` hands back: it needs no post.json, and a map
 * keyed by id cannot carry the answer without smuggling a second value onto it.
 */
export async function duplicateFolders(accountDir) {
  const seen = new Set();
  const twice = new Set();

  let entries;
  try {
    entries = await readdir(path.join(accountDir, POSTS_DIR), { withFileTypes: true });
  } catch {
    return 0;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const id = postIdFromFolder(entry.name);
    if (!id) continue;
    if (seen.has(id)) twice.add(id);
    seen.add(id);
  }
  return twice.size;
}

/**
 * The ids that count as downloaded. A post whose media failed leaves a folder
 * holding only its post.json, and that has to read as still-missing or a run cut
 * short would report itself complete.
 */
/** The ids an archive holds in full — what the folder can answer for. */
export function landedIds(archive) {
  const ids = new Set();
  for (const [id, entry] of archive) if (isLanded(entry)) ids.add(id);
  return ids;
}

/** How many of them there are, which is the archive's own size honestly counted. */
export function landedCount(archive) {
  return landedIds(archive).size;
}

export async function onDiskIds(accountDir) {
  return landedIds(await readArchive(accountDir));
}

/**
 * On disk but no longer listed by the account. Only what was observed is
 * claimed: an id here reads the same whether the post was deleted, hidden,
 * region-locked or missed by a listing that stopped short, and none of those can
 * be told apart without fetching each one.
 *
 * Both arguments are id sets. Turning a platform's posts into ids belongs to the
 * platform, and stays there.
 *
 * The one spelling of this rule. Anything that wants the count asks for
 * `unlistedIds(...).length` rather than filtering a set of its own — two
 * spellings of one subtraction is how two figures in one document come to
 * disagree.
 */
export function unlistedIds(listed, onDisk) {
  return [...onDisk].filter((id) => !listed.has(id));
}
