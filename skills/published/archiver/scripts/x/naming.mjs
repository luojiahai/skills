/**
 * naming.mjs — a post's identity as a directory name.
 *
 * A post folder is `<date>_<id>` and nothing else. Both halves are machine
 * fields: a date gallery-dl formatted and a numeric status id. No part of a
 * post's body reaches a path, which is the point. User text in a *directory*
 * name is a sharper edge than in a filename, because a stray separator does not
 * produce a badly named file, it produces a tree in the wrong place. Keeping the
 * body out of the path retires that entire class of bug rather than defending
 * against it, and costs nothing: `post.json` inside the folder holds the full,
 * untruncated text.
 *
 * The date is in the name even though `post.json` also carries the timestamp.
 * That is the one duplication in this archive that pays for itself: it makes a
 * directory listing a timeline, it is derived rather than recorded, and nothing
 * reads it back except the regex below that recognises a folder as ours.
 *
 * Everything here is pure and total. It never throws, and it never returns
 * something that means a different path than it looks like.
 */

/** A folder name we could have written ourselves, and the id inside it. */
const POST_FOLDER = /^(?:\d{4}-\d{2}-\d{2}|undated)_(\d+)$/;

/** `2024-03-11` from gallery-dl's `2024-03-11 07:22:19`, or `undated`. */
export function datePart(date) {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(date ?? ''));
  return m ? m[1] : 'undated';
}

/**
 * The folder one post lives in: `2024-03-11_1767...`.
 *
 * Date first so the folder listing sorts chronologically — that is the whole
 * reason the date is in the name. The id second and always, because it is what
 * makes the name unique and what identifies the post again later.
 */
export function postFolderName({ date, tweetId }) {
  return `${datePart(date)}_${tweetId}`;
}

/**
 * The id back out of a folder name, or null for a folder that is not ours.
 *
 * Anchored to the *whole* name, not to a suffix. A loose `_(\d+)$` match would
 * read an unrelated `drafts_2` as post 2, and the skill would then count that
 * post as downloaded and skip it forever — a silent, permanent hole in the
 * archive. Only a name we could have written ourselves counts as one, which is
 * also why nothing is trimmed first: `2024-03-11_1767 ` is not a folder we
 * wrote, and treating it as one would split a post across two directories.
 */
export function tweetIdFromFolder(name) {
  const m = POST_FOLDER.exec(String(name ?? ''));
  return m ? m[1] : null;
}

/** The canonical permalink for a post, which is also how `--go` re-fetches it. */
export function permalink(handle, tweetId) {
  return `https://x.com/${handle || 'i/web'}/status/${tweetId}`;
}
