/**
 * target.mjs — what the user pointed at.
 *
 * One entry point: an account. Everything else on x.com — a single post, likes,
 * bookmarks, lists, search, communities — is refused by name rather than quietly
 * treated as an account, because a URL this skill was not built for would
 * otherwise archive something the user did not ask for.
 *
 * A post URL is the one that makes this worth a module. It carries the handle in
 * the same position a profile URL does, so anything that stopped reading after
 * the handle would answer "download this post" by archiving the whole account.
 */

const HOST = /^(?:https?:\/\/)?(?:www\.|mobile\.)?(?:twitter|x)\.com\//i;

/** Paths that are x.com's own, not anybody's handle. */
const RESERVED = new Set(['i', 'home', 'explore', 'notifications', 'messages', 'search', 'settings', 'hashtag']);

/**
 * `{ handle, url }`, or a throw naming what is wrong with the URL.
 *
 * Refusal is a throw rather than a returned verdict because there is one kind of
 * answer: a caller that reads past this has an account, and nothing to branch
 * on.
 *
 * The URL is rebuilt canonically rather than passed through: a profile URL
 * carrying `?f=live` or a tracking parameter is the same account, and letting
 * two spellings of one account through would make two archives of it.
 */
export function parseTarget(input) {
  const raw = String(input ?? '').trim();
  if (!HOST.test(raw)) {
    throw new Error('that is not an x.com or twitter.com URL');
  }

  const path = raw.replace(HOST, '').split(/[?#]/)[0].replace(/\/+$/, '');
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 0) {
    throw new Error('that URL names no account');
  }

  const [handle, section] = parts;

  if (RESERVED.has(handle.toLowerCase())) {
    throw new Error(`x.com/${handle} is not an account this skill can archive`);
  }

  if (section && section !== 'media' && section !== 'tweets') {
    throw new Error(`x.com/<handle>/${section} is out of scope — this skill archives an account's own media`);
  }

  return { handle, url: `https://x.com/${handle}` };
}
