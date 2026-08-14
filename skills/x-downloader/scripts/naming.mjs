/**
 * naming.mjs — a post's identity as a directory name, and its text as a file.
 *
 * A post folder is `<date>_<id>` and nothing else. Both halves are machine
 * fields: a date gallery-dl formatted and a numeric status id. No part of a
 * post's body reaches a path, which is the point — this module used to turn
 * arbitrary user text into a *directory* name, a sharper edge than a filename
 * because a stray separator does not produce a badly named file, it produces a
 * tree in the wrong place. Keeping the body out of the path retires that entire
 * class of bug rather than defending against it, and costs nothing: `text.txt`
 * inside the folder already holds the full, untruncated text.
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

/**
 * `text.txt` — the post's body, with enough header to mean something.
 *
 * Written for every post, including one with no text at all. A missing file
 * would be ambiguous between "this post had no words" and "the run died before
 * writing it", and the second of those is the one you need to be able to see.
 *
 * This is also the only place a post's words are kept, now that the folder name
 * carries none of them, so the body goes in whole — never truncated.
 */
export function postText({ permalink: url, date, content, replyUrl }) {
  const header = [`${url}`, `${date}`];
  if (replyUrl) header.push(`in reply to ${replyUrl}`);
  const body = typeof content === 'string' ? content : '';
  return `${header.join('\n')}\n\n${body}\n`;
}

/** The canonical permalink for a post, which is also how `--go` re-fetches it. */
export function permalink(handle, tweetId) {
  return `https://x.com/${handle || 'i/web'}/status/${tweetId}`;
}
