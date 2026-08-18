/**
 * platforms.mjs — the registry, and the only place that answers "which platform".
 *
 * One table. A platform is a name, the folder its scripts live in, the hosts it
 * answers for, and a label a refusal message can print. Adding a platform is a
 * folder under `scripts/platforms/` and a line here; there is nowhere else to
 * remember. The folder is named bare: `dispatch.mjs` composes the path.
 *
 * What this decides is *which* platform a URL belongs to — never whether that
 * URL is something the platform can archive. A single-post URL, a bookmarks
 * page and a suspended account all belong to a platform, and each is refused by
 * name once dispatched. Refusing them here would answer "unsupported platform",
 * which is both wrong and unhelpful.
 */
import { Refusal } from './errors.mjs';

/**
 * Host patterns are anchored at the start of the argument and must end at a
 * path, query, fragment or the end of the string.
 *
 * That tightness is load-bearing. The URL may sit anywhere in the command line —
 * `--archives ~/data <url> --plan` is as valid as `<url> --archives ~/data` —
 * so every argument is scanned, which means a directory name must not be able to
 * answer for a URL. `./douyin.com` and `/data/x.com-backup` are paths: the first
 * fails the anchor, the second fails the terminator.
 */
const DOUYIN = /^(?:https?:\/\/)?(?:[a-z0-9-]+\.)*douyin\.com(?:[/?#]|$)/i;
const X = /^(?:https?:\/\/)?(?:[a-z0-9-]+\.)*(?:twitter|x)\.com(?:[/?#]|$)/i;
/**
 * `instagr.am` is Instagram's own shortener and resolves to the same site. The
 * third-party embed mirrors — ddinstagram.com and its kin — are somebody else's
 * rewriting proxy and are deliberately absent: the subdomain group needs a
 * literal dot to match, so `ddinstagram.com` fails the anchor the same way
 * `foox.com` fails X's.
 */
const INSTAGRAM = /^(?:https?:\/\/)?(?:[a-z0-9-]+\.)*(?:instagram\.com|instagr\.am)(?:[/?#]|$)/i;

/**
 * `account` is the descriptor the shared account store is threaded with: the
 * folder this platform's accounts live under, and what `account.json` calls the
 * readable handle. See `account.mjs`.
 *
 * `postIdKey` is what a collected post calls its own id — `tweetId` for X, `id`
 * for Douyin. It is the only thing separating the two platforms' "which of these
 * posts are still missing" from one shared rule, so it is named here rather than
 * inferred anywhere that asks the question.
 */
export const PLATFORMS = [
  {
    name: 'douyin',
    dir: 'douyin',
    label: 'Douyin',
    hosts: ['douyin.com'],
    match: (arg) => DOUYIN.test(arg),
    account: { platform: 'douyin', handleKey: 'douyin_id' },
    postIdKey: 'id',
    // The flags that are this platform's alone, for the help a bare run prints.
    // Here rather than in the dispatcher so that adding a platform stays what it
    // claims to be: a folder, and one entry in this table.
    usage: 'douyin.com/user/<sec_uid>',
    flags: [
      ['--login', 'Sign in to Douyin in a browser, and stop.'],
      ['--profile DIR', 'Browser profile holding that session.'],
    ],
  },
  {
    name: 'x',
    dir: 'x',
    label: 'X, formerly Twitter',
    hosts: ['x.com', 'twitter.com'],
    match: (arg) => X.test(arg),
    account: { platform: 'x', handleKey: 'handle' },
    postIdKey: 'tweetId',
    usage: 'x.com/<handle>',
    flags: [
      ['--browser NAME', 'Browser to read the X session from the first time'],
      ['', '(chrome, firefox, safari, edge, brave, chromium...).'],
      ['--cookies FILE', 'Use this cookies.txt instead of a browser or the cache.'],
      ['--full', 'List the whole timeline even when a re-run could stop early.'],
    ],
  },
  {
    name: 'instagram',
    dir: 'instagram',
    label: 'Instagram',
    hosts: ['instagram.com', 'instagr.am'],
    match: (arg) => INSTAGRAM.test(arg),
    account: { platform: 'instagram', handleKey: 'username' },
    // A shortcode rather than the numeric media id: it is what a permalink is
    // built from, and `--go` fetches every approved post by permalink.
    postIdKey: 'shortcode',
    usage: 'instagram.com/<handle>',
    flags: [
      ['--browser NAME', 'Browser to read the Instagram session from the first time'],
      ['', '(chrome, firefox, safari, edge, brave, chromium...).'],
      ['--cookies FILE', 'Use this cookies.txt instead of a browser or the cache.'],
      ['--full', 'List the whole profile even when a re-run could stop early.'],
    ],
  },
];

/**
 * The flags whose *next* argument is a value, so detection can step over it.
 *
 * Derived from the table above — a platform's own flag is spelled `--browser
 * NAME` there precisely because it takes one — plus the two every platform
 * shares. Nothing else has to be remembered when a platform is added.
 *
 * It is needed because an alias and an archives path are free to look like
 * hosts. `--alias douyin.com` is a legal folder name, and a scan that read it
 * would dispatch the run into a platform the command line never named.
 */
const VALUE_FLAGS = new Set([
  '--archives',
  '--alias',
  ...PLATFORMS.flatMap((platform) =>
    platform.flags
      .filter(([flag]) => /^--\S+\s+\S/.test(flag))
      .map(([flag]) => flag.split(/\s+/)[0])),
]);

/** One platform's account descriptor, by name. */
export function descriptorFor(name) {
  return byName(name).account;
}

/** What one platform's collected posts call their own id. */
export function postIdKeyFor(name) {
  return byName(name).postIdKey;
}

/**
 * What a platform is called in prose, by name.
 *
 * The session refusals name the site — "no saved Instagram session yet" — and a
 * platform's run.mjs respelling its own label is a second copy free to drift
 * from the one the refusal listing prints.
 */
export function labelFor(name) {
  return byName(name).label;
}

function byName(name) {
  const platform = PLATFORMS.find((candidate) => candidate.name === name);
  if (!platform) throw new Error(`no platform called '${name}'`);
  return platform;
}

/**
 * The platform a command line is about, or null if no argument names one.
 *
 * Every argument is scanned except the value of a flag that takes one, because
 * the URL may sit anywhere: `--archives ~/data <url> --plan` is as valid as
 * `<url> --archives ~/data`.
 *
 * Throws when two platforms are named at once. That is a refusal rather than a
 * choice because the run archives one account into one folder: picking either
 * URL would silently ignore the other, and the plan/go pair that follows would
 * be built for an account the user did not mean.
 */
export function detect(argv) {
  const named = new Set();
  const urls = [];
  let found = null;
  let terminated = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = String(argv[i]);

    if (!terminated) {
      if (arg === '--') {
        terminated = true;
        continue;
      }
      // A flag's value is the flag's business, never a URL. Stepping over it is
      // what keeps `--alias douyin.com --plan <x url>` an X run.
      if (VALUE_FLAGS.has(arg)) {
        i++;
        continue;
      }
    }

    const platform = PLATFORMS.find((candidate) => candidate.match(arg));
    if (!platform) continue;
    named.add(platform.name);
    urls.push(arg);
    found = found ?? platform;
  }

  if (named.size > 1) {
    throw new Refusal(
      'multiple-platforms',
      `that names ${[...named].join(' and ')} — this archives one account at a time`,
      { details: { urls } },
    );
  }
  return found;
}

/** Every platform this skill archives, for a refusal that has to list them. */
export function supportedPlatforms() {
  return PLATFORMS.map(({ name, label, hosts }) => ({ name, label, hosts }));
}

/** The supported platforms, as prose a refusal message can end a sentence with. */
export function supported() {
  const each = PLATFORMS.map(
    (platform) => `${platform.label} (${platform.hosts.join(', ')})`,
  );
  return each.length <= 1
    ? (each[0] ?? '')
    : `${each.slice(0, -1).join(', ')} and ${each[each.length - 1]}`;
}

/** Each platform's own flags, as help the dispatcher can print without knowing them. */
export function platformHelp() {
  return PLATFORMS.map((platform) => {
    const rows = platform.flags.map(
      ([flag, text]) => `      ${flag.padEnd(17)} ${text}`,
    );
    return [`  ${platform.label} — ${platform.usage}`, ...rows].join('\n');
  }).join('\n\n');
}
