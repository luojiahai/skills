/**
 * run.mjs — the whole run: what the user asked for, in, and one document out.
 *
 * All of the orchestration lives here rather than in archive.sh, and the same is
 * true of the other platforms. Shell cannot hold this shape safely: a function
 * called under `||` runs with errexit off for its whole body, so a refused plan
 * prints its refusal and then keeps going, through the state write and a summary
 * telling the user to re-run the command that just failed. Shell holds the node
 * preflight and hands over.
 *
 *   --plan   collect, diff, report. Downloads nothing.
 *   --go     download exactly what the last plan listed.
 *   --yes    both, without stopping to confirm.
 *
 * Every one of them answers with a single JSON document on stdout, composed by
 * `shared/output.mjs`. Nothing here writes a sentence for a user — that belongs
 * to `SKILL.md`, which reads this.
 */
import { mkdir } from 'node:fs/promises';

import { duplicateFolders, isLanded, readArchive } from '../../shared/landed.mjs';
import {
  COMMON_BOOLEAN_FLAGS,
  COMMON_FLAGS,
  isMainModule,
  missingValueRefusal,
  optString,
  parseCommandLine,
} from '../../shared/cli.mjs';
import { CATEGORIES, DEFAULT_ABORT, collectFeeds, diff, groupFiles } from './collect.mjs';
import {
  accountDirFor,
  aliasDirFor,
  aliasTarget,
  aliasShapeRefusal,
  applyAlias,
  checkAlias,
  clearAlias,
  findAccountDir,
  isSafeAlias,
  isSafeId,
  readAccount,
  recordIdentity,
  resolveAccountDir,
} from '../../shared/account.mjs';
import { checkRoot, stampRoot } from '../../shared/archiver.mjs';
import { FAILURES } from './gallerydl.mjs';
import { fetchPosts, outstanding } from './fetch.mjs';
import { archivesRoot, normalizeRoot, stateDir, toolPath } from '../../shared/paths.mjs';
import { descriptorFor, labelFor, postIdKeyFor } from '../../shared/platforms.mjs';
import { BROWSERS, discardCookies as discardSession, ensureCookies } from '../../shared/session.mjs';

import { DEFAULT_TTL_HOURS, approved, buildPlan, planRefusal, validatePlan } from '../../shared/plan.mjs';
import { clearPlan, loadPlan, previousRoot, recordRun, savePlan } from '../../shared/sync.mjs';
import { parseTarget, permalink } from './target.mjs';
import { EXIT } from '../../shared/exit.mjs';
import { Refusal, refusalFields } from '../../shared/errors.mjs';
import {
  accountFields,
  answer,
  archiveCounts,
  archiveResult,
  commandFor,
  nothingFetched,
  planWindow,
  progress,
  refuse,
  runCounts,
  sharedNotes,
} from '../../shared/output.mjs';
import { pickMode } from '../../shared/run.mjs';
import { hatchToolMissing, onPath } from '../../shared/tools.mjs';
import { ensureEnv } from '../../shared/env.mjs';

const PLATFORM = 'instagram';
const ACCOUNT = descriptorFor(PLATFORM);
const POST_ID_KEY = postIdKeyFor(PLATFORM);
const STATE_DIR = stateDir(PLATFORM);

/** What a session refusal calls this site, taken from the registry rather than respelled. */
const SESSION = { platform: PLATFORM, label: labelFor(PLATFORM) };

/** What Instagram adds to the flags every platform shares. */
const BOOLEAN_FLAGS = new Set([...COMMON_BOOLEAN_FLAGS, 'full']);
const KNOWN_FLAGS = new Set([...COMMON_FLAGS, ...BOOLEAN_FLAGS, 'browser', 'cookies']);

const USAGE = `Usage: archive.sh <url> [--archives DIR] [--alias NAME] [--plan|--go|--yes]

  <url>                 https://www.instagram.com/<handle>   an account's posts

      --plan            Collect the account, report what would be fetched,
                        and stop. Downloads nothing, and moves nothing.
      --go              Download the posts the last --plan listed. Needs a
                        plan for this account and root, under a day old.
      --yes, -y         Plan and download in one run, without stopping.

      --archives DIR    Root directory the archives live in. The account
                        folder is DIR/instagram/<alias>, or
                        DIR/instagram/<numeric user id> for one with no alias.
      --alias NAME      Name this account's folder NAME instead of its id, so
                        the archive is readable to a person. An existing folder
                        is renamed on the next --go; a new one is created with
                        this name. Recorded in archiver.json against the id,
                        which is what finds the folder again afterwards.
      --unalias         Put this account's folder back under its numeric id.
      --full            Collect the whole profile even when a re-run could
                        stop early.
      --browser NAME    Browser to read the Instagram session from the first
                        time (${BROWSERS.join(', ')}).
      --cookies FILE    Use this cookies.txt instead of a browser or the cache.
  -h, --help            Show this help

Posts and reels are two listing passes, so each can stop early on its own.
Stories, highlights and tagged posts are out of scope.

Every command but this one answers with a single JSON document on stdout;
progress goes to stderr. gallery-dl's own output is buffered rather than
relayed — it is what a failure is classified from.

State lives in the account folder: posts/ holds one folder per post,
account.json the account's identity, and sync.json the list awaiting approval
between --plan and --go. <DIR>/archiver.json records which schema the archive
uses and maps each account's id to its alias. The cached Instagram session is
in ${STATE_DIR}.`;

/**
 * A rejected session is discarded, so the next run reads the browser again.
 *
 * A checkpoint deliberately does not come through here. The cookies are fine
 * and the account is held, so throwing them away would charge the user a
 * Keychain prompt to replace a login that works.
 */
const discardCookies = () => discardSession(PLATFORM);

async function doPlan({
  target, root, alias, unalias, cookies, full, threshold, bin = toolPath('gallery-dl'), collectImpl = collectFeeds,
}) {
  // All settled the moment the first row names the account, because none of them
  // can be known before it: the id itself only arrives with the first row, and
  // the folder is looked up from it.
  let accountDir = null;
  let archive = new Map();
  let incremental = false;
  let badId = null;

  const result = await collectImpl({
    url: target.url,
    cookies,
    bin,
    threshold,
    onAccount: async (account) => {
      // Recorded and stopped rather than thrown: collect() reads this inside its
      // row loop, where a throw would surface as an unexplained stream failure.
      if (!isSafeId(account.id)) {
        badId = String(account.id ?? '');
        return { archive: new Map(), incremental: false, stopNow: true };
      }
      // Resolved, never computed. The folder may be named for an alias, and
      // going straight to the id would quietly start a second, empty archive
      // beside the real one on every aliased account.
      accountDir =
        (await resolveAccountDir(ACCOUNT, root, { id: account.id })) ??
        (alias ? aliasDirFor(ACCOUNT, root, alias) : accountDirFor(ACCOUNT, root, account.id));
      archive = await readArchive(accountDir);
      // A first run has nothing to recognise, so there is nothing to stop at.
      incremental = archive.size > 0 && !full;
      return { archive, incremental };
    },
  });

  if (badId !== null) {
    throw new Refusal(
      'bad-account-id',
      `Instagram reported an account id this skill will not use as a folder name: ${JSON.stringify(badId)}`,
      { details: { id: badId } },
    );
  }

  if (result.failure) throw collectRefusal(result.failure, result.stderr);

  if (!result.rows.length) {
    // Zero posts and no error is a real answer for an account that has posted
    // nothing. It is never reported as "up to date", because an account you are
    // not allowed to read produces exactly the same silence.
    throw new Refusal(
      'empty',
      'found no posts or reels there — an account can genuinely have none, and it also ' +
        'looks like this when the account is private or the saved session has expired without saying so',
    );
  }

  // Without an id there is no folder to write into. Naming it after the handle
  // instead is not an option: the handle changes, so that folder is one the next
  // run would not find again, and inventing it is worse than stopping.
  const account = result.account;
  if (!account?.id) {
    throw new Refusal(
      'unidentified-account',
      'the profile was readable but never named the account, so there is no id to file it under',
    );
  }

  // Checked again now the id is known. The pre-flight check ran before the fetch
  // on whatever identity could be worked out without one, which is enough to
  // catch a typo cheaply but not enough to be the answer — and promising a move
  // that --go would then refuse is worse than stopping here.
  if (alias) {
    const verdict = await checkAlias(ACCOUNT, root, { id: account.id, alias });
    // Nothing has moved: the alias is decided before the plan is written, so a
    // refusal here leaves the archive exactly as it was found.
    if (!verdict.ok) throw verdict.refusal;
  }

  const posts = groupFiles(result.rows);
  const { counts, toFetch } = diff(posts, archive, POST_ID_KEY);

  const plan = buildPlan({
    account,
    root,
    // The files array is kept rather than reduced to a count: --go re-derives
    // what is still missing from this list, and totals alone could not say which
    // of a carousel's four images had landed.
    collected: posts,
    pending: toFetch,
    counts: archiveCounts({
      found: counts.foundPosts,
      onDisk: counts.onDiskPosts,
      toFetch: counts.fetchPosts,
      platform: {
        found_files: counts.foundFiles,
        fetch_files: counts.fetchFiles,
        images: counts.images,
        videos: counts.videos,
        reels: counts.reels,
      },
    }),
    notes: sweepNotes({ incremental, sweeps: result.sweeps, threshold }),
    now: new Date(),
  });

  await mkdir(accountDir, { recursive: true });
  await stampRoot(root);

  // Read before anything is written: the "last run used …" note compares this
  // run's root against the one the previous run recorded, and --go's recordRun
  // below will replace it.
  const lastRoot = await previousRoot(accountDir);

  await savePlan(accountDir, plan);

  // Written now rather than after the download, so a folder that exists always
  // says whose it is. It is also what --go finds the folder by when all it has
  // is the URL, the alias or the handle.
  await recordIdentity(ACCOUNT, root, accountDir, { account, url: target.url });

  return {
    plan,
    accountDir,
    previousRoot: lastRoot,
    movingTo: aliasTarget(ACCOUNT, root, { id: account.id, alias, unalias }),
  };
}

/** What a failed listing pass was, as the refusal the run answers with. */
function collectRefusal(failure, stderr) {
  const known = FAILURES[failure];
  return new Refusal(failure, known?.message ?? `the listing pass failed: ${failure}`, {
    // Carried only where nothing has classified the failure. The tail is the
    // last of gallery-dl's own words, which is all that is left to go on when
    // the classifier recognised nothing.
    details:
      failure === 'collect-failed'
        ? { stderr_tail: stderr?.trim().split('\n').slice(-8).join('\n') ?? '' }
        : null,
    remedy: known?.remedy ?? null,
  });
}

/**
 * The download half: which posts it hands the fetcher, and when it retires the
 * plan.
 *
 * Returns `{ refusal }` for a plan it will not run, and otherwise everything the
 * finished run has to report. It composes no document itself: `main` owns the
 * envelope, so a `--yes` emits exactly one.
 */
async function doGo({
  root, dir, alias, unalias, url, handle, cookies, planCommand,
  bin = toolPath('gallery-dl'), fetchImpl = fetchPosts,
}) {
  // --yes has just enumerated and knows exactly which folder it wrote into, so
  // it passes it in. A bare --go enumerates nothing, never learns the numeric
  // id, and cannot go straight to the folder — the alias the user gave it, the
  // URL the plan was written from, and the handle are the keys that still work.
  let accountDir = dir ?? (await findAccountDir(ACCOUNT, root, { url, alias, handle }));
  if (!accountDir) {
    return { refusal: noArchive(root, planCommand) };
  }

  // Read before the move, because the move is what makes the path stale. This is
  // also the id validatePlan checks the plan against — an identity check that
  // holds even when the plan's URL names something other than the account.
  const identity = await readAccount(accountDir);
  const account = identity?.account;

  // The rename lands here rather than on --plan, and before the download rather
  // than after, so what is fetched goes straight into its final home.
  if (account?.id && (alias || unalias)) {
    try {
      accountDir = unalias
        ? await clearAlias(ACCOUNT, root, { id: account.id })
        : await applyAlias(ACCOUNT, root, { id: account.id, alias });
    } catch (error) {
      return { refusal: error };
    }
  }

  const plan = await loadPlan(accountDir);
  const valid = validatePlan(plan, { root, accountId: account?.id });
  if (!valid.ok) return { refusal: withPlanRemedy(planRefusal(valid), planCommand) };

  const archive = await readArchive(accountDir);
  const todo = outstanding(approved(plan), archive);

  const { fetched, failed, stopped } = await fetchImpl({
    accountDir,
    posts: todo,
    cookies,
    bin,
    // A thousand-post run takes hours. Without a line per post it is silent on
    // stderr for all of them, which is indistinguishable from a hang.
    onPost: ({ post, ok }, done) =>
      progress(
        ok
          ? `[instagram] ${done}/${todo.length} — ${post.shortcode}`
          : `[instagram] failed: ${permalink(post.shortcode)}`,
        { progress: ok },
      ),
  });

  const landed = await readArchive(accountDir);
  const remaining = outstanding(approved(plan), landed).length;

  // Asked of the folder, so a resumed run reports the archive rather than its
  // own increment.
  let total = 0;
  for (const [, entry] of landed) if (isLanded(entry)) total += 1;

  // One id in two folders: a post archived once as `undated_C3x` and later as
  // `2024-01-01_C3x` leaves one of them answering for nothing, and its media
  // counted by nothing.
  const duplicates = await duplicateFolders(accountDir);

  // After the move, so the alias recorded is the folder this run finished in.
  await recordIdentity(ACCOUNT, root, accountDir, { account: plan.account, url });
  await recordRun(accountDir, {
    root,
    found: plan.counts?.found ?? null,
    landed: fetched.posts,
    failed,
  });

  // Retired only once every post in it has landed. Kept when a run stops
  // partway, which is what makes the retry fetch only what is missing.
  if (remaining === 0) await clearPlan(accountDir);

  return { plan, accountDir, fetched, failed, stopped, remaining, total, duplicates };
}

function noArchive(root, planCommand) {
  return new Refusal('no-archive', `no archive under ${root} for this account yet`, {
    details: { root },
    remedy: { message: 'collect the account first', command: planCommand, run_by: 'agent' },
  });
}

/** Every plan refusal has the same remedy, and it is the agent's to run. */
function withPlanRemedy(refusal, planCommand) {
  refusal.remedy = { message: 'collect the account again', command: planCommand, run_by: 'agent' };
  return refusal;
}

export async function main(argv, deps = {}) {
  const {
    collectImpl = collectFeeds,
    fetchImpl = fetchPosts,
    onPathImpl = onPath,
    cookiesImpl = ensureCookies,
    ensureEnvImpl = ensureEnv,
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
  const command = pickMode(opts);
  const refuseHere = (fields) => refuse({ command, platform: PLATFORM, ...fields });

  // Whatever the user typed is passed through as given, so an unknown flag is
  // their typo to see rather than something for the agent to guess at.
  // A flag that takes a value and was given none is refused rather than run as
  // if it had not been typed: `--alias -foo` would otherwise archive the account
  // under its id and report that as a success.
  if (missing.length) return refuseHere(refusalFields(missingValueRefusal(missing[0])));

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

  let target;
  try {
    target = parseTarget(url);
  } catch (error) {
    return refuseHere(refusalFields(error));
  }

  // gallery-dl both enumerates and downloads, so nothing past here works without
  // it. Built after the URL because a refusable URL should be refused on any
  // machine — and before the session, because reading cookies out of a browser
  // is a real cost to pay for a run that cannot proceed anyway. Instagram needs
  // no browser box: nothing here drives a page.
  try {
    await ensureEnvImpl(['runtime', 'tools'], { platform: PLATFORM });
  } catch (error) {
    return refuseHere(refusalFields(error));
  }

  // Answers only under the escape hatch, where the machine's own gallery-dl is
  // being used and can simply not be there. Off it the box holds gallery-dl, and
  // a box that could not be built has already refused above.
  const noGalleryDl = await hatchToolMissing(
    toolPath('gallery-dl'),
    { install: 'uv tool install gallery-dl', docs: 'https://github.com/mikf/gallery-dl#installation' },
    onPathImpl,
  );
  if (noGalleryDl) return refuseHere(refusalFields(noGalleryDl));

  const browser = optString(opts, 'browser');
  const full = opts.full === true;
  const alias = optString(opts, 'alias');
  const unalias = opts.unalias === true;

  if (alias && unalias) {
    return refuseHere({
      code: 'alias-and-unalias',
      message: '--alias and --unalias ask for opposite things',
    });
  }

  // The shape of an alias needs no filesystem and no network, so a typo is
  // refused here rather than after a full profile crawl. checkAlias reaches the
  // same refusal later — they share it rather than keeping two copies that could
  // come to disagree.
  if (alias && !isSafeAlias(alias)) return refuseHere(refusalFields(aliasShapeRefusal(alias)));

  let root;
  try {
    const given = optString(opts, 'archives');
    root = given ? normalizeRoot(given) : archivesRoot();
  } catch (error) {
    return refuseHere(refusalFields(error));
  }

  // Before the session, before the first API call, before anything is written:
  // an archive this build cannot read must cost nothing to discover.
  try {
    await checkRoot(root);
  } catch (error) {
    return refuseHere(refusalFields(error));
  }

  // Everything an alias can be refused for except "it is already yours" needs
  // only the archives root, so it is decided before the session and the first
  // API call. The id is whatever can be worked out without a fetch — an account
  // already archived under this alias, URL or handle — and null for one that has
  // never been seen, which cannot collide with itself either way. doPlan asks
  // again once the real id is in hand.
  if (alias) {
    const existing = await findAccountDir(ACCOUNT, root, { url: target.url, alias, handle: target.handle });
    const verdict = await checkAlias(ACCOUNT, root, {
      id: existing ? ((await readAccount(existing))?.account?.id ?? null) : null,
      alias,
    });
    if (!verdict.ok) return refuseHere(refusalFields(verdict.refusal));
  }

  let cookies;
  try {
    cookies = await cookiesImpl(SESSION, {
      cookies: optString(opts, 'cookies'),
      browser,
      url: target.url,
      bin: toolPath('gallery-dl'),
    });
  } catch (error) {
    return refuseHere(refusalFields(error));
  }

  const planCommand = commandFor(argv, 'plan');

  if (command === 'go') {
    return await report(
      command,
      await doGo({
        root, url: target.url, alias, unalias, handle: target.handle, cookies, planCommand, fetchImpl,
      }),
      { url: target.url },
    );
  }

  let planned;
  try {
    planned = await doPlan({
      target, root, alias, unalias, cookies, full, threshold: DEFAULT_ABORT, collectImpl,
    });
  } catch (error) {
    const fields = refusalFields(error);
    // The remedy text says the cached session has been thrown away, and leaving
    // the file in place would make that a lie the next run repeats. A checkpoint
    // is deliberately not in this branch: that session still works.
    if (fields.code === 'session-rejected') await discardCookies();
    return refuseHere(fields);
  }

  // Worked out once and carried through whichever branch answers, so a rename or
  // a moved archives root is reported whether the user is being asked or has
  // already said yes.
  const notes = [
    ...sharedNotes({
      dir: planned.accountDir,
      movingTo: planned.movingTo,
      root,
      previousRoot: planned.previousRoot,
    }),
    ...planned.plan.notes,
  ];

  const described = (extra) =>
    archiveResult({
      account: accountFields(ACCOUNT, planned.plan.account, target.url),
      dir: planned.accountDir,
      root,
      counts: planned.plan.counts,
      notes,
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

  return await report(
    command,
    await doGo({
      root, dir: planned.accountDir, alias, unalias, url: target.url, handle: target.handle,
      cookies, planCommand, fetchImpl,
    }),
    { url: target.url, notes, plan: planned.plan },
  );
}

/**
 * A finished download, as the one document it answers with.
 *
 * A run that stopped partway carries both halves: the posts that landed and the
 * reason it stopped. Collapsing it either way loses something the user needs — a
 * rate-limited run that fetched two hundred posts is neither a success nor a
 * nothing.
 */
async function report(command, outcome, { url = null, notes = null, plan = null } = {}) {
  if (outcome.refusal) {
    return refuse({ command, platform: PLATFORM, ...refusalFields(outcome.refusal) });
  }

  const payload = archiveResult({
    account: accountFields(ACCOUNT, outcome.plan.account, url),
    dir: outcome.accountDir,
    root: outcome.plan.root,
    counts: outcome.plan.counts,
    // A --yes has just made this plan and knows what it announced; a bare --go
    // has only what the plan recorded. The duplicate count is about the folder
    // as it is now, so it is added by the run rather than read back.
    notes: [...(notes ?? outcome.plan.notes ?? []), ...duplicateNote(outcome.duplicates)],
    // Carried by the run that made the plan, and by that run only. A --go is
    // acting on a list already approved, and its window has done its work.
    plan: plan ? planWindow({ createdAt: plan.created_at, ttlHours: DEFAULT_TTL_HOURS }) : null,
    run: runCounts({
      downloaded: outcome.fetched.posts,
      // Asked of the folder rather than added to the plan's `on_disk`, which was
      // frozen when the plan was made. A --go that fetched 40 of 100 and was
      // rate-limited leaves the next one reporting 60 for an archive holding 100.
      total: outcome.total,
      failed: outcome.failed,
      remaining: outcome.remaining,
    }),
  });

  if (!outcome.stopped) return answer({ command, platform: PLATFORM, result: payload });

  // Discarded here as well as on the plan path. The remedy says the cached
  // session has been thrown away, and leaving the file in place would make that
  // a lie the next run repeats — it would read the same dead token back and stop
  // in exactly the same way, forever.
  if (outcome.stopped === 'session-rejected') await discardCookies();

  const known = FAILURES[outcome.stopped];
  return refuse({
    command,
    platform: PLATFORM,
    code: outcome.stopped,
    message: known?.message ?? `the run stopped: ${outcome.stopped}`,
    remedy: known?.remedy ?? null,
    result: payload,
  });
}

/**
 * One post id found in more than one folder. Only one of them answers for the
 * post, so the other's media is counted by nothing and every figure here is
 * short by however much it holds.
 */
function duplicateNote(count) {
  return count ? [{ code: 'duplicate-posts', count }] : [];
}

/**
 * One note per listing pass: whether that feed reached the end of the profile
 * or stopped early.
 *
 * Per pass rather than merged, because the two stop independently. A single
 * `stopped_early` covering both would say the sweep may be short without saying
 * short of what — and "I have all your posts but stopped partway through your
 * reels" is exactly the sentence the user needs and a merged flag cannot make.
 */
function sweepNotes({ incremental, sweeps, threshold }) {
  return (sweeps?.length ? sweeps : CATEGORIES.map((category) => ({ category, stoppedEarly: false }))).map(
    ({ category, stoppedEarly }) => ({
      code: 'sweep',
      mode: incremental ? 'incremental' : 'full',
      stopped_early: Boolean(incremental && stoppedEarly),
      threshold: incremental ? threshold : null,
      category,
    }),
  );
}

if (isMainModule(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
