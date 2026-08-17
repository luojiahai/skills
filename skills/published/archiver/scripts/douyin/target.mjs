/**
 * target.mjs — what the user pointed at.
 *
 * One entry point: an account. A `/video/` or `/note/` URL is refused by name
 * rather than quietly read as the account that posted it — this skill archives
 * accounts, and answering "download this one video" by fetching someone's whole
 * profile is the mistake worth a module of its own.
 *
 * A `v.douyin.com` share link cannot be resolved without following it, so it is
 * refused with the one instruction that works: open it and copy where it lands.
 */
import { Refusal } from '../shared/errors.mjs';

const PROFILE = /^(?:https?:\/\/)?(?:[a-z0-9-]+\.)*douyin\.com\/user\/([^/?#]+)/i;
const SHARE = /^(?:https?:\/\/)?v\.douyin\.com\//i;

const EXPECTED = 'Expected https://www.douyin.com/user/MS4wLjABAAAA...';

/**
 * `{ secUid, url }`, or a throw naming what is wrong with the URL.
 *
 * Refusal is a throw rather than a returned verdict because there is one kind of
 * answer: a caller that reads past this has an account, and nothing to branch
 * on.
 *
 * The URL is rebuilt canonically rather than passed through. The sec_uid is the
 * account's immutable identity and everything else in the URL is decoration, so
 * two spellings of one profile must not become two archives of it.
 */
export function parseTarget(input) {
  const raw = String(input ?? '').trim();

  if (SHARE.test(raw)) {
    throw new Refusal(
      'url-share-link',
      `v.douyin.com share links have to be expanded first. ${EXPECTED}`,
      {
        details: { url: raw },
        remedy: {
          message: 'open the share link in a browser and copy the douyin.com profile URL it lands on',
          run_by: 'user',
        },
      },
    );
  }

  const match = raw.match(PROFILE);
  if (!match) {
    throw new Refusal('url-not-profile', `not a Douyin profile URL: ${raw || '(none)'}. ${EXPECTED}`, {
      details: { url: raw },
    });
  }

  const secUid = match[1];
  return { secUid, url: `https://www.douyin.com/user/${secUid}` };
}

/** The canonical permalink for a post, which is also how `--go` re-fetches it. */
export function permalink(postId) {
  return `https://www.douyin.com/video/${postId}`;
}
