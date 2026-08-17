/**
 * post.mjs — one post, as a file.
 *
 *   posts/<date>_<id>/post.json    what the post is
 *   posts/<date>_<id>/1.jpg …      what it carries
 *
 * `post.json` is written *before* the media, not after. It is the post's
 * description, not a receipt — and that distinction is what keeps the archive's
 * oldest rule intact: a post is complete when every file it lists is on disk,
 * which is a question the files themselves answer. A marker written last would
 * have been a second record, free to go on claiming a post had landed after its
 * media was deleted by hand, which is exactly the failure that got yt-dlp's
 * `--download-archive` removed from the sibling skill.
 *
 * Writing it first buys two more things. A post whose media fails leaves a
 * folder that still says what it was, rather than anonymous rubble; and the
 * media list gives the completeness check an expected set of filenames instead
 * of a count, so "three of four images landed" is visible without anyone having
 * had to record the four.
 *
 * The shape is curated rather than dumped. The extractor's own output is
 * enormous and changes between versions, and two skills whose post.json held
 * two different blobs would be structurally incomparable — which is the whole
 * thing the shared layout exists to prevent.
 */
import path from 'node:path';

import { readJson, writeJson } from './cli.mjs';
import { toTimestamp } from './naming.mjs';

export { toTimestamp };

export const POST_FILE = 'post.json';
export const POST_VERSION = 1;

/**
 * One media file, named as it is on disk and as far as it can be identified.
 *
 * `file` mirrors gallery-dl's `--filename {num}.{extension}` exactly, character
 * for character — this list is compared against a directory listing, so a name
 * built by a different rule than the one that wrote the file would report every
 * post as incomplete forever.
 *
 * `url` and `id` are optional and often absent. For an image, `id` is the
 * pbs.twimg.com media token: globally unique and stable for the life of the
 * upload. For a video there is no such thing exposed — the nearest candidate is
 * the basename of whichever variant had the highest bitrate, which changes if X
 * re-encodes — so it is left out rather than recorded as if it were stable.
 * Migrated posts have neither, because neither was ever on disk to recover.
 */
export function mediaEntry({ file, num, ext, url, type, id } = {}) {
  // Either the name outright — yt-dlp prints the one it is about to write —
  // or the parts gallery-dl reports, assembled the same way `--filename
  // {num}.{extension}` assembles it. This list is compared against a directory
  // listing, so a name built by a different rule than the one that wrote the
  // file would report every post as incomplete forever.
  const entry = { file: file === undefined || file === null ? `${num}.${ext ?? ''}` : String(file) };
  if (url) entry.url = String(url);
  if (type) entry.type = String(type);
  if (id) entry.id = String(id);
  return entry;
}

/**
 * The post, in a fixed order and holding nothing else.
 *
 * `text` goes in whole and is never truncated — this is now the only place a
 * post's words are kept, since the folder name carries none of them and
 * `text.txt` is gone.
 */
export function buildPost({ id, permalink, timestamp, text, replyTo, media } = {}) {
  return {
    version: POST_VERSION,
    id: String(id ?? ''),
    permalink: permalink || null,
    timestamp: timestamp || null,
    text: typeof text === 'string' ? text : '',
    reply_to: replyTo || null,
    media: (media ?? []).map((entry) => mediaEntry(entry)),
  };
}

/** The filenames a post says it carries. */
export function mediaNames(post) {
  return Array.isArray(post?.media) ? post.media.map((entry) => entry?.file).filter(Boolean) : [];
}

/**
 * Whether every file this post lists is present in the folder.
 *
 * A folder with no readable post.json is never complete: post.json is written
 * before the first byte of media, so its absence means the run died before it
 * even started this post, and the post has to be fetched again.
 *
 * A `.part` file fails this by construction — `1.jpg.part` is not `1.jpg` — so a
 * transfer that stopped halfway reads as incomplete without needing a rule of
 * its own.
 *
 * An empty media list is complete. It cannot arise from a listing pass, which
 * only ever yields posts that carry files, and treating it as incomplete would
 * put such a post into an unending retry loop.
 */
export function isComplete(post, names) {
  if (!post || post.version !== POST_VERSION) return false;
  if (!Array.isArray(post.media)) return false;
  const present = new Set(names ?? []);
  return mediaNames(post).every((file) => present.has(file));
}

export async function readPost(dir) {
  return readJson(path.join(dir, POST_FILE));
}

export async function writePost(dir, post) {
  await writeJson(path.join(dir, POST_FILE), post);
  return post;
}
