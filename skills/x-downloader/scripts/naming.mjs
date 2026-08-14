/**
 * naming.mjs — post text in, a directory name out.
 *
 * This is the one module fed hostile input by design. A post's body is
 * arbitrary user text — newlines, emoji, slashes, right-to-left marks, four
 * thousand characters of it — and here it becomes a *directory name*, which is
 * a sharper edge than a filename: a stray separator does not produce a badly
 * named file, it produces a tree in the wrong place.
 *
 * So everything here is pure and total. Given any string it returns a name, or
 * it returns the empty string and the caller falls back to the id alone. It
 * never throws, and it never returns something that means a different path than
 * it looks like.
 */

/** Illegal or hostile in a path component on some filesystem we care about. */
const FORBIDDEN = /[/\\:*?"<>|]/g;

/**
 * C0 and C1 controls, plus the bidi marks and overrides that let a name render
 * as something other than what it is.
 *
 * Written as escapes on purpose. The literal characters make this file a binary
 * blob to git -- it embeds a raw NUL -- and the one module that turns hostile
 * input into directory names is the last one that should be undiffable.
 */
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

/**
 * A single line of at most `max` characters, safe as one path component.
 *
 * Truncation counts *graphemes*, not UTF-16 units: slicing a string mid-pair
 * yields a lone surrogate, which is not valid UTF-8 and which some filesystems
 * reject and others silently mangle. An emoji is one visible character and is
 * kept or dropped whole.
 */
export function slugify(text, max = 60) {
  if (typeof text !== 'string') return '';

  let s = text
    .replace(CONTROL, ' ')
    .replace(FORBIDDEN, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!s) return '';
  s = truncateGraphemes(s, max).trim();

  // A component that is only dots is `.` or `..`; a trailing dot or space is
  // legal to create on Windows and then impossible to open. Strip both ends.
  s = s.replace(/^[.\s]+/, '').replace(/[.\s]+$/, '');
  return s;
}

function truncateGraphemes(s, max) {
  if (max <= 0) return '';
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    let out = '';
    let n = 0;
    for (const { segment } of seg.segment(s)) {
      if (++n > max) break;
      out += segment;
    }
    return out;
  }
  // Code points are the floor we can always guarantee: never a split surrogate.
  return Array.from(s).slice(0, max).join('');
}

/** `2024-03-11` from gallery-dl's `2024-03-11 07:22:19`, or `undated`. */
export function datePart(date) {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(date ?? ''));
  return m ? m[1] : 'undated';
}

/**
 * The folder one post lives in: `2024-03-11 - some of the text [1767...]`.
 *
 * Date first so the folder listing sorts chronologically — that is the whole
 * reason the date is in the name. The id last and always, because it is what
 * makes the name unique and what identifies the post again later; the text in
 * the middle is for humans and is allowed to be absent.
 */
export function postFolderName({ date, content, tweetId, max = 60 }) {
  const slug = slugify(content, max);
  const day = datePart(date);
  return slug ? `${day} - ${slug} [${tweetId}]` : `${day} [${tweetId}]`;
}

/** The `[1767...]` id back out of a folder name, or null if it carries none. */
export function tweetIdFromFolder(name) {
  const m = /\[(\d+)\]$/.exec(String(name ?? '').trim());
  return m ? m[1] : null;
}

/**
 * `text.txt` — the post's body, with enough header to mean something.
 *
 * Written for every post, including one with no text at all. A missing file
 * would be ambiguous between "this post had no words" and "the run died before
 * writing it", and the second of those is the one you need to be able to see.
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
