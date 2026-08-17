/**
 * platforms.mjs — the registry, and the only place that answers "which platform".
 *
 * One table. A platform is a name, the folder its scripts live in, the hosts it
 * answers for, and a label a refusal message can print. Adding a platform is a
 * folder under `scripts/` and a line here; there is nowhere else to remember.
 *
 * What this decides is *which* platform a URL belongs to — never whether that
 * URL is something the platform can archive. A single-post URL, a bookmarks
 * page and a suspended account all belong to a platform, and each is refused by
 * name once dispatched. Refusing them here would answer "unsupported platform",
 * which is both wrong and unhelpful.
 */

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
];

/** One platform's account descriptor, by name. */
export function descriptorFor(name) {
  const platform = PLATFORMS.find((candidate) => candidate.name === name);
  if (!platform) throw new Error(`no platform called '${name}'`);
  return platform.account;
}

/**
 * The platform a command line is about, or null if no argument names one.
 *
 * Throws when two platforms are named at once. That is a refusal rather than a
 * choice because the run archives one account into one folder: picking either
 * URL would silently ignore the other, and the plan/go pair that follows would
 * be built for an account the user did not mean.
 */
export function detect(argv) {
  const named = new Set();
  let found = null;
  for (const arg of argv) {
    const platform = PLATFORMS.find((candidate) => candidate.match(String(arg)));
    if (!platform) continue;
    named.add(platform.name);
    found = found ?? platform;
  }

  if (named.size > 1) {
    throw new Error(
      `that names ${[...named].join(' and ')} — this archives one account at a time`,
    );
  }
  return found;
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
