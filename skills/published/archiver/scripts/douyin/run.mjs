/**
 * run.mjs — the whole Douyin run: what the user asked for, in, and one document out.
 *
 *   --login  sign in once, in a browser, and stop.
 *   --plan   collect, diff, report. Downloads nothing.
 *   --go     download exactly what the last plan listed.
 *   --yes    both, without stopping to confirm.
 *
 * All of the orchestration is here rather than in shell, and belongs here. A
 * shell function called under `||` runs with errexit off for its whole body, so
 * a refused plan prints its refusal and then keeps going — through the state
 * write and a summary telling the user to re-run the command that just failed.
 *
 * Every command answers with a single JSON document on stdout, composed by
 * `shared/output.mjs`. The scrolling chatter of a long collection goes to
 * stderr, where it cannot land in the middle of what is being parsed.
 */
import path from 'node:path';

import { EXIT } from '../shared/exit.mjs';
import { Refusal, refusalFields } from '../shared/errors.mjs';
import {
  accountFields,
  answer,
  archiveCounts,
  archiveResult,
  commandFor,
  nothingFetched,
  planWindow,
  progress,
  quote,
  refuse,
  runCounts,
  self,
  sharedNotes,
} from '../shared/output.mjs';
import { pickMode } from '../shared/run.mjs';
import { hatchToolMissing, onPath } from '../shared/tools.mjs';
import {
  COMMON_BOOLEAN_FLAGS,
  COMMON_FLAGS,
  isMainModule,
  missingValueRefusal,
  optString,
  parseCommandLine,
} from '../shared/cli.mjs';
import {
  accountDirFor,
  aliasDirFor,
  aliasShapeRefusal,
  aliasTarget,
  applyAlias,
  checkAlias,
  clearAlias,
  findAccountDir,
  isSafeAlias,
  readAccount,
  recordIdentity,
  resolveAccountDir,
} from '../shared/account.mjs';
import { checkRoot, stampRoot } from '../shared/archiver.mjs';
import { ensureEnv } from '../shared/env.mjs';
import { collect } from './collect.mjs';
import { fetchPosts, outstanding } from './fetch.mjs';
import { onDiskIds, readArchive, shadowedFolders, unlistedIds } from '../shared/landed.mjs';
import { login } from './login.mjs';
import { archivesRoot, cookieFile, normalizeRoot, toolPath } from '../shared/paths.mjs';
import { PLATFORM, PROFILE_DIR, discardDerivedState, loadPlaywright } from './playwright.mjs';
import { descriptorFor, postIdKeyFor } from '../shared/platforms.mjs';
import {
  DEFAULT_TTL_HOURS,
  approved,
  buildPlan,
  listedIds,
  planRefusal,
  unlistedCountFromPlan,
  validatePlan,
} from '../shared/plan.mjs';
import { notes } from './notes.mjs';
import { discardCookies, hasFreshCookies, mintCookies, profileHasSession } from './session.mjs';
import { clearPlan, loadPlan, previousRoot, recordRun, savePlan } from '../shared/sync.mjs';
import { parseTarget } from './target.mjs';

const ACCOUNT = descriptorFor(PLATFORM);
const POST_ID_KEY = postIdKeyFor(PLATFORM);
const COOKIE_FILE = cookieFile(PLATFORM);

/** What Douyin adds to the flags every platform shares. */
const BOOLEAN_FLAGS = new Set([...COMMON_BOOLEAN_FLAGS, 'login']);
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
      --profile DIR     Browser profile holding the Douyin session.
  -h, --help            Show this help

Every command but this one answers with a single JSON document on stdout;
progress goes to stderr.

Image posts (图文) are counted and reported, but not yet downloaded:
https://github.com/luojiahai/skills/issues/48`;

/**
 * `deps` names everything this run reaches outside itself. Injected so the
 * orchestration — what is written, in what order, and what is refused before
 * anything is written at all — is testable without a browser, a network or
 * yt-dlp on the machine running the tests.
 */
export async function main(argv, deps = {}) {
  const {
    collectImpl = collect,
    fetchImpl = fetchPosts,
    loginImpl = login,
    playwrightImpl = loadPlaywright,
    hasSessionImpl = profileHasSession,
    mintImpl = mintCookies,
    onPathImpl = onPath,
    ensureEnvImpl = ensureEnv,
    discardImpl = discardDerivedState,
    freshCookiesImpl = hasFreshCookies,
    discardCookiesImpl = discardCookies,
  } = deps;

  const { opts, positional, unknown, missing } = parseCommandLine(argv, {
    booleans: BOOLEAN_FLAGS,
    known: KNOWN_FLAGS,
  });

  if (opts.help || opts.h) {
    console.log(USAGE);
    return EXIT.OK;
  }

  // What the command line asked for, settled before the first refusal so every
  // document says which command was being run when it stopped.
  const command = opts.login === true ? 'login' : pickMode(opts);
  const refuseHere = (fields) => refuse({ command, platform: PLATFORM, ...fields });

  // Before the unknown-flag check, so `--alias -foo` names the flag the user
  // mistyped rather than the value it swallowed. Refused rather than run as if it
  // had not been typed, which would archive the account under its id and report
  // that as a success.
  if (missing.length) return refuseHere(refusalFields(missingValueRefusal(missing[0])));

  // Whatever the user typed is passed through as given, so an unknown flag is
  // their typo to see rather than something for the agent to guess at.
  if (unknown.length) {
    return refuseHere({
      code: 'unknown-flag',
      message: `unknown option '${unknown[0]}'`,
      details: { flag: unknown[0] },
    });
  }

  const url = positional[0];
  if (!url) {
    console.error(USAGE);
    return refuseHere({ code: 'no-url', message: 'no URL given' });
  }

  // Settled before the archives root, before the preflight, before anything is
  // read or written, because refusing a URL needs nothing installed.
  let target;
  try {
    target = parseTarget(url);
  } catch (error) {
    return refuseHere(refusalFields(error));
  }

  const profileDir = optString(opts, 'profile') || PROFILE_DIR;

  // The state directory holds what must survive the skill being replaced, and a
  // dependency tree is not that. Cleared before the build rather than after, so
  // a machine that declines the download or has no network is not left carrying
  // a hundred megabytes it will never read again.
  await discardImpl();

  // The tools this platform runs on, built before the first one is reached and
  // never at dispatch — a mistyped flag and a refusable URL have both already
  // been answered above, without a byte being downloaded. Signing in needs the
  // browser and nothing else; everything else needs yt-dlp too.
  try {
    await ensureEnvImpl(
      command === 'login' ? ['runtime', 'browser'] : ['runtime', 'tools', 'browser'],
      { platform: PLATFORM },
    );
  } catch (error) {
    return refuseHere(refusalFields(error));
  }

  // Playwright drives the browser for both signing in and collecting, so it is
  // needed on every path past here.
  let chromium;
  try {
    ({ chromium } = await playwrightImpl());
  } catch (error) {
    return refuseHere(refusalFields(error));
  }

  if (command === 'login') {
    const outcome = await loginImpl({ url: target.url, profileDir, launch: chromium });
    if (outcome.ok) return answer({ command, platform: PLATFORM, result: { profile_dir: profileDir } });
    return refuseHere({
      code: outcome.code,
      message: `${outcome.reason} — nothing was archived`,
      details: outcome.details ?? null,
      remedy: { message: 'sign in to Douyin in the browser this opens, and say when it is done', run_by: 'user' },
    });
  }

  // Answers only under the escape hatch, where the machine's own yt-dlp is being
  // used and can simply not be there. Off it the box holds yt-dlp, and a box
  // that could not be built has already refused above.
  const noYtDlp = await hatchToolMissing(
    toolPath('yt-dlp'),
    { install: 'uv tool install yt-dlp', docs: 'https://github.com/yt-dlp/yt-dlp#installation' },
    onPathImpl,
  );
  if (noYtDlp) return refuseHere(refusalFields(noYtDlp));

  const alias = optString(opts, 'alias');
  const unalias = opts.unalias === true;

  if (alias && unalias) {
    return refuseHere({
      code: 'alias-and-unalias',
      message: '--alias and --unalias ask for opposite things',
    });
  }

  // The shape of an alias needs no filesystem and no browser, so a typo is
  // refused here rather than after a full profile scroll.
  if (alias && !isSafeAlias(alias)) return refuseHere(refusalFields(aliasShapeRefusal(alias)));

  let root;
  try {
    const given = optString(opts, 'archives');
    root = given ? normalizeRoot(given) : archivesRoot();
  } catch (error) {
    return refuseHere(refusalFields(error));
  }

  // Before the session, before the first request, before anything is written:
  // an archive this build cannot read must cost nothing to discover. With no
  // old-layout detection behind it, this refusal is the only thing standing
  // between a version mismatch and a silent full re-download.
  try {
    await checkRoot(root);
  } catch (error) {
    return refuseHere(refusalFields(error));
  }

  // Everything an alias can be refused for except "it is already yours" needs
  // only the archives root, so it is decided before the browser opens. The
  // sec_uid is in the URL, so this run always knows whose account it is.
  if (alias) {
    // No handle: the URL carries a sec_uid, and the 抖音号 only arrives with the
    // listing. The alias and the URL are what can be matched before then.
    const existing = await findAccountDir(ACCOUNT, root, { url: target.url, alias });
    const verdict = await checkAlias(ACCOUNT, root, {
      id: existing ? ((await readAccount(existing))?.account?.id ?? null) : target.secUid,
      alias,
    });
    if (!verdict.ok) return refuseHere(refusalFields(verdict.refusal));
  }

  // A cookie in the profile proves a sign-in happened. It does not prove Douyin
  // still accepts it — an expired-but-present session is caught later, by a grid
  // that renders nothing — but its absence is knowable now, and turns a
  // confusing half-minute into an instant, correct answer.
  //
  // A live cookies.txt answers it without opening anything, which is the whole
  // point of caching the file: reading the profile means launching Chromium, and
  // a --go that did that would be paying the cost of having no cache at all.
  const cached = await freshCookiesImpl(COOKIE_FILE);
  if (!cached && !(await hasSessionImpl(profileDir, { launch: chromium }))) {
    return refuseHere({
      code: 'session-missing',
      message: `no Douyin session in ${profileDir}`,
      details: { profile_dir: profileDir },
      remedy: loginRemedy(url),
    });
  }

  const planCommand = commandFor(argv, 'plan');

  // Guarded like doPlan below it. Inside, mintCookies raises `session-empty` and
  // launchPersistentContext throws on a locked or corrupt profile — and an
  // unguarded throw reaches the dispatcher as `internal-error` with a stack,
  // where the user should have been handed the code and its remedy.
  if (command === 'go') {
    try {
      return await doGo({
        command, root, target, alias, unalias, profileDir, chromium, planCommand, fetchImpl, mintImpl,
        freshImpl: freshCookiesImpl, discardImpl: discardCookiesImpl,
      });
    } catch (error) {
      return refuseHere(refusalFields(error));
    }
  }

  let planned;
  try {
    planned = await doPlan({ root, target, alias, unalias, profileDir, chromium, collectImpl });
  } catch (error) {
    return refuseHere(refusalFields(error));
  }

  const described = (extra) =>
    archiveResult({
      account: accountFields(ACCOUNT, planned.plan.account, target.url),
      dir: planned.accountDir,
      root,
      counts: planned.plan.counts,
      notes: planned.notes,
      plan: planWindow({ createdAt: planned.plan.created_at, ttlHours: DEFAULT_TTL_HOURS }),
      ...extra,
    });

  if (command === 'plan') {
    return answer({ command, platform: PLATFORM, result: described({ nextFor: argv }) });
  }

  if (planned.plan.counts.to_fetch === 0) {
    return answer({
      command,
      platform: PLATFORM,
      result: described({ run: nothingFetched(planned.plan.counts) }),
    });
  }

  try {
    return await doGo({
      command, root, target, alias, unalias, profileDir, chromium, planCommand, fetchImpl, mintImpl,
      freshImpl: freshCookiesImpl, discardImpl: discardCookiesImpl,
      // A --yes has just announced a rename or a moved root; it must still say so
      // now the user is past being asked.
      announced: planned.announced,
      plan: planned.plan,
    });
  } catch (error) {
    return refuseHere(refusalFields(error));
  }
}

/** The one handoff in this skill only a person can complete. */
function loginRemedy(url) {
  return {
    message: "only a human can pass Douyin's login — sign in once in the browser this opens",
    command: `${self()} ${quote(url)} --login`,
    run_by: 'user',
  };
}

/** Collect the account, diff it against disk, park the plan. */
async function doPlan({ root, target, alias, unalias, profileDir, chromium, collectImpl }) {
  progress('[douyin] collecting post IDs…');
  const listing = await collectImpl({
    url: target.url,
    secUid: target.secUid,
    profileDir,
    headless: true,
    launch: chromium,
    log: progress,
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

  // Resolved through the alias map first: an account already archived under an
  // alias has a folder that is not named after its sec_uid, and going straight
  // to the id would quietly start a second, empty archive beside the real one
  // on every aliased account. Nothing resolves for an account never archived,
  // and that is where the folder gets invented.
  const accountDir =
    (await resolveAccountDir(ACCOUNT, root, { id: target.secUid })) ??
    (alias ? aliasDirFor(ACCOUNT, root, alias) : accountDirFor(ACCOUNT, root, target.secUid));

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

  const archive = await readArchive(accountDir);
  const onDisk = await onDiskIds(accountDir);
  const pending = outstanding(listing.posts, archive);

  const listed = listedIds(listing.posts, POST_ID_KEY);
  const unlisted = unlistedIds(listed, onDisk).length;

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
        reported: listing.reported ?? null,
        skipped_image_posts: listing.skippedImagePosts ?? 0,
        unlisted,
      },
    }),
    notes: notes({
      collected: listing.posts.length,
      reported: listing.reported,
      reportedRounded: listing.reportedRounded,
      skipped: listing.skippedImagePosts,
      unlisted,
      truncated: listing.hitRoundLimit,
      unattributed: listing.unattributed,
      duplicates: shadowedFolders(archive),
    }),
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
  const announced = sharedNotes({
    dir: accountDir,
    movingTo: aliasTarget(ACCOUNT, root, { id: target.secUid, alias, unalias }),
    root,
    previousRoot: lastRoot,
  });

  return { plan, accountDir, announced, notes: [...announced, ...plan.notes] };
}

/** Download the plan that was approved. No collection, no browser. */
async function doGo({
  command, root, target, alias, unalias, profileDir, chromium, planCommand, fetchImpl, mintImpl,
  freshImpl, discardImpl, announced = [], plan: made = null,
}) {
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
    accountDir = await moveIfAsked({ root, alias, unalias, secUid: target.secUid, accountDir });
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

  let fetched = 0;
  let failed = 0;
  let undated = 0;
  let stopped = null;
  let sessionStale = false;
  if (!pending.length) {
    progress('[douyin] every post in the plan is already downloaded');
  } else {
    progress(`[douyin] downloading ${pending.length} post(s) to ${path.join(accountDir, 'posts')}…`);
    // The cached file where it is still live, and a browser only where it is
    // not. Minting reads the Playwright profile, which means launching
    // Chromium — the slowest thing in the skill — so minting on every --go is
    // paying the whole cost of having no cache at all.
    const cookies = (await freshImpl(COOKIE_FILE))
      ? COOKIE_FILE
      : await mintImpl(profileDir, COOKIE_FILE, { launch: chromium });
    ({ fetched, failed, undated, stopped, sessionStale } = await fetchImpl({
      accountDir,
      posts: pending,
      cookies,
      refreshCookies: () => mintImpl(profileDir, COOKIE_FILE, { launch: chromium }),
      log: progress,
    }));
  }

  // A session even the re-mint could not rescue is thrown away rather than read
  // back next run, which would fail in exactly the same way forever.
  if (sessionStale || stopped === 'session-rejected') await discardImpl(COOKIE_FILE);

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

  const unlisted = unlistedCountFromPlan(plan, landed, POST_ID_KEY);

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
        // Reported here rather than only on stderr. A run that filed forty posts
        // under `undated_<id>` has said something about the archive, and the
        // agent reading stdout is the one who tells the user.
        undated,
        duplicates: shadowedFolders(currentArchive),
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

async function moveIfAsked({ root, alias, unalias, secUid, accountDir }) {
  if (unalias) return (await clearAlias(ACCOUNT, root, { id: secUid })) ?? accountDir;
  if (alias) return (await applyAlias(ACCOUNT, root, { id: secUid, alias })) ?? accountDir;
  return accountDir;
}

if (isMainModule(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
