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

export const PLATFORMS = [
  {
    name: 'douyin',
    dir: 'douyin',
    label: 'Douyin',
    hosts: ['douyin.com'],
    match: (arg) => DOUYIN.test(arg),
  },
  {
    name: 'x',
    dir: 'x',
    label: 'X, formerly Twitter',
    hosts: ['x.com', 'twitter.com'],
    match: (arg) => X.test(arg),
  },
];

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
