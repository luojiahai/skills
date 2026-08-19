/**
 * run.mjs — what Douyin brings to a run.
 *
 *   --login  sign in once, in a browser, and stop.
 *   --plan   collect, diff, report. Downloads nothing.
 *   --go     download exactly what the last plan listed.
 *   --yes    both, without stopping to confirm.
 *
 * The run is `shared/run.mjs` — the command line, the refusal order, the
 * folder, the envelope. `--login` is declared here as a command of this
 * platform's own, and the run dispatches it by name without knowing what it is.
 *
 * The run's listing and download halves are the same ones every platform goes
 * through. What is here is where this one differs: the account is known before
 * anything opens, because the sec_uid is in the URL; the counts are against the
 * profile header, and two of them are withheld from a sweep that stopped early;
 * and the downloader is yt-dlp, signed in from cookies minted when the fetch
 * reaches for them.
 *
 * Every command answers with a single JSON document on stdout, composed by
 * `shared/output.mjs`. The scrolling chatter of a long collection goes to
 * stderr, where it cannot land in the middle of what is being parsed.
 */
import path from 'node:path';

import { Refusal } from '../../shared/errors.mjs';
import { answer, progress, quote, self } from '../../shared/output.mjs';
import { runAccount, sweepNote, sweepStoppedEarly } from '../../shared/run.mjs';
import { hatchToolMissing, onPath } from '../../shared/tools.mjs';
import { COMMON_BOOLEAN_FLAGS, COMMON_FLAGS, isMainModule, optString } from '../../shared/cli.mjs';
import { ensureEnv } from '../../shared/env.mjs';
import { DEFAULT_ABORT, collect } from './collect.mjs';
import { fetchPosts, outstanding } from './fetch.mjs';
import { duplicateFolders, landedIds, unlistedIds } from '../../shared/landed.mjs';
import { login } from './login.mjs';
import { cookieFile, toolPath } from '../../shared/paths.mjs';
import { PLATFORM, PROFILE_DIR, discardDerivedState, loadPlaywright } from './playwright.mjs';
import { descriptorFor, postIdKeyFor } from '../../shared/platforms.mjs';
import { listedIds, unlistedCountFromPlan } from '../../shared/plan.mjs';
import { notes } from './notes.mjs';
import { discardCookies, hasFreshCookies, mintCookies, profileHasSession } from './session.mjs';
import { parseTarget } from './target.mjs';

const ACCOUNT = descriptorFor(PLATFORM);
const POST_ID_KEY = postIdKeyFor(PLATFORM);
const COOKIE_FILE = cookieFile(PLATFORM);

/** What Douyin adds to the flags every platform shares. */
const BOOLEAN_FLAGS = new Set([...COMMON_BOOLEAN_FLAGS, 'login', 'full']);
const KNOWN_FLAGS = new Set([...COMMON_FLAGS, ...BOOLEAN_FLAGS, 'profile']);

const USAGE = `Usage: archive.sh <url> [--archives DIR] [--alias NAME] [--plan|--go|--yes]

  <url>                 https://www.douyin.com/user/MS4w...   an account's posts

      --plan            Collect the post list, report what would be fetched, and
                        stop. Downloads nothing, and moves nothing.
      --go              Download the posts the last --plan listed. Needs a plan
                        for this account and root, under a day old.
      --yes, -y         Plan and download in one run, without stopping.
      --login           Sign in to Douyin in a browser, and stop. Only a human
                        can pass Douyin's login; this waits for it and nothing
                        else.
      --archives DIR    Root directory the archives live in.
                        DIR/douyin/<alias> or DIR/douyin/<sec_uid>.
      --alias NAME      Name this account's folder NAME instead of its sec_uid.
      --unalias         Put this account's folder back under its sec_uid.
      --full            Collect the whole profile even when a re-run could stop
                        early.
      --profile DIR     Browser profile holding the Douyin session.
  -h, --help            Show this help

Every command but this one answers with a single JSON document on stdout;
progress goes to stderr.

Image posts (图文) are counted and reported, but not yet downloaded:
https://github.com/luojiahai/skills/issues/48`;

/**
 * The fallback sentence for each stop, and how it is put right.
 *
 * The sentence is what a refusal carries as `message`, which is not what the
 * user is told — `SKILL.md` branches on the code and words the outcome itself.
 */
const FAILURES = {
  'rate-limited': {
    message: 'Douyin rate-limited this run — nothing is broken and nothing is lost',
    remedy: {
      message: 'wait a while, then run the download again; it resumes at the first post still missing',
      run_by: 'agent',
    },
  },
  'session-rejected': {
    message: 'Douyin rejected the session, and the cached cookies have been discarded',
    remedy: {
      message: 'sign in to Douyin again in the browser this opens',
      run_by: 'user',
    },
  },
};


/** The one handoff in this skill only a person can complete. */
function loginRemedy(url) {
  return {
    message: "only a human can pass Douyin's login — sign in once in the browser this opens",
    command: `${self()} ${quote(url)} --login`,
    run_by: 'user',
  };
}

const ADAPTER = {
  platform: PLATFORM,
  account: ACCOUNT,
  postIdKey: POST_ID_KEY,
  usage: USAGE,
  booleans: BOOLEAN_FLAGS,
  flags: KNOWN_FLAGS,
  threshold: DEFAULT_ABORT,
  failures: FAILURES,

  parseTarget,

  /**
   * The listing pass, in the run's own terms.
   *
   * The account is known before anything opens — the sec_uid is in the URL — so
   * the run's account callback fires here, first, and the folder is settled and
   * the archive read before Chromium starts. That is the whole of what makes
   * this platform's listing half different, and the callback already expresses
   * it: the folder is settled the moment the account is known, which for Douyin
   * is straight away.
   *
   * Everything the profile grid reported beyond the posts rides back on the
   * result, where the counts and the notes read it.
   */
  collect: async ({ target, session, onAccount, stopper, adapter }) => {
    const { chromium, profileDir } = session;
    const rule = await onAccount({ id: target.secUid });
    const stop = rule.stopNow ? () => true : stopper(rule);

    progress('[douyin] collecting post IDs…');
    const listing = await adapter.list({
      url: target.url,
      secUid: target.secUid,
      profileDir,
      headless: true,
      launch: chromium,
      log: progress,
      shouldStop: stop,
    });

    // The 抖音号 is what this archive is filed under, and the profile can render
    // without ever showing it. Reported as a failed listing rather than thrown,
    // so it reaches the user through the same door as an empty grid.
    const failure =
      listing.failure ?? (listing.account?.douyin_id ? null : 'no-douyin-id');

    // The URL rides along because the refusals below hand the user a --login
    // command, and a classifier is given the result and nothing else.
    return { ...listing, failure, url: target.url, rows: failure ? [] : (listing.posts ?? []) };
  },

  /**
   * The download half, in the run's own terms.
   *
   * The cookies are minted here rather than with the session, and only where the
   * cached file has gone stale: minting reads the Playwright profile, which
   * means launching Chromium — the slowest thing in the skill — so a --go that
   * minted eagerly would pay the whole cost of having no cache at all.
   *
   * A session even the re-mint could not rescue is thrown away on the way out,
   * rather than read back next run to fail in exactly the same way forever.
   */
  fetch: async ({ accountDir, posts, session, adapter }) => {
    // Nothing to fetch means nothing to sign in for. Minting launches Chromium,
    // and doing it to download an empty list is the whole cost of the session
    // paid for no reason.
    if (!posts.length) {
      progress('[douyin] every post in the plan is already downloaded');
      return { fetched: { posts: 0, files: 0 }, failed: 0, stopped: null, platform: { undated: 0 } };
    }

    const { chromium, profileDir } = session;
    const cookies = (await adapter.freshCookies(COOKIE_FILE))
      ? COOKIE_FILE
      : await adapter.mint(profileDir, COOKIE_FILE, { launch: chromium });

    progress(`[douyin] downloading ${posts.length} post(s) to ${path.join(accountDir, 'posts')}…`);
    const result = await adapter.download({
      accountDir,
      posts,
      cookies,
      refreshCookies: () => adapter.mint(profileDir, COOKIE_FILE, { launch: chromium }),
      log: progress,
    });

    if (result.sessionStale) await adapter.discardCookies(COOKIE_FILE);

    return {
      fetched: { posts: result.fetched, files: result.fetched },
      failed: result.failed,
      stopped: result.stopped,
      // What only this downloader knows. The run carries it to `runNotes`
      // without reading it.
      platform: { undated: result.undated },
    };
  },

  /** The listing pass yields posts already, so there is nothing to group. */
  groupFiles: (rows) => rows,

  /**
   * What is here, what is missing, and what the profile no longer lists.
   *
   * The last of those is Douyin's own: the grid is the account's whole history,
   * so a post on disk that the listing never named has been taken down or hidden
   * since. It is counted here, where the archive is already in hand, and read by
   * `platformCounts` — which decides whether the number is fit to report at all.
   */
  diff: (posts, archive, postIdKey) => {
    const toFetch = outstanding(posts, archive);
    const onDisk = landedIds(archive);
    return {
      counts: {
        foundPosts: posts.length,
        onDiskPosts: onDisk.size,
        fetchPosts: toFetch.length,
        unlisted: unlistedIds(listedIds(posts, postIdKey), onDisk).length,
      },
      toFetch,
    };
  },

  /**
   * Douyin's own numbers, and the two it withholds.
   *
   * A listing that stopped early read the newest posts and no further, so both
   * of these describe a profile it never finished looking at: the profile's
   * reported total would render a deliberately short collection as a
   * catastrophically failed one, and every archived post below the cut would be
   * counted as one the profile no longer lists. Withheld rather than computed
   * against the collected prefix — where the profile's real tail is, is exactly
   * what was skipped.
   */
  platformCounts: (counts, result) => ({
    reported: result.stoppedEarly ? null : (result.reported ?? null),
    skipped_image_posts: result.skippedImagePosts ?? 0,
    unlisted: result.stoppedEarly ? null : counts.unlisted,
  }),

  planNotes: async ({ incremental, result, threshold, counts, accountDir }) => [
    // First, because it is what says why the counts beside it are absent — and a
    // --go reads it back out of the plan to withhold them again.
    sweepNote({ incremental, stoppedEarly: result.stoppedEarly, threshold }),
    ...notes({
      collected: result.rows.length,
      reported: result.reported,
      reportedRounded: result.reportedRounded,
      skipped: result.skippedImagePosts,
      unlisted: result.stoppedEarly ? null : counts.unlisted,
      truncated: result.hitRoundLimit,
      stoppedEarly: result.stoppedEarly,
      unattributed: result.unattributed,
      duplicates: await duplicateFolders(accountDir),
    }),
  ],

  /**
   * The one note a finished run cannot carry over from the plan that made it.
   *
   * Which posts the profile no longer lists is a fact about the folder, and the
   * download has just changed the folder. The plan's own count is dropped rather
   * than kept beside the fresh one, because two notes of the same code
   * disagreeing is worse than either of them alone.
   *
   * Unless the listing behind the plan stopped early — then the count was
   * withheld for a reason that has not gone away, and recomputing it here would
   * make the same false number fresh.
   */
  runNotes: ({ notes: carried, outcome }) => {
    const stoppedEarly = sweepStoppedEarly(outcome.plan.notes);
    const unlisted = stoppedEarly
      ? null
      : unlistedCountFromPlan(outcome.plan, landedIds(outcome.landed), POST_ID_KEY);

    return [
      ...carried.filter((note) => note.code !== 'unlisted-posts'),
      ...notes({
        collected: 0,
        reported: null,
        skipped: 0,
        unlisted,
        stoppedEarly,
        // Reported here rather than only on stderr. A run that filed forty posts
        // under `undated_<id>` has said something about the archive, and the
        // agent reading stdout is the one who tells the user.
        undated: outcome.platform?.undated ?? 0,
        // Counted by the run itself, for every platform, and added after this.
        duplicates: 0,
      }),
    ];
  },

  refusals: {
    badId: (id) =>
      new Refusal(
        'bad-account-id',
        `the URL carried a sec_uid this skill will not use as a folder name: ${JSON.stringify(id)}`,
        { details: { id } },
      ),
    // Never a refusal here. Whether a profile is empty is settled by the listing
    // pass, which can tell an account with no posts apart from a grid that did
    // not render — and an account whose posts are all 图文 has posts this skill
    // cannot download yet rather than none at all, which the plan says in a note.
    empty: () => null,
    unidentified: () =>
      new Refusal(
        'no-douyin-id',
        'the profile was readable but never showed its 抖音号, so there is no identity to file this archive under',
      ),
  },

  /**
   * A listing pass that did not answer, as the refusal the run gives back.
   *
   * A grid that renders nothing while the header still counts posts is not an
   * empty account: it is a session Douyin has stopped accepting. The two are
   * separate codes because only one of them is a handoff to the user.
   */
  collectRefusal: (failure, result) => {
    if (failure === 'no-douyin-id') return ADAPTER.refusals.unidentified();

    if (failure === 'empty-grid' && result?.reported) {
      return new Refusal(
        'session-expired-grid',
        `the profile reports ${result.reported} post(s), so the grid exists but did not render — ` +
          'almost certainly an expired session',
        { details: { reported: result.reported }, remedy: loginRemedy(result.url) },
      );
    }

    if (failure === 'empty-grid') {
      return new Refusal(
        'empty-grid',
        'found 0 posts in the profile grid — an account can genuinely have none, and it also ' +
          'looks like this when the saved session has expired without saying so',
      );
    }

    const known = FAILURES[failure];
    return new Refusal(failure, known?.message ?? `the listing pass failed: ${failure}`, {
      remedy: known?.remedy ?? null,
    });
  },

  /** A session the run itself gave up on, thrown away so the next one mints. */
  discardSession: () => discardCookies(COOKIE_FILE),

  progressLabel: ({ post, done, total, ok }) =>
    ok ? `[douyin] ${done}/${total} — ${post.id}` : `[douyin] failed: ${post.id}`,

  login,
  list: collect,
  download: fetchPosts,
  playwright: loadPlaywright,
  hasSession: profileHasSession,
  mint: mintCookies,
  freshCookies: hasFreshCookies,
  discardCookies,
  discardDerivedState,
  onPath,

  // Signing in needs the browser and nothing else; everything else needs yt-dlp
  // too. Nobody who only archives X ever downloads Chromium, and nobody signing
  // in to Douyin downloads a downloader they will not reach.
  boxes: (command) => (command === 'login' ? ['runtime', 'browser'] : ['runtime', 'tools', 'browser']),

  /**
   * The tool boxes this run needs.
   *
   * The state directory holds what must survive the skill being replaced, and a
   * dependency tree is not that. Cleared before the build rather than after, so
   * a machine that declines the download or has no network is not left carrying
   * a hundred megabytes it will never read again.
   */
  ensureEnv: async (boxes, { platform, adapter }) => {
    await adapter.discardDerivedState();
    await ensureEnv(boxes, { platform });
  },

  // Answers only under the escape hatch, where the machine's own yt-dlp is
  // being used and can simply not be there.
  preflight: (adapter) =>
    hatchToolMissing(
      toolPath('yt-dlp'),
      { install: 'uv tool install yt-dlp', docs: 'https://github.com/yt-dlp/yt-dlp#installation' },
      adapter.onPath,
    ),

  /**
   * Whether there is a session to archive on, and the browser to use it with.
   *
   * A cookie in the profile proves a sign-in happened. It does not prove Douyin
   * still accepts it — an expired-but-present session is caught later, by a grid
   * that renders nothing — but its absence is knowable now, and turns a
   * confusing half-minute into an instant, correct answer.
   *
   * A live cookies.txt answers it without opening anything, which is the whole
   * point of caching the file: reading the profile means launching Chromium,
   * and a --go that did that would be paying the cost of having no cache at all.
   */
  session: async ({ opts, target, adapter }) => {
    const profileDir = optString(opts, 'profile') || PROFILE_DIR;
    // Loaded here rather than with the boxes, so substituting the environment
    // in a test does not silently substitute the browser driver with it.
    const { chromium } = await adapter.playwright();
    const cached = await adapter.freshCookies(COOKIE_FILE);
    if (!cached && !(await adapter.hasSession(profileDir, { launch: chromium }))) {
      throw new Refusal('session-missing', `no Douyin session in ${profileDir}`, {
        details: { profile_dir: profileDir },
        remedy: loginRemedy(target.url),
      });
    }
    return { chromium, profileDir };
  },

  commands: {
    login: async ({ target, opts, refuseHere, adapter }) => {
      const profileDir = optString(opts, 'profile') || PROFILE_DIR;
      const { chromium } = await adapter.playwright();
      const outcome = await adapter.login({ url: target.url, profileDir, launch: chromium });
      if (outcome.ok) {
        return answer({ command: 'login', platform: PLATFORM, result: { profile_dir: profileDir } });
      }
      return refuseHere({
        code: outcome.code,
        message: `${outcome.reason} — nothing was archived`,
        details: outcome.details ?? null,
        remedy: {
          message: 'sign in to Douyin in the browser this opens, and say when it is done',
          run_by: 'user',
        },
      });
    },
  },

};

export const main = (argv, overrides = {}) => runAccount(ADAPTER, argv, overrides);

if (isMainModule(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
