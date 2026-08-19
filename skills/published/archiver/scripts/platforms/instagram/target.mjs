/**
 * target.mjs — what the user pointed at.
 *
 * One entry point: an account. Everything else on instagram.com — a single
 * post, a story, the tagged tab, explore, direct — is refused by name rather
 * than quietly treated as an account.
 *
 * The single-post URLs are what make this worth a module, and Instagram has two
 * spellings of them. `/p/<shortcode>` names no account at all, and
 * `/<handle>/p/<shortcode>` puts the handle in exactly the position a profile
 * URL does — so anything that stopped reading after the first segment would
 * answer "download this post" by archiving the whole account.
 */
import { Refusal } from '../../shared/errors.mjs';

const HOST = /^(?:https?:\/\/)?(?:[a-z0-9-]+\.)*(?:instagram\.com|instagr\.am)\//i;

/** Letters, digits, dots and underscores, up to 30 — Instagram's own rule. */
const HANDLE = /^[a-z0-9._]{1,30}$/i;

/**
 * The sections that name one post. Refused with a message about that post
 * rather than through the generic out-of-scope branch, because a user who
 * pasted one is asking for something this could plausibly have done.
 */
const SINGLE_POST = new Set(['p', 'reel', 'reels', 'tv']);

/**
 * Profile tabs this does not archive.
 *
 * `tagged` is other people's uploads and `saved` is other people's posts —
 * neither is this account's own media. `reels` is deliberately absent: it is a
 * subset of what a run already collects, so it is canonicalised to the profile
 * rather than refused.
 */
const OUT_OF_SCOPE = new Set(['tagged', 'saved', 'followers', 'following']);

/** Paths that are instagram.com's own, not anybody's handle. */
const RESERVED = new Set([
  'about', 'accounts', 'api', 'challenge', 'developer', 'direct', 'emails', 'explore',
  'graphql', 'help', 'legal', 'oauth', 'privacy', 'session', 'stories', 'web',
]);

/**
 * `{ handle, url }`, or a throw naming what is wrong with the URL.
 *
 * Refusal is a throw rather than a returned verdict because there is one kind
 * of answer: a caller that reads past this has an account, and nothing to
 * branch on.
 *
 * The URL is rebuilt canonically — one host spelling, no trailing slash, no
 * query — and the handle is lower-cased, because Instagram treats
 * `/SomeOne` and `/someone` as one account and two spellings reaching the
 * archive would be two folders for one person.
 */
export function parseTarget(input) {
  const raw = String(input ?? '').trim();
  if (!HOST.test(raw)) {
    throw new Refusal('url-not-platform', 'that is not an instagram.com URL', {
      details: { url: raw },
    });
  }

  const path = raw.replace(HOST, '').split(/[?#]/)[0].replace(/\/+$/, '');
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 0) {
    throw new Refusal('url-no-account', 'that URL names no account', { details: { url: raw } });
  }

  const [first, second, third] = parts;

  // Before the reserved check, because `/p/<code>` and `/reel/<code>` are
  // reserved words in the handle position and deserve the post's answer rather
  // than "that is not a handle".
  if (SINGLE_POST.has(first.toLowerCase()) && second) {
    throw singlePost({ handle: null, shortcode: second });
  }

  // A story names its account, so the remedy can point at it — but a story is
  // gone within a day, which is why this skill does not archive one.
  if (first.toLowerCase() === 'stories' && second) {
    const handle = second.toLowerCase();
    throw new Refusal(
      'url-out-of-scope',
      'that URL names a story, and stories are gone within a day — this archives an account\'s posts and reels',
      {
        details: { section: 'stories', handle },
        remedy: { message: `archive the account instead, at ${profileUrl(handle)}`, run_by: 'user' },
      },
    );
  }

  if (RESERVED.has(first.toLowerCase())) {
    throw new Refusal(
      'url-reserved-handle',
      `instagram.com/${first} is not an account this skill can archive`,
      { details: { handle: first } },
    );
  }

  if (!HANDLE.test(first)) {
    throw new Refusal('url-not-profile', `${JSON.stringify(first)} is not an Instagram username`, {
      details: { handle: first },
    });
  }

  const handle = first.toLowerCase();

  if (second && SINGLE_POST.has(second.toLowerCase()) && third) {
    throw singlePost({ handle, shortcode: third });
  }

  if (second && OUT_OF_SCOPE.has(second.toLowerCase())) {
    throw new Refusal(
      'url-out-of-scope',
      `instagram.com/<handle>/${second} is out of scope — this archives an account's own posts and reels`,
      {
        details: { section: second.toLowerCase(), handle },
        remedy: { message: `archive the account instead, at ${profileUrl(handle)}`, run_by: 'user' },
      },
    );
  }

  return { handle, url: profileUrl(handle) };
}

/**
 * One post, refused. The handle is null for `/p/<shortcode>`, which genuinely
 * names nobody — so the remedy asks for the profile rather than naming an
 * account this would otherwise have had to guess.
 */
function singlePost({ handle, shortcode }) {
  return new Refusal(
    'url-single-post',
    handle
      ? `that URL names one post by @${handle}, and this skill archives an account's whole profile`
      : "that URL names one post, and this skill archives an account's whole profile",
    {
      details: { handle, shortcode },
      remedy: {
        message: handle
          ? `archive the account instead, at ${profileUrl(handle)}`
          : "give the profile URL of the account that posted it — instagram.com/<handle>",
        run_by: 'user',
      },
    },
  );
}

const profileUrl = (handle) => `https://www.instagram.com/${handle}`;

/**
 * The canonical permalink for a post, which is also how `--go` re-fetches it.
 *
 * Handle-free on purpose. Instagram handles are mutable, and a permalink
 * carrying one would stop resolving the day the account is renamed — which,
 * between a plan and the `--go` that acts on it, is a whole approved list
 * quietly 404ing.
 */
export function permalink(shortcode) {
  return `https://www.instagram.com/p/${shortcode}`;
}

/**
 * The URL one listing pass enumerates.
 *
 * A profile's posts and its reels are two extractors, reached by two URLs, and
 * they are two passes rather than one because each needs its own early stop — a
 * single pass covering both would halt in the posts half and never reach a reel.
 *
 * Both name their extractor outright. The bare profile URL would work for posts
 * — it dispatches there by default — but only by way of a config key that
 * chooses between posts, reels, stories and the rest, and a URL that says which
 * feed it means cannot disagree with one.
 */
export function feedUrl(profile, category) {
  return `${profile}/${category}`;
}
