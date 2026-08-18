/**
 * notes.mjs — the things a Douyin run has to say that an X run does not.
 *
 * Each is a gap between two numbers that would otherwise look like an error, and
 * each leaves here as a code with its count beside it. The sentence belongs to
 * `SKILL.md`: the count of skipped image posts is something the user is told out
 * loud, and a rule keyed off wording is a rule that breaks the next time the
 * wording changes.
 *
 * Where a number cannot be trusted the note is *withheld* rather than made more
 * careful. A confident figure that is wrong is worse than an absent one: the
 * agent reads these and tells the user what they say.
 */

/** Issue #48 is what closes the image-post gap; the note carries it so the skill can cite it. */
export const IMAGE_POSTS_ISSUE = 'https://github.com/luojiahai/skills/issues/48';

/** The notes a Douyin run carries, in the order they are worth reading. */
export function notes({
  collected,
  reported,
  reportedRounded = false,
  skipped,
  unlisted,
  truncated = false,
  unattributed = 0,
  undated = 0,
  duplicates = 0,
}) {
  return [
    ...listingTruncated(truncated),
    ...hidden(collected, reported, reportedRounded, skipped),
    ...images(skipped),
    ...missing(unlisted),
    ...unattributedPosts(unattributed),
    ...undatedPosts(undated),
    ...duplicatePosts(duplicates),
  ];
}

/**
 * The scroll loop gave up before the feed did.
 *
 * It stops after a fixed number of rounds, and a listing cut off there is short
 * by an unknown amount — which makes every other figure below it a comparison
 * against a partial list. Said first, because it is the caveat the rest are read
 * under.
 */
function listingTruncated(truncated) {
  if (!truncated) return [];
  return [{ code: 'listing-truncated' }];
}

/**
 * Why the count in the profile header and the number of cards never match.
 *
 * Skipped image posts are subtracted before the gap is reported: they *were*
 * shown in the grid, they are simply not in the collected list, and counting
 * them here as well would blame them twice — once as skipped, once as hidden.
 *
 * A header Douyin abbreviated says nothing at all. `作品 1.2万` is anywhere
 * between 11,500 and 12,499, so the subtraction is out by up to five hundred:
 * an account with 12,345 posts, every one of them collected, would be reported
 * as hiding −345.
 */
function hidden(collected, reported, reportedRounded, skipped) {
  if (reported === null || reported === undefined) return [];
  if (reportedRounded) return [];
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

/**
 * Cards the page rendered that no profile-feed response ever named.
 *
 * They are not collected, because a card outside the account's own grid is
 * somebody else's post and filing one here cannot be undone by running the
 * command again. The count is what tells "this profile shows a recommendation
 * rail" apart from "this run missed feed responses and the listing is short".
 */
function unattributedPosts(unattributed) {
  if (!unattributed) return [];
  return [{ code: 'unattributed-posts', count: unattributed }];
}

/**
 * Posts filed under `undated_<id>` because neither the feed nor yt-dlp would say
 * when they were published. The folder name is the archive's own admission, and
 * this is what makes it visible without anyone having to read a directory
 * listing.
 */
function undatedPosts(undated) {
  if (!undated) return [];
  return [{ code: 'undated-posts', count: undated }];
}

/**
 * One post id in two folders — `undated_5` from an early run and `2024-01-01_5`
 * from a later one. Only one of them can be the archive's answer for that post,
 * so the other's media is counted by nothing, and the figures above are short by
 * however much it holds.
 */
function duplicatePosts(duplicates) {
  if (!duplicates) return [];
  return [{ code: 'duplicate-posts', count: duplicates }];
}
