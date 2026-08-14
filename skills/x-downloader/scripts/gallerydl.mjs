/**
 * gallerydl.mjs — how gallery-dl is invoked, and how its output is read back.
 *
 * gallery-dl does the enumerating and the fetching; this file is the whole of
 * what we say to it. Two invocations, both built here so the options that make
 * a run survivable cannot drift apart between them.
 */

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
 * These numbers are a conservative starting point and want measuring against a
 * real account; see scripts/README.md.
 */
export const THROTTLE = ['--sleep-request', '2.0', '--sleep', '1.0-3.0', '--retries', '2'];

/**
 * One tab-separated row per file, at the point gallery-dl has resolved
 * everything about it and is about to write it.
 *
 * Only fields `_transform_tweet` sets unconditionally are named here. The
 * optional ones — `reply_to`, `pinned` — raise a formatting error on the posts
 * that lack them, so replies are identified by `reply_id`, which is always
 * present and is 0 when the post is not a reply.
 *
 * Free text goes through `!j`, which JSON-encodes it: a post body containing
 * newlines or tabs would otherwise be indistinguishable from several rows.
 */
const FIELDS = [
  '{tweet_id}',
  '{num}',
  '{count}',
  '{extension}',
  '{date:%Y-%m-%d %H:%M:%S}',
  '{user[id]}',
  '{user[name]}',
  '{user[nick]!j}',
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

function optionArgs(options) {
  return Object.entries(options).flatMap(([key, value]) => ['-o', `${key}=${JSON.stringify(value)}`]);
}

/**
 * The listing pass: enumerate, print a row per file, download nothing.
 *
 * No archive is passed. gallery-dl's own skip-and-abort machinery does not run
 * in a listing pass anyway, and we need to see every post to report both "found"
 * and "on disk" honestly — a pass that only showed new posts could not tell the
 * user what fraction of the account they already have. The diff and the decision
 * to stop early are ours, in collect.mjs.
 */
export function listArgs({ url, cookies }) {
  return [
    '--config-ignore',
    ...cookieArgs({ cookies }),
    ...optionArgs(POLICY),
    ...THROTTLE,
    '--print',
    PRINT_FORMAT,
    url,
  ];
}

/**
 * One post, into a folder we have already named.
 *
 * `--directory` is an exact path, which is what lets naming.mjs own the layout
 * rather than expressing it as a gallery-dl format string — the naming rules are
 * ours, they are unit-tested, and they are not re-implemented in a config file.
 */
export function fetchArgs({ url, directory, cookies }) {
  return [
    '--config-ignore',
    ...cookieArgs({ cookies }),
    ...optionArgs(POLICY),
    ...THROTTLE,
    '--directory',
    directory,
    '--filename',
    '{num}.{extension}',
    url,
  ];
}

/**
 * Always a cookies.txt path, never a live browser read.
 *
 * run.mjs resolves the session to a file before anything here is called —
 * cached from a previous run, or exported from the browser once by
 * `cookieExportArgs`. Reading the browser prompts for Keychain access on macOS
 * and wants the browser closed, and a plan and a go would each pay it; twice per
 * download is the friction that makes people paste a raw token instead.
 */
export function cookieArgs({ cookies }) {
  return cookies ? ['--cookies', cookies] : [];
}

/** Seed the cache: read the browser once, write what it found to `cookies`. */
export function cookieExportArgs({ browser, cookies, url }) {
  return [
    '--config-ignore',
    '--cookies-from-browser',
    browser,
    '--cookies-export',
    cookies,
    '--simulate',
    '--range',
    '1',
    url,
  ];
}

/**
 * One printed row back into a file record, or null for anything that is not
 * one of ours. gallery-dl writes warnings and progress to the same streams;
 * a parser that guessed would turn a warning into a post.
 */
export function parseRow(line) {
  const parts = String(line).split('\t');
  if (parts.length !== FIELDS.length + 1) return null;
  if (parts[0] !== ROW_MARKER) return null;

  const [, tweetId, num, count, ext, date, userId, userName, userNick, replyId, content] = parts;
  if (!/^\d+$/.test(tweetId)) return null;

  return {
    tweetId,
    num: Number(num) || 0,
    count: Number(count) || 0,
    ext,
    date,
    user: { id: userId, name: userName, nick: decodeJson(userNick) },
    replyId: replyId && replyId !== '0' ? replyId : '',
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
 * What a gallery-dl failure was, as far as its output admits.
 *
 * Each of these needs a decided answer, because the alternative is an agent
 * inventing one. The distinction that matters most is the first: an account you
 * are not allowed to see reports zero posts, and zero posts rendered as "up to
 * date" would be a lie the user acts on.
 */
export function classifyFailure(output) {
  const text = String(output || '');
  if (/\b429\b|Rate.?limit|too many requests/i.test(text)) return 'rate-limited';
  if (/401|Unauthorized|login required|requires authentication|Auth.*fail/i.test(text)) return 'unauthorized';
  if (/suspended/i.test(text)) return 'suspended';
  if (/protected|not authorized to view|private account/i.test(text)) return 'protected';
  if (/does not exist|User not found|No user matches/i.test(text)) return 'missing';
  if (/\b404\b|Not Found/i.test(text)) return 'gone';
  return null;
}

/** The remedy for each, so the skill relays rather than improvises. */
export const REMEDIES = {
  'rate-limited':
    'X rate-limited this run. Nothing is broken and nothing is lost — wait a while, then\n' +
    'run the same command with --go again; it resumes at the first post still missing.',
  unauthorized:
    'X rejected the saved session. The cached cookies have been discarded; re-run and the\n' +
    'browser will be read again. If it fails a second time, sign in to X in that browser first.',
  suspended: 'This account is suspended on X. There is nothing to download.',
  protected:
    'This account is protected — its posts are visible only to accounts it has approved.\n' +
    'Signing in as an approved follower is the only way to archive it.',
  missing: 'No such account on X. Check the handle in the URL.',
  gone: 'That post no longer exists on X.',
};
