/**
 * target.mjs — what the user pointed at.
 *
 * Two entry points, told apart by the URL exactly as gallery-dl's extractors
 * tell them apart: an account, and one post. Everything else on x.com — likes,
 * bookmarks, lists, search, communities — is refused by name rather than
 * quietly treated as an account, because a URL this skill was not built for
 * would otherwise archive something the user did not ask for.
 */

const HOST = /^(?:https?:\/\/)?(?:www\.|mobile\.)?(?:twitter|x)\.com\//i;

/** Paths that are x.com's own, not anybody's handle. */
const RESERVED = new Set(['i', 'home', 'explore', 'notifications', 'messages', 'search', 'settings', 'hashtag']);

/**
 * `{ kind: 'post' | 'account', handle, tweetId, url }`, or `{ kind: 'unsupported', why }`.
 *
 * The URL is rebuilt canonically rather than passed through: a profile URL
 * carrying `?f=live` or a tracking parameter is the same account, and letting
 * two spellings of one account through would make two archives of it.
 */
export function parseTarget(input) {
  const raw = String(input ?? '').trim();
  if (!HOST.test(raw)) {
    return { kind: 'unsupported', why: 'that is not an x.com or twitter.com URL' };
  }

  const path = raw.replace(HOST, '').split(/[?#]/)[0].replace(/\/+$/, '');
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 0) {
    return { kind: 'unsupported', why: 'that URL names no account' };
  }

  const [handle, section, id] = parts;

  if (section === 'status' || section === 'statuses') {
    if (!/^\d+$/.test(id || '')) return { kind: 'unsupported', why: 'that post URL carries no post id' };
    return { kind: 'post', handle, tweetId: id, url: `https://x.com/${handle}/status/${id}` };
  }

  if (RESERVED.has(handle.toLowerCase())) {
    return { kind: 'unsupported', why: `x.com/${handle} is not an account this skill can archive` };
  }

  if (section && section !== 'media' && section !== 'tweets') {
    return {
      kind: 'unsupported',
      why: `x.com/<handle>/${section} is out of scope — this skill archives an account's own media`,
    };
  }

  return { kind: 'account', handle, tweetId: null, url: `https://x.com/${handle}` };
}
