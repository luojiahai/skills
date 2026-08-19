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
 * The listing and download halves are also here rather than shared: the sec_uid
 * is in the URL, so the folder is settled before the browser opens; the counts
 * are against the profile header; and the downloader is yt-dlp. None of that is
 * the shape the two gallery-dl platforms have in common.
 *
 * Every command answers with a single JSON document on stdout, composed by
 * `shared/output.mjs`. The scrolling chatter of a long collection goes to
 * stderr, where it cannot land in the middle of what is being parsed.
 */
import path from 'node:path';

import { EXIT } from '../../shared/exit.mjs';
import { Refusal, refusalFields } from '../../shared/errors.mjs';
import {
  accountFields,
  answer,
  archiveCounts,
  archiveResult,
  planWindow,
  progress,
  quote,
  refuse,
  runCounts,
  self,
} from '../../shared/output.mjs';
import { makeStopper, runAccount, sweepIsIncremental, sweepNote, sweepStoppedEarly } from '../../shared/run.mjs';
import { hatchToolMissing, onPath } from '../../shared/tools.mjs';
import { COMMON_BOOLEAN_FLAGS, COMMON_FLAGS, isMainModule, optString } from '../../shared/cli.mjs';
import {
  accountDirFor,
  aliasDirFor,
  aliasTarget,
  applyAlias,
  checkAlias,
  moveToAlias,
  recordIdentity,
  resolveAccountDir,
} from '../../shared/account.mjs';
import { stampRoot } from '../../shared/archiver.mjs';
import { ensureEnv } from '../../shared/env.mjs';
import { DEFAULT_ABORT, collect } from './collect.mjs';
import { fetchPosts, outstanding } from './fetch.mjs';
import { duplicateFolders, onDiskIds, readArchive, unlistedIds } from '../../shared/landed.mjs';
import { login } from './login.mjs';
import { cookieFile, toolPath } from '../../shared/paths.mjs';
import { PLATFORM, PROFILE_DIR, discardDerivedState, loadPlaywright } from './playwright.mjs';
import { descriptorFor, postIdKeyFor } from '../../shared/platforms.mjs';
import {
  DEFAULT_TTL_HOURS,
  approved,
  buildPlan,
  listedIds,
  planRefusal,
  unlistedCountFromPlan,
  validatePlan,
} from '../../shared/plan.mjs';
import { notes } from './notes.mjs';
import { discardCookies, hasFreshCookies, mintCookies, profileHasSession } from './session.mjs';
import { clearPlan, loadPlan, previousRoot, recordRun, savePlan } from '../../shared/sync.mjs';
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

/** Collect the account, diff it against disk, park the plan. */
async function doPlan({ adapter, root, target, alias, unalias, session, full }) {
  // All settled the moment the listing names the account — which for Douyin is
  // before it opens anything, because the sec_uid is in the URL.
  let accountDir = null;
  let archive = new Map();
  let incremental = false;

  const listing = await adapter.collect({
    url: target.url,
    target,
    session,
    adapter,
    threshold: adapter.threshold,
    stopper: ({ archive: seen, incremental: on }) =>
      makeStopper({ archive: seen, threshold: adapter.threshold, enabled: on }),
    onAccount: async (account) => {
      // Resolved, never computed. The folder may be named for an alias, and
      // going straight to the id would quietly start a second, empty archive
      // beside the real one on every aliased account.
      accountDir =
        (await resolveAccountDir(ACCOUNT, root, { id: account.id })) ??
        (alias ? aliasDirFor(ACCOUNT, root, alias) : accountDirFor(ACCOUNT, root, account.id));
      archive = await readArchive(accountDir);
      incremental = await sweepIsIncremental({
        accountDir,
        accountId: account.id,
        archive,
        full,
        postIdKey: POST_ID_KEY,
        root,
      });
      return { archive, incremental };
    },
  });

  if (listing.failure === 'empty-grid') {
    // A grid that renders nothing while the header still counts posts is not an
    // empty account: it is a session Douyin has stopped accepting. The two are
    // separate codes because only one of them is a handoff to the user.
    if (listing.reported) {
      throw new Refusal(
        'session-expired-grid',
        `the profile reports ${listing.reported} post(s), so the grid exists but did not render — ` +
          'almost certainly an expired session',
        { details: { reported: listing.reported }, remedy: loginRemedy(target.url) },
      );
    }
    throw new Refusal(
      'empty-grid',
      'found 0 posts in the profile grid — an account can genuinely have none, and it also ' +
        'looks like this when the saved session has expired without saying so',
    );
  }

  if (!listing.account?.douyin_id) {
    throw new Refusal(
      'no-douyin-id',
      'the profile was readable but never showed its 抖音号, so there is no identity to file this archive under',
    );
  }

  // Asked again now the 抖音号 is known: the first check could not tell an
  // account's own alias apart from a collision with someone else's.
  if (alias) {
    const verdict = await checkAlias(ACCOUNT, root, { id: target.secUid, alias });
    if (!verdict.ok) throw verdict.refusal;
  }

  // Read before anything is written: the "last run used …" note compares the
  // root this run was given against the one the previous run recorded.
  const lastRoot = await previousRoot(accountDir);

  await stampRoot(root);

  const account = {
    id: target.secUid,
    douyin_id: listing.account.douyin_id,
    nickname: listing.account.nickname,
  };

  // Written at the one point every run passes through once its folder is known,
  // so a folder that exists always says whose it is — before anything has been
  // downloaded into it. The alias is not passed: recordIdentity reads it off the
  // folder's own name, which is what keeps account.json and the directory from
  // disagreeing.
  await recordIdentity(ACCOUNT, root, accountDir, { account, url: target.url });

  const onDisk = await onDiskIds(accountDir);
  const pending = outstanding(listing.posts, archive);

  // A listing that stopped early read the newest posts and no further, so both
  // of these describe a profile it never finished looking at: `reported` would
  // render a deliberately short collection as a catastrophically failed one,
  // and every archived post below the cut would be counted as one the profile
  // no longer lists. Withheld rather than computed against the collected prefix
  // — where the profile's real tail is, is exactly what was skipped.
  const stoppedEarly = Boolean(incremental && listing.stoppedEarly);
  const listed = listedIds(listing.posts, POST_ID_KEY);
  const unlisted = stoppedEarly ? null : unlistedIds(listed, onDisk).length;

  const plan = buildPlan({
    account,
    root,
    collected: listing.posts,
    pending,
    counts: archiveCounts({
      found: listing.posts.length,
      onDisk: onDisk.size,
      toFetch: pending.length,
      // Carried into the plan because the finished run reports them too, and
      // recomputing them there would mean a --go describing an account it never
      // listed.
      platform: {
        reported: stoppedEarly ? null : (listing.reported ?? null),
        skipped_image_posts: listing.skippedImagePosts ?? 0,
        unlisted,
      },
    }),
    notes: [
      // First, because it is what says why the counts beside it are absent —
      // and a --go reads it back out of the plan to withhold them again.
      sweepNote({ incremental, stoppedEarly, threshold: DEFAULT_ABORT }),
      ...notes({
        collected: listing.posts.length,
        reported: listing.reported,
        reportedRounded: listing.reportedRounded,
        skipped: listing.skippedImagePosts,
        unlisted,
        truncated: listing.hitRoundLimit,
        stoppedEarly,
        unattributed: listing.unattributed,
        duplicates: await duplicateFolders(accountDir),
      }),
    ],
    now: new Date(),
  });

  // Parked whether or not anything is pending, which is also what X does. An
  // empty plan is refused as `plan-empty` rather than as `plan-missing`, so
  // "nothing to download" is one code across both platforms instead of two for
  // one situation. It also replaces any plan an earlier run left behind, which
  // would otherwise outlive the work it described.
  await savePlan(accountDir, plan);

  // Facts about this run rather than about the profile, so they are worked out
  // the same way on both platforms and kept apart from the plan's own notes —
  // which a --go recomposes from the numbers, and these cannot be.
  const movingTo = aliasTarget(ACCOUNT, root, { id: target.secUid, alias, unalias });

  return { plan, accountDir, previousRoot: lastRoot, movingTo };
}

/** Download the plan that was approved. No collection, no browser. */
async function doGo({
  adapter, command, root, target, alias, unalias, session, planCommand,
  notes: announced = [], plan: made = null,
}) {
  const { fetch, mint, freshCookies, discardCookies } = adapter;
  const { chromium, profileDir } = session;
  const refuseHere = (fields) => refuse({ command, platform: PLATFORM, ...fields });

  // resolveAccountDir returns a folder only once account.json there names this
  // sec_uid, so a non-null answer *is* the identity check. Falling back to the
  // bare sec_uid path would be the one case that matters: a folder of that name
  // belonging to somebody else, handed to --go to run a plan against.
  let accountDir = await resolveAccountDir(ACCOUNT, root, { id: target.secUid });

  if (!accountDir) {
    return refuseHere({
      code: 'no-archive',
      message: `no folder for this account under ${root}, so there is no plan to run`,
      details: { root },
      remedy: { message: 'collect the account first', command: planCommand, run_by: 'agent' },
    });
  }

  const plan = await loadPlan(accountDir);
  const verdict = validatePlan(plan, { accountId: target.secUid, root });

  if (!verdict.ok) {
    const refusal = planRefusal(verdict);
    return refuseHere({
      ...refusalFields(refusal),
      remedy: { message: 'collect the account again', command: planCommand, run_by: 'agent' },
    });
  }

  // The move happens before the download, so what is fetched goes straight into
  // its final home. A rename between --plan and --go invalidates nothing,
  // because a plan records the archives root and the account, never the folder.
  try {
    accountDir = await moveToAlias(ACCOUNT, root, accountDir, { id: target.secUid, alias, unalias });
  } catch (error) {
    return refuseHere(refusalFields(error));
  }

  // Written immediately after the move, because the move is what makes the
  // records wrong: applyAlias renames and leaves the bookkeeping to the next
  // write, and without one here archiver.json never learns the alias. The folder
  // is then a directory the map does not name — which is how an account's own
  // alias comes to read as another account's id, refusing it forever.
  await recordIdentity(ACCOUNT, root, accountDir, { account: plan.account, url: target.url });

  const archive = await readArchive(accountDir);
  const before = (await onDiskIds(accountDir)).size;

  // Re-checked against disk rather than taken as written. A --go that died
  // partway leaves a plan still listing what it managed to fetch, and every one
  // of those would otherwise cost a request to discover it was already there.
  const pending = outstanding(approved(plan), archive);

  const outcome = await fetch({ accountDir, posts: pending, plan, session, adapter });
  const fetched = outcome.fetched.posts;
  const { failed, stopped } = outcome;
  const undated = outcome.platform?.undated ?? 0;

  // A session even the re-mint could not rescue is thrown away rather than read
  // back next run, which would fail in exactly the same way forever. The fetch
  // discards one the downloader itself gave up on; this is the other way it
  // ends, where every remaining post would have met the same refusal.
  if (stopped === 'session-rejected') await discardCookies(COOKIE_FILE);

  const landed = await onDiskIds(accountDir);
  const total = landed.size;

  // Asked of the folder rather than of the fetcher. A downloader that exits
  // clean without writing the files has archived nothing, and a plan retired on
  // its word would cost a second listing to find that out.
  const currentArchive = await readArchive(accountDir);
  const remaining = outstanding(approved(plan), currentArchive).length;

  await recordRun(accountDir, {
    root,
    found: plan.counts?.found ?? null,
    landed: total - before,
    failed,
  });

  // Kept after a partial run, so a retry re-fetches only what is missing without
  // paying for another collection; retired once it has all landed.
  if (remaining === 0) await clearPlan(accountDir);

  // The plan's own sweep note is what says the listing behind it stopped early,
  // and so is short by design. Recomputing the unlisted count against it here
  // would report most of the archive as no longer on the profile — the same
  // false number the plan withheld, made fresh by the run that acts on it.
  const stoppedEarly = sweepStoppedEarly(plan.notes);
  const unlisted = stoppedEarly ? null : unlistedCountFromPlan(plan, landed, POST_ID_KEY);

  const payload = archiveResult({
    command,
    platform: PLATFORM,
    account: accountFields(ACCOUNT, plan.account, target.url),
    dir: accountDir,
    root,
    counts: {
      ...plan.counts,
      // The unlisted count is recomputed against what is on disk now; the rest
      // describe the listing pass and are as true as when it ran.
      platform: { ...plan.counts?.platform, unlisted },
    },
    notes: [
      // A --yes announced a rename or a moved root before it started, and must
      // still say so now the user is past being asked. A bare --go announced
      // nothing, because it is acting on a list that already did.
      ...announced,
      // The listing's own notes as the plan recorded them, because a --go lists
      // nothing and cannot recompute them: whether the header was abbreviated,
      // whether the scroll was cut short and how many cards went unattributed
      // are all facts about the pass that made this plan. The one exception is
      // the unlisted count, which is about the folder as it is now.
      ...(plan.notes ?? []).filter((note) => note.code !== 'unlisted-posts'),
      ...notes({
        collected: 0,
        reported: null,
        skipped: 0,
        unlisted,
        stoppedEarly,
        // Reported here rather than only on stderr. A run that filed forty posts
        // under `undated_<id>` has said something about the archive, and the
        // agent reading stdout is the one who tells the user.
        undated,
        duplicates: await duplicateFolders(accountDir),
      }),
    ],
    // Carried by the run that made this plan, and by that run only. A --go is
    // acting on a list already approved, and its window has done its work.
    plan: made ? planWindow({ createdAt: made.created_at, ttlHours: DEFAULT_TTL_HOURS }) : null,
    run: runCounts({ downloaded: total - before, total, failed, remaining }),
  });

  // A run that stopped because the next post would have failed the same way
  // carries both halves: what landed, and why it stopped. Collapsing it either
  // way loses something — a rate-limited run that fetched two hundred posts is
  // neither a success nor a nothing.
  if (stopped) {
    const known = FAILURES[stopped];
    return refuse({
      command,
      platform: PLATFORM,
      code: stopped,
      message: known?.message ?? `the run stopped: ${stopped}`,
      remedy: known?.remedy ?? null,
      result: payload,
    });
  }

  return answer({
    command,
    platform: PLATFORM,
    result: payload,
    // A run that lost posts to the downloader still finished as asked. Shell
    // callers read a lost post as a non-zero exit; the posts it lost are in
    // run.failed, and the plan it kept is what makes the retry cheap.
    exit: failed ? EXIT.FAILED : EXIT.OK,
  });
}

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

    return { ...listing, rows: listing.posts ?? [] };
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

  // Douyin resolves its folder before the browser opens — the sec_uid is in the
  // URL — counts against the profile header, and drives yt-dlp rather than
  // gallery-dl. None of that is the shape the two gallery-dl platforms share,
  // so it brings its own halves.
  plan: doPlan,
  go: doGo,
};

export const main = (argv, overrides = {}) => runAccount(ADAPTER, argv, overrides);

if (isMainModule(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
