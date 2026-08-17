/**
 * notes.mjs — the three things a Douyin run has to say that an X run does not.
 *
 * Each is a gap between two numbers that would otherwise look like an error, and
 * each leaves here as a code with its count beside it. The sentence belongs to
 * `SKILL.md`: the count of skipped image posts is something the user is told out
 * loud, and a rule keyed off wording is a rule that breaks the next time the
 * wording changes.
 */

/** Issue #48 is what closes the image-post gap; the note carries it so the skill can cite it. */
export const IMAGE_POSTS_ISSUE = 'https://github.com/luojiahai/skills/issues/48';

/** The notes a Douyin run carries, in the order they are worth reading. */
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
  return [{ code: 'hidden-posts', count }];
}

/**
 * Image posts (图文) are collected as a count and nothing else: neither yt-dlp
 * nor gallery-dl can fetch them, so an account's archive is short by however
 * many it has. Reporting the number is what keeps that gap visible rather than
 * silent, until issue #48 closes it.
 */
function images(skipped) {
  if (!skipped) return [];
  return [{ code: 'image-posts-skipped', count: skipped, issue: IMAGE_POSTS_ISSUE }];
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
  return [{ code: 'unlisted-posts', count: unlisted }];
}
