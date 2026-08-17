/**
 * blocks.mjs — the parts of a block that are Douyin's and nobody else's.
 *
 * The block itself is rendered by `shared/plan.mjs`, which never branches on
 * platform. What differs arrives as text, and this is where that text is
 * written: how this site names an account, and the three things a Douyin run has
 * to say that an X run does not.
 */

/**
 * How Douyin names an account: the nickname if the profile showed one, and the
 * 抖音号 always — it is the identifier a human can read and type, where the
 * sec_uid the folder is named for is not.
 */
export function headline(account) {
  const id = account?.douyin_id ?? '?';
  return account?.nickname ? `${account.nickname} (抖音号 ${id})` : `抖音号 ${id}`;
}

/**
 * The notes a Douyin block carries, in the order they are worth reading.
 *
 * Each is a gap between two numbers that would otherwise look like an error.
 */
export function notes({ collected, reported, skipped, unlisted }) {
  return [...hidden(collected, reported, skipped), ...images(skipped), ...missing(unlisted)];
}

/**
 * Why the count in the profile header and the number of cards never match.
 *
 * Skipped image posts are subtracted before the gap is reported: they *were*
 * shown in the grid, they are simply not in the collected list, and counting
 * them here as well would blame them twice — once as skipped, once as hidden.
 */
function hidden(collected, reported, skipped) {
  if (reported === null || reported === undefined) return [];
  const count = reported - collected - (skipped || 0);
  if (count <= 0) return [];
  return [[`${count} post(s) counted but not shown`, '(private, deleted, or region-locked)']];
}

/**
 * Image posts (图文) are collected as a count and nothing else: neither yt-dlp
 * nor gallery-dl can fetch them, so an account's archive is short by however
 * many it has. Reporting the number is what keeps that gap visible rather than
 * silent, until issue #48 closes it.
 */
function images(skipped) {
  if (!skipped) return [];
  return [
    [
      `${skipped} image post${skipped === 1 ? '' : 's'} skipped — not yet supported`,
      '(see github.com/luojiahai/skills/issues/48)',
    ],
  ];
}

/**
 * Why the archive can outnumber both the collected list and the profile's own
 * count. Only what was observed is claimed: an id on disk and not in the listing
 * reads the same whether the post was deleted, hidden, region-locked or missed
 * by a collection that stopped short, and none of those can be told apart
 * without fetching each one.
 *
 * Unknown — a plan carrying no collected list — is not zero, and says nothing
 * rather than a reassuring nothing.
 */
function missing(unlisted) {
  if (!unlisted) return [];
  return [`${unlisted} archived post${unlisted === 1 ? '' : 's'} no longer on the profile`];
}

/** `405 of 411 reported`, or just the number when the profile showed no count. */
export function foundDetail(reported) {
  return reported === null || reported === undefined ? '' : `of ${reported} reported`;
}
