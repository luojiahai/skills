/**
 * naming.mjs — a post's identity as a directory name, and a moment as a string.
 *
 * A post folder is `<date>_<id>` and nothing else. Both halves are machine
 * fields: a date derived from the post's own timestamp and a numeric post id. No
 * part of a post's body reaches a path, which is the point. User text in a
 * *directory* name is a sharper edge than in a filename, because a stray
 * separator does not produce a badly named file, it produces a tree in the wrong
 * place. Keeping the body out of the path retires that entire class of bug
 * rather than defending against it, and costs nothing: `post.json` inside the
 * folder holds the full, untruncated text.
 *
 * The date is in the name even though `post.json` also carries the timestamp.
 * That is the one duplication in this archive that pays for itself: it makes a
 * directory listing a timeline, it is derived rather than recorded, and nothing
 * reads it back except the regex below that recognises a folder as ours.
 *
 * Every platform's moments arrive here and leave in one shape, because one
 * archives root holds them all and a listing that sorted two ways would not be a
 * timeline.
 *
 * Reading a moment is pure and total: every value has an answer, `null` included,
 * and none of it throws. Writing a folder name is the one thing here that can
 * refuse, because it is the one thing whose output is a path — an id it will not
 * vouch for is a refusal rather than a name that means a different directory
 * than it looks like.
 */
import { Refusal } from './errors.mjs';

/** An id that may sit in a path, the same rule `isSafeId` holds account ids to. */
const SAFE_POST_ID = /^[A-Za-z0-9._-]+$/;

/**
 * A folder name we could have written ourselves, and the id inside it.
 *
 * The id half is `SAFE_POST_ID` again rather than a narrower charset, because
 * these two are one rule read from both ends: a name this file writes and
 * cannot read back is a post counted as missing forever and re-downloaded on
 * every run. Not every platform's id is numeric — Instagram identifies a post
 * by its base64ish shortcode — and the date prefix is fixed-width, so an id
 * containing `_` is still unambiguous.
 */
const POST_FOLDER = /^(?:\d{4}-\d{2}-\d{2}|undated)_([A-Za-z0-9._-]+)$/;

/** `2024-03-11 07:22:19` and `2024-03-11T07:22:19Z` — gallery-dl's form and ISO. */
const WALL_CLOCK = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/;
const DAY_ONLY = /^(\d{4}-\d{2}-\d{2})$/;

/**
 * The moment as `YYYY-MM-DDTHH:MM:SSZ`, or null.
 *
 * Both downloaders report UTC, so the `Z` is a fact rather than an assumption —
 * and the wall-clock forms are matched textually *because* of it. Handing
 * `2024-03-11 07:22:19` to `new Date` parses it as local time, which would shift
 * every folder name by the machine's offset and make one archive name different
 * folders on two machines.
 *
 * A value that is not a recognisable moment becomes null rather than a guess:
 * `undated` is a real answer, and half a timestamp would be worse than none.
 */
export function toTimestamp(value) {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? iso(value) : null;
  }

  // Unix seconds, from yt-dlp and from Douyin's feed.
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return null;
    return iso(new Date(value * 1000));
  }

  const raw = String(value ?? '').trim();
  const wall = WALL_CLOCK.exec(raw);
  if (wall) return `${wall[1]}T${wall[2]}Z`;
  const day = DAY_ONLY.exec(raw);
  return day ? `${day[1]}T00:00:00Z` : null;
}

/**
 * A Date as the archive spells it, or null for one outside the range a Date can
 * be. A downloader reporting microseconds where the field is documented as
 * seconds lands here, and an out-of-range moment is no more a moment than an
 * unparseable string is.
 */
function iso(date) {
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * `2024-03-11`, in UTC, or the literal `undated`.
 *
 * `undated` is a literal rather than today's date: dating a post by when it
 * happened to be archived would be a fact the archive invented, and it has to be
 * recognisable on the way back out or such a post is re-downloaded forever.
 */
export function datePart(value) {
  return toTimestamp(value)?.slice(0, 10) ?? 'undated';
}

/**
 * The folder one post lives in: `2024-03-11_1767...`.
 *
 * Date first so the folder listing sorts chronologically — that is the whole
 * reason the date is in the name. The id second and always, because it is what
 * makes the name unique and what identifies the post again later.
 *
 * The id is checked here rather than at each place it is joined. It arrives from
 * a subprocess's stdout, and a separator or a `..` in this position does not
 * produce a badly named folder — it produces a tree somewhere else entirely.
 */
export function postFolderName({ date, postId }) {
  const id = String(postId ?? '');
  if (!id || id.length > 128 || !SAFE_POST_ID.test(id) || id === '.' || id === '..') {
    throw new Refusal(
      'unsafe-post-id',
      `refusing to use ${JSON.stringify(id)} as a post folder name`,
      { details: { id } },
    );
  }
  return `${datePart(date)}_${id}`;
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
export function postIdFromFolder(name) {
  const m = POST_FOLDER.exec(String(name ?? ''));
  // `.` and `..` are excluded on the way in, so they are excluded on the way
  // back out: a name this file would refuse to write is not a name it wrote.
  if (!m || m[1] === '.' || m[1] === '..') return null;
  return m[1];
}
