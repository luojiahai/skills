/**
 * post.mjs — one post, as a file.
 *
 *   posts/<date>_<id>/post.json    what the post is
 *   posts/<date>_<id>/1.mp4        what it carries
 *
 * `post.json` is written *before* the media, not after. It is the post's
 * description, not a receipt — and that distinction is what keeps the archive's
 * oldest rule intact: a post is complete when every file it lists is on disk,
 * which is a question the files themselves answer. A marker written last would
 * have been a second record, free to go on claiming a post had landed after its
 * media was deleted by hand, which is exactly the failure that got yt-dlp's
 * `--download-archive` removed from this skill in the first place.
 *
 * Here it also closes a gap x-archiver never had. gallery-dl reports how many
 * files a tweet carries; yt-dlp reports nothing of the kind for Douyin, so
 * "downloaded" could only ever mean "the folder holds at least one file". Now
 * the post says what it carries before the download starts, and a post whose
 * media failed reads as incomplete rather than as done.
 *
 * Unlike x-archiver, nothing here *builds* the file during a run: yt-dlp writes
 * it directly through the JSON template in download-douyin.sh, which fires after
 * extraction and before the download. This module owns the shape that template
 * has to produce, reads it back, and answers whether a post has landed —
 * landed.test.mjs is what holds the two in step.
 */
import path from 'node:path';

import { readJson, writeJson } from './cli.mjs';

export const POST_FILE = 'post.json';
export const POST_VERSION = 1;

/**
 * The post, in a fixed order and holding nothing else.
 *
 * Used by the tests and by anything that has to write a post.json from Node;
 * the live path is yt-dlp's template. `text` goes in whole and is never
 * truncated — this is the only place a caption is kept, since the folder name
 * carries none of it and `text.txt` is gone.
 */
export function buildPost({ id, permalink, timestamp, text, replyTo, media } = {}) {
  return {
    version: POST_VERSION,
    id: String(id ?? ''),
    permalink: permalink || null,
    timestamp: timestamp || null,
    text: typeof text === 'string' ? text : '',
    // Douyin has no reply-to-a-post concept in what yt-dlp exposes. The key is
    // written anyway, always null, so both platforms' post.json have one shape.
    reply_to: replyTo || null,
    media: (media ?? []).map(({ file, url, type, id: mediaId } = {}) => {
      const entry = { file: String(file ?? '') };
      if (url) entry.url = String(url);
      if (type) entry.type = String(type);
      if (mediaId) entry.id = String(mediaId);
      return entry;
    }),
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
 * even started this post.
 *
 * Everything yt-dlp leaves behind mid-flight fails this by construction, which
 * is why no positional-name regex is needed. `1.mp4.part` is not
 * `1.mp4`; neither is `1.mp4.ytdl`; and the unmerged `1.f137.mp4` /
 * `1.f140.m4a` streams — whole files, which an exclusion list would have had to
 * know about by name — are not `1.mp4` either.
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
