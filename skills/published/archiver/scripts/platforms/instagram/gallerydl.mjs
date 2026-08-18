/**
 * gallerydl.mjs — how gallery-dl is invoked, and how its output is read back.
 *
 * gallery-dl does the enumerating and the fetching; this file is the whole of
 * what we say to it. Two invocations, both built here so the options that make
 * a run survivable cannot drift apart between them.
 */
import { cookieArgs } from '../../shared/session.mjs';
import { httpStatus } from '../../shared/subprocess.mjs';

/**
 * The policy the skill imposes, as gallery-dl config keys.
 *
 * Every one of these is already gallery-dl's default. They are set anyway,
 * because a default that changes upstream would silently change what this skill
 * archives — and `pinned` in particular decides whether the posts an account
 * chose to feature are in the archive at all.
 *
 *   videos      the reels and the video half of a carousel are the point
 *   previews    a video's poster frame is not a second piece of media
 *   metadata    an extra request per post for figures nothing here reads
 *   order-files carousel order is what `1.jpg, 2.jpg` means, so it is stated
 *               rather than inherited
 *   pinned      Instagram pins up to three posts to the top of a profile; a run
 *               that dropped them would be short by the posts the account most
 *               wanted seen
 *
 * `include` is deliberately absent. It is what the *user profile* URL's
 * dispatcher reads to choose between posts, reels, stories and the rest — and
 * this skill never hands gallery-dl that URL. Each pass names its feed's own
 * extractor outright, `/<handle>/posts` and `/<handle>/reels`, so which feed is
 * being read is the URL rather than a config key that has to agree with one.
 */
export const POLICY = {
  'extractor.instagram.videos': true,
  'extractor.instagram.previews': false,
  'extractor.instagram.metadata': false,
  'extractor.instagram.order-files': 'asc',
  'extractor.instagram.pinned': true,
};

/**
 * The pauses are what let a long run finish.
 *
 * Slower than X's on purpose, and the reason is the failure mode rather than
 * the limit. X answers a client going too fast with a 429 that a later `--go`
 * resumes from; Instagram answers by challenging the *account*, which is the
 * user's own and which no amount of waiting here clears. gallery-dl's own
 * documentation puts Instagram in the 6–12 second range for this reason.
 *
 * `retries` is deliberately low for the other half of it: a client hammering
 * its way through a rate limit is exactly what escalates one into a checkpoint.
 *
 * These numbers are unverified against a live account. README.md beside this
 * file carries the reasoning.
 */
export const THROTTLE = ['--sleep-request', '6.0-12.0', '--sleep', '1.0-3.0', '--retries', '2'];

/**
 * One tab-separated row per file, at the point gallery-dl has resolved
 * everything about it and is about to write it.
 *
 * The optional fields carry an explicit `|''` fallback, because gallery-dl's
 * formatter does not raise on a key it cannot find — it renders the literal
 * string `None`, which would be indistinguishable from a value and would land
 * in `post.json` as a media URL.
 *
 * Free text goes through `!j`, which JSON-encodes it: a caption containing
 * newlines or tabs would otherwise be indistinguishable from several rows.
 *
 * `post_shortcode` rather than `post_id`: the shortcode is what a permalink is
 * built from, and `--go` fetches every approved post by permalink.
 *
 * The media URL is `video_url` falling back to `display_url`, the two keys the
 * extractor actually sets — a video carries both, an image only the second.
 * There is no bare `url` key to ask for: the URL gallery-dl downloads from is
 * passed beside the metadata rather than inside it.
 *
 * `count` is how many files the extractor found for the post, which is what
 * makes a listing cut off mid-carousel detectable at all.
 */
const FIELDS = [
  '{post_shortcode}',
  '{num}',
  '{count}',
  '{extension}',
  "{media_id|''}",
  "{typename|''}",
  "{video_url|display_url|''}",
  '{date:%Y-%m-%d %H:%M:%S}',
  '{owner_id}',
  '{username}',
  '{fullname!j}',
  '{description!j}',
];

/** Marks our rows, so gallery-dl's own chatter on stdout is never parsed as data. */
export const ROW_MARKER = 'igdl';

/**
 * The `prepare:` prefix is required, not cosmetic. gallery-dl splits the
 * --print value on its *first* colon to find an event name, so a bare format
 * containing `{date:%Y-%m-%d}` would be read as an event called `{date`.
 */
export const PRINT_FORMAT = `prepare:${[ROW_MARKER, ...FIELDS].join('\t')}`;

/**
 * A shortcode is base64url, and it becomes half a post folder's name.
 *
 * Checked on the way in rather than where the name is built. A separator in
 * this position is not a badly named folder — it is a tree written somewhere
 * else entirely — and a row that cannot be trusted with a path is a row this
 * pass has no use for.
 */
const SHORTCODE = /^[A-Za-z0-9_-]+$/;

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
 * One printed row back into a file record, or null for anything that is not one
 * of ours. gallery-dl writes warnings and progress to the same streams; a
 * parser that guessed would turn a warning into a post.
 */
export function parseRow(line) {
  const parts = String(line).split('\t');
  if (parts.length !== FIELDS.length + 1) return null;
  if (parts[0] !== ROW_MARKER) return null;

  const [
    , shortcode, num, count, ext, mediaId, typename, url, date,
    ownerId, username, fullname, description,
  ] = parts;

  if (!SHORTCODE.test(shortcode)) return null;
  // The owner id becomes the account folder's name and the identity a plan is
  // checked against, so a row that renders it as `None` is not one to file
  // anything under.
  if (!/^\d+$/.test(ownerId)) return null;

  return {
    shortcode,
    num: Number(num) || 0,
    count: Number(count) || 0,
    ext,
    // Instagram gives every item of a carousel its own id, so unlike X's videos
    // there is nothing here that a re-encode could change.
    mediaId: mediaId || '',
    type: typename,
    url,
    date,
    user: { id: ownerId, name: username, nick: decodeJson(fullname) },
    content: decodeJson(description),
  };
}

/**
 * `!j` output is a JSON string; anything else is taken at face value.
 *
 * A JSON `null` becomes the empty string rather than the four letters "null".
 * That is what `!j` renders for a caption the extractor never set, and a post
 * whose words are the literal word null is worse than one with none.
 */
function decodeJson(value) {
  try {
    const parsed = JSON.parse(value);
    if (parsed === null) return '';
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
 * date" would be a lie the user acts on.
 *
 * A checkpoint is checked before a rejected session and deliberately so.
 * Instagram answers a flagged account with a challenge whose text also mentions
 * logging in, and reading that as a dead cookie would throw away a working
 * session and send the user round a circle that cannot close: the thing to fix
 * is in the app, not in the browser this reads.
 */
export function classifyFailure(output) {
  const text = String(output || '');

  // Instagram's own challenge page. Anchored to the redirect gallery-dl writes
  // and to the path it redirected to, rather than to the word "challenge" — a
  // Cloudflare challenge is a different thing entirely, says nothing about this
  // account, and telling the user to clear a prompt in the Instagram app would
  // send them looking for something that is not there.
  if (/redirect to challenge page|instagram\.com\/challenge\//i.test(text)) {
    return 'checkpoint-required';
  }

  if (/\b429\b|Rate.?limit|too many requests|wait a few minutes/i.test(text)) return 'rate-limited';

  if (
    /redirect to login page|accounts\/login\//i.test(text) ||
    /authenticated cookies needed|login required/i.test(text) ||
    httpStatus(401, 'Unauthorized').test(text)
  ) {
    return 'session-rejected';
  }

  // "someone's posts are private" is the extractor's own wording for an account
  // that has not approved the session doing the asking.
  if (/posts are private|private (?:profile|account)|account is private/i.test(text)) {
    return 'protected';
  }

  if (/Requested user could not be found|Unable to find user|User not found/i.test(text)) {
    return 'no-such-account';
  }

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
    message: 'Instagram rate-limited this run — nothing is broken and nothing is lost',
    remedy: {
      message: 'wait a while, then run the download again; it resumes at the first post still missing',
      run_by: 'agent',
    },
  },
  'checkpoint-required': {
    message: 'Instagram is holding this account behind a challenge, and the saved session is not the problem',
    remedy: {
      message:
        'open Instagram in the app or a browser, clear the prompt it is showing, then run this again — ' +
        'the saved session still works and does not need replacing',
      run_by: 'user',
    },
  },
  'session-rejected': {
    message: 'Instagram rejected the saved session, and the cached cookies have been discarded',
    remedy: {
      message: 'sign in to Instagram in a browser, then run again naming that browser as the session source',
      run_by: 'user',
    },
  },
  protected: {
    message: 'this account is private — its posts are visible only to accounts it has approved',
    remedy: { message: 'archiving it needs a session signed in as an approved follower', run_by: 'user' },
  },
  'no-such-account': { message: 'no such account on Instagram' },
  'post-gone': { message: 'that post no longer exists on Instagram' },
  'downloader-unavailable': { message: 'gallery-dl could not be started' },
  'collect-failed': { message: 'the listing pass failed, and its output does not say why' },
};
