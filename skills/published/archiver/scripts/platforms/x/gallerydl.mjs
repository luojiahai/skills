/**
 * gallerydl.mjs — how gallery-dl is invoked, and how its output is read back.
 *
 * gallery-dl does the enumerating and the fetching; this file is the whole of
 * what we say to it. Two invocations, both built here so the options that make
 * a run survivable cannot drift apart between them.
 */
import { httpStatus } from '../../shared/subprocess.mjs';


/**
 * The policy the skill imposes, as gallery-dl config keys.
 *
 * `retweets`, `quoted` and `text-tweets` are already gallery-dl's defaults; they
 * are set explicitly anyway, because a user's own ~/.config/gallery-dl/config.json
 * is loaded before ours and may say otherwise, and because a default that
 * changes upstream would silently change what this skill archives.
 *
 *   retweets    a retweet is someone else's upload; filing it under this
 *               account would misattribute it
 *   replies     "self" keeps a thread the account wrote, drops replies to
 *               other people
 *   quoted      the quoted post belongs to whoever wrote it
 *   pinned      NOT gallery-dl's default. The timeline API returns pinned posts
 *               separately and they are dropped unless asked for, which would
 *               silently omit the post the account chose to feature
 *   videos      true fetches the highest-bitrate variant directly. The
 *               alternative, "ytdl", hands off to yt-dlp and covers broadcasts
 *               and Spaces — both out of scope, so the extra moving part is not
 *               bought. One line to change if a variant turns out unfetchable.
 */
export const POLICY = {
  'extractor.twitter.retweets': false,
  'extractor.twitter.quoted': false,
  'extractor.twitter.replies': 'self',
  'extractor.twitter.pinned': true,
  'extractor.twitter.videos': true,
  'extractor.twitter.text-tweets': false,
  'extractor.twitter.cards': false,
};

/**
 * The pauses are what let a long run finish.
 *
 * X rate-limits the timeline endpoints hard, and the failure is not a slow run
 * but a stopped one — and, with the user's own session doing the asking, a
 * stopped one that can escalate to a challenged account. Tuning these down to
 * make a run finish faster is what stops it finishing. `retries` is deliberately
 * low: a 429 should surface as a clean stop that a later `--go` resumes, not as
 * a client hammering its way into a longer lockout.
 *
 * These numbers are a conservative starting point, unverified against a live
 * account. README.md beside this file carries the reasoning, under "The pauses
 * are what let a long run finish".
 */
export const THROTTLE = ['--sleep-request', '2.0', '--sleep', '1.0-3.0', '--retries', '2'];

/**
 * One tab-separated row per file, at the point gallery-dl has resolved
 * everything about it and is about to write it.
 *
 * Only fields `_transform_tweet` sets unconditionally are named bare. The
 * optional ones carry an explicit `|''` fallback, because gallery-dl's formatter
 * renders a key it cannot find as the literal string `None` — which would be
 * indistinguishable from a real value, and would put the four characters "None"
 * into post.json as a media URL.
 *
 * Free text goes through `!j`, which JSON-encodes it: a post body containing
 * newlines or tabs would otherwise be indistinguishable from several rows.
 *
 * `filename` is the basename of the media URL. For an image that is the
 * pbs.twimg.com media token — globally unique, stable for the life of the
 * upload — which is what makes it worth carrying into post.json. For a video it
 * is the basename of whichever variant had the highest bitrate, so parseRow
 * drops it rather than record something re-encoding can change.
 */
const FIELDS = [
  '{tweet_id}',
  '{num}',
  '{count}',
  '{extension}',
  "{filename|''}",
  "{type|''}",
  "{url|''}",
  '{date:%Y-%m-%d %H:%M:%S}',
  '{user[id]}',
  '{user[name]}',
  '{user[nick]!j}',
  "{user[profile_image]|''}",
  "{user[profile_banner]|''}",
  '{reply_id}',
  '{content!j}',
];

/** Marks our rows, so gallery-dl's own chatter on stdout is never parsed as data. */
export const ROW_MARKER = 'xdl';

/**
 * The `prepare:` prefix is required, not cosmetic. gallery-dl splits the
 * --print value on its *first* colon to find an event name, so a bare format
 * containing `{date:%Y-%m-%d}` would be read as an event called `{date`.
 */
export const PRINT_FORMAT = `prepare:${[ROW_MARKER, ...FIELDS].join('\t')}`;

/**
 * What this platform says to gallery-dl that another would not: its extractor's
 * config keys, its pauses, and the rows it asks for. The two invocations those
 * feed are `../../shared/gallerydl.mjs`.
 */
export const TOOL = { policy: POLICY, throttle: THROTTLE, printFormat: PRINT_FORMAT };

/**
 * One printed row back into a file record, or null for anything that is not
 * one of ours. gallery-dl writes warnings and progress to the same streams;
 * a parser that guessed would turn a warning into a post.
 */
export function parseRow(line) {
  const parts = String(line).split('\t');
  if (parts.length !== FIELDS.length + 1) return null;
  if (parts[0] !== ROW_MARKER) return null;

  const [
    , tweetId, num, count, ext, filename, type, url, date,
    userId, userName, userNick, profileImage, profileBanner, replyId, content,
  ] = parts;
  if (!/^\d+$/.test(tweetId)) return null;

  return {
    tweetId,
    num: Number(num) || 0,
    count: Number(count) || 0,
    ext,
    // Only a photo's basename is the media token. A video's is a variant name
    // that a re-encode can change, so it is not recorded as an identity.
    mediaId: type === 'photo' ? filename : '',
    type,
    url,
    date,
    user: {
      id: userId,
      name: userName,
      nick: decodeJson(userNick),
      avatar: profileImage,
      banner: profileBanner,
    },
    // Validated the same way tweetId is, and for the same reason: `{reply_id}`
    // is spelled bare above, so a row that omits the key renders it as the
    // literal `None` — which would be written into the archive as a permalink to
    // a post that does not exist.
    replyId: /^\d+$/.test(replyId) && replyId !== '0' ? replyId : '',
    content: decodeJson(content),
  };
}

/** `!j` output is a JSON string; anything else is taken at face value. */
function decodeJson(value) {
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === 'string' ? parsed : String(value ?? '');
  } catch {
    return String(value ?? '');
  }
}

/**
 * What a gallery-dl failure was, as far as its output admits, as the refusal
 * code that names it.
 *
 * Each of these needs a decided answer, because the alternative is an agent
 * inventing one. The distinction that matters most is the first: an account you
 * are not allowed to see reports zero posts, and zero posts reported as "up to
 * date" would be a lie the user acts on. A rate limit and a rejected session are
 * two codes for the same reason — one says wait, the other says sign in again.
 */
export function classifyFailure(output) {
  const text = String(output || '');
  if (/\b429\b|Rate.?limit|too many requests/i.test(text)) return 'rate-limited';
  if (httpStatus(401, 'Unauthorized').test(text) || /login required|requires authentication|Auth.*fail/i.test(text)) {
    return 'session-rejected';
  }
  if (/suspended/i.test(text)) return 'suspended';
  if (/\bprotected\s+(?:account|tweets?|user)\b|\baccount\s+is\s+protected\b|not authorized to view|private account/i.test(text)) {
    return 'protected';
  }
  if (/does not exist|User not found|No user matches/i.test(text)) return 'no-such-account';
  if (httpStatus(404, 'Not\\s+Found').test(text)) return 'post-gone';
  return null;
}

/**
 * The fallback sentence for each code, and how it is put right.
 *
 * The sentence is what a refusal carries as `message`, which is not what the
 * user is told — `SKILL.md` branches on the code and words the outcome itself.
 * The remedy is the part with teeth: whether it is the agent's to run or the
 * user's.
 */
export const FAILURES = {
  'rate-limited': {
    message: 'X rate-limited this run — nothing is broken and nothing is lost',
    remedy: {
      message: 'wait a while, then run the download again; it resumes at the first post still missing',
      run_by: 'agent',
    },
  },
  'session-rejected': {
    message: 'X rejected the saved session, and the cached cookies have been discarded',
    remedy: {
      message: 'sign in to X in a browser, then run again naming that browser as the session source',
      run_by: 'user',
    },
  },
  suspended: { message: 'this account is suspended on X, so there is nothing to download' },
  protected: {
    message: 'this account is protected — its posts are visible only to accounts it has approved',
    remedy: { message: 'archiving it needs a session signed in as an approved follower', run_by: 'user' },
  },
  'no-such-account': { message: 'no such account on X' },
  'post-gone': { message: 'that post no longer exists on X' },
  'downloader-unavailable': { message: 'gallery-dl could not be started' },
  'collect-failed': { message: 'the listing pass failed, and its output does not say why' },
};
