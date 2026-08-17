/**
 * naming.mjs — a post's identity as a directory name.
 *
 * A post folder is `<date>_<id>` and nothing else. Both halves are machine
 * fields: a date derived from the post's own timestamp and a numeric post id. No
 * part of a caption reaches a path, which is the point. User text in a
 * *directory* name is a sharper edge than in a filename, because a stray
 * separator does not produce a badly named file, it produces a tree in the wrong
 * place. Keeping the caption out of the path retires that entire class of bug
 * rather than defending against it, and costs nothing: `post.json` inside the
 * folder holds the full, untruncated text.
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

/**
 * A Date from a unix second count, an ISO string, or a Date — null for anything
 * that is not a moment.
 *
 * Douyin's feed reports `create_time` in seconds; everything else that reaches
 * here is already a string.
 */
function toDate(value) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return null;
    return new Date(value * 1000);
  }
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

/**
 * `2024-03-11`, in UTC, or the literal `undated`.
 *
 * UTC rather than local time so that one archive read on two machines names the
 * same folders. `undated` is a literal rather than today's date: dating a post
 * by when it happened to be archived would be a fact the archive invented, and
 * it has to be recognisable on the way back out or such a post is re-downloaded
 * forever.
 */
export function datePart(value) {
  const date = toDate(value);
  return date ? date.toISOString().slice(0, 10) : 'undated';
}

/** The moment, where the folder keeps only the day. Same fact, two precisions. */
export function toTimestamp(value) {
  const date = toDate(value);
  return date ? date.toISOString().replace(/\.\d{3}Z$/, 'Z') : null;
}

/**
 * The folder one post lives in: `2024-03-11_7412...`.
 *
 * Date first so the folder listing sorts chronologically — that is the whole
 * reason the date is in the name. The id second and always, because it is what
 * makes the name unique and what identifies the post again later.
 */
export function postFolderName({ date, postId }) {
  return `${datePart(date)}_${postId}`;
}

/**
 * The id back out of a folder name, or null for a folder that is not ours.
 *
 * Anchored to the *whole* name, not to a suffix. A loose `_(\d+)$` match would
 * read an unrelated `drafts_2` as post 2, and the skill would then count that
 * post as downloaded and skip it forever — a silent, permanent hole in the
 * archive. Only a name we could have written ourselves counts as one, which is
 * also why nothing is trimmed first: `2024-03-11_7412 ` is not a folder we
 * wrote, and treating it as one would split a post across two directories.
 */
export function postIdFromFolder(name) {
  const m = POST_FOLDER.exec(String(name ?? ''));
  return m ? m[1] : null;
}

/** The canonical permalink for a post, which is also how `--go` re-fetches it. */
export function permalink(postId) {
  return `https://www.douyin.com/video/${postId}`;
}
