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
import { Refusal } from '../../shared/errors.mjs';

const HOST = /^(?:https?:\/\/)?(?:www\.|mobile\.)?(?:twitter|x)\.com\//i;

/**
 * The sections that name one post. Refused with a message about that post rather
 * than through the generic out-of-scope branch — the handle sits in the same
 * position as a profile URL's, so this is the confusion the module exists for
 * and it is worth saying what the user actually pointed at.
 */
const SINGLE_POST = new Set(['status', 'statuses']);

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
    throw new Refusal('url-not-platform', 'that is not an x.com or twitter.com URL', {
      details: { url: raw },
    });
  }

  const path = raw.replace(HOST, '').split(/[?#]/)[0].replace(/\/+$/, '');
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 0) {
    throw new Refusal('url-no-account', 'that URL names no account', { details: { url: raw } });
  }

  const [handle, section] = parts;

  if (RESERVED.has(handle.toLowerCase())) {
    throw new Refusal(
      'url-reserved-handle',
      `x.com/${handle} is not an account this skill can archive`,
      { details: { handle } },
    );
  }

  if (SINGLE_POST.has(section)) {
    throw new Refusal(
      'url-single-post',
      `that URL names one post by @${handle}, and this skill archives an account's whole media timeline`,
      {
        details: { handle, section },
        remedy: {
          message: `archive the account instead, at https://x.com/${handle}`,
          run_by: 'user',
        },
      },
    );
  }

  if (section && section !== 'media' && section !== 'tweets') {
    throw new Refusal(
      'url-out-of-scope',
      `x.com/<handle>/${section} is out of scope — this skill archives an account's own media`,
      { details: { section } },
    );
  }

  return { handle, url: `https://x.com/${handle}` };
}

/** The canonical permalink for a post, which is also how `--go` re-fetches it. */
export function permalink(handle, tweetId) {
  return `https://x.com/${handle || 'i/web'}/status/${tweetId}`;
}
