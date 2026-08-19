/**
 * run.mjs — the run itself, for whichever platform asked.
 *
 * What the command line meant, the order refusals are reached in, where the
 * account folder is, what `--go` may act on, and the one document it all
 * answers with. A platform brings an adapter and nothing here branches on
 * which one supplied it.
 *
 * There is one listing half and one download half, and every platform goes
 * through both. What differs between them — when the account's id is known, what
 * a listing pass yields, which failures end a run — arrives as hooks the adapter
 * brings. A platform never replaces a stage: a stage replaced is a stage whose
 * order, writes and refusals are that platform's to get right again, and the
 * three of them got it right differently.
 *
 * A refusal's envelope is not here: it goes through `output.mjs`, which owns
 * the document every command answers in.
 */
import { mkdir } from 'node:fs/promises';

import {
  accountDirFor,
  aliasDirFor,
  aliasShapeRefusal,
  aliasTarget,
  checkAlias,
  findAccountDir,
  isSafeAlias,
  isSafeId,
  moveToAlias,
  readAccount,
  recordIdentity,
  resolveAccountDir,
} from './account.mjs';
import { checkRoot, stampRoot } from './archiver.mjs';
import { missingValueRefusal, optString, parseCommandLine } from './cli.mjs';
import { Refusal, refusalFields } from './errors.mjs';
import { EXIT } from './exit.mjs';
import { duplicateFolders, isLanded, landedCount, outstanding, readArchive } from './landed.mjs';
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
} from './output.mjs';
import { archivesRoot, normalizeRoot } from './paths.mjs';
import { DEFAULT_TTL_HOURS, approved, buildPlan, planRefusal, planUnfinished, validatePlan } from './plan.mjs';
import { clearPlan, loadPlan, previousRoot, recordRun, savePlan } from './sync.mjs';

/**
 * `--yes` outranks a `--plan` or `--go` after it on the command line.
 *
 * The skill never reaches for `--yes`; a user who typed it has pre-authorised
 * the run, and the skill appending its own mode flag afterwards must not take
 * that back. Last-one-wins would do exactly that.
 */
export function pickMode(opts) {
  if (opts.yes === true || opts.y === true) return 'yes';
  if (opts.go === true) return 'go';
  return 'plan';
}

/**
 * Whether a re-run may stop once it has recognised enough posts, rather than
 * sweeping the whole account.
 *
 * Three conditions, and the platforms that stop early must answer them the same
 * way: a first run has nothing to recognise, `--full` was asked for the whole
 * account outright, and a plan still parked with posts missing from it is a
 * download that never finished — so the archive may have holes below its newest
 * posts, and a streak of familiar ones at the top proves nothing about what is
 * under them. `planUnfinished` is where that last one is argued.
 *
 * The plan is read last and only when the answer still hangs on it, so a first
 * run and a `--full` cost no extra read.
 */
export async function sweepIsIncremental({ accountDir, accountId, archive, full, postIdKey, root }) {
  if (archive.size === 0 || full) return false;
  return !planUnfinished(await loadPlan(accountDir), { accountId, root, archive, postIdKey });
}

/**
 * The stopping rule: N consecutive posts, in enumeration order, already complete.
 *
 * "Complete" is landed.mjs's one definition, so a post whose media is half here
 * breaks the streak rather than counting toward it — which is what stops a sweep
 * retiring early over posts it would then have had to fetch anyway.
 *
 * Takes a post id, because that is the one thing the three platforms' listing
 * passes hold in common: each spells it differently on its own rows, and each
 * reads its own key on the way in. The threshold is the platform's, defended by
 * its own test against its own reordering.
 */
export function makeStopper({ archive, threshold, enabled }) {
  let consecutive = 0;
  return (postId) => {
    if (!enabled) return false;
    if (isLanded(archive.get(postId))) {
      consecutive += 1;
      return consecutive >= threshold;
    }
    consecutive = 0;
    return false;
  };
}

/**
 * How a run says which of the two it did, so `to_fetch: 0` can be told apart
 * from "gave up before reaching anything new".
 *
 * `stopped_early` is only ever true of an incremental sweep: a full one has
 * nothing to stop early against, and reporting one as having stopped would cast
 * doubt on a listing that is complete.
 *
 * `category` names which listing pass the note is about, and is left off where a
 * platform sweeps a single feed.
 */
export function sweepNote({ incremental, stoppedEarly, threshold, category }) {
  return {
    code: 'sweep',
    mode: incremental ? 'incremental' : 'full',
    stopped_early: Boolean(incremental && stoppedEarly),
    threshold: incremental ? threshold : null,
    ...(category === undefined ? {} : { category }),
  };
}

/** Whether the sweep behind a parked plan stopped early, read back off its notes. */
export function sweepStoppedEarly(notes) {
  return (notes ?? []).some((note) => note.code === 'sweep' && note.stopped_early);
}

/**
 * A platform's adapter with a caller's substitutions laid over it.
 *
 * A member left `undefined` is absent rather than overridden. A test bench
 * builds one bag of fakes for every case in a file and names the member it
 * wants back off; a plain spread would hand the run an `undefined` and fail it
 * somewhere far from the line that asked for the real one.
 *
 * Nothing here knows which members carry behaviour, so a threshold is
 * substituted through the same door as a listing pass.
 */
export function adapterFor(adapter, overrides = {}) {
  const merged = { ...adapter };
  for (const [member, value] of Object.entries(overrides)) {
    if (value !== undefined) merged[member] = value;
  }
  return merged;
}

// ---- the run ----------------------------------------------------------------

/**
 * One account, archived — the whole of it, for whichever platform asked.
 *
 * Everything from here down is what a run decides the same way whoever is being
 * archived: what the command line asked for, the order refusals are reached in,
 * where the account folder is, what `--go` may act on, and the one document it
 * all answers with. What differs arrives as the adapter, and nothing here
 * branches on which platform supplied it.
 *
 * What an adapter owes is specified in `../platforms/README.md`, beside the
 * folders that write them.
 */
export async function runAccount(base, argv, overrides = {}) {
  const adapter = adapterFor(base, overrides);
  const { platform, account: descriptor, usage } = adapter;

  const { opts, positional, unknown, missing } = parseCommandLine(argv, {
    booleans: adapter.booleans,
    known: adapter.flags,
  });

  if (opts.help || opts.h) {
    console.log(usage);
    return EXIT.OK;
  }

  // What the command line asked for, settled before the first refusal so every
  // document says which command was being run when it stopped. A platform's own
  // command — Douyin's `--login` — is declared rather than known here.
  const declared = Object.keys(adapter.commands ?? {}).find((name) => opts[name] === true);
  const command = declared ?? pickMode(opts);
  const refuseHere = (fields) => refuse({ command, platform, ...fields });

  // Before the unknown-flag check, so `--alias -foo` names the flag the user
  // mistyped rather than the value it swallowed. Refused rather than run as if
  // it had not been typed, which would archive the account under its id and
  // report that as a success.
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
    console.error(usage);
    return refuseHere({ code: 'no-url', message: 'no URL given' });
  }

  // Settled before the archives root, before the preflight, before anything is
  // read or written, because refusing a URL needs nothing installed.
  let target;
  try {
    target = adapter.parseTarget(url);
  } catch (error) {
    return refuseHere(refusalFields(error));
  }

  // The tools this run drives, built after the URL because a refusable URL
  // should be refused on any machine, and before the session because reading
  // cookies out of a browser is a real cost to pay for a run that cannot
  // proceed anyway. A platform names only the boxes it needs.
  try {
    await adapter.ensureEnv(adapter.boxes(command), { platform, adapter });
  } catch (error) {
    return refuseHere(refusalFields(error));
  }

  // A command the platform declared and this module knows nothing about. After
  // the environment, because it is the whole reason a login has a browser to
  // open, and before the downloader preflight, which it has no use for.
  if (declared) {
    return await adapter.commands[declared]({ target, opts, argv, refuseHere, adapter });
  }

  const noTool = await adapter.preflight(adapter);
  if (noTool) return refuseHere(refusalFields(noTool));

  const alias = optString(opts, 'alias');
  const unalias = opts.unalias === true;

  if (alias && unalias) {
    return refuseHere({
      code: 'alias-and-unalias',
      message: '--alias and --unalias ask for opposite things',
    });
  }

  // The shape of an alias needs no filesystem and no network, so a typo is
  // refused here rather than after a full crawl. checkAlias reaches the same
  // refusal later — they share it rather than keeping two copies that could
  // come to disagree.
  if (alias && !isSafeAlias(alias)) return refuseHere(refusalFields(aliasShapeRefusal(alias)));

  let root;
  try {
    const given = optString(opts, 'archives');
    root = given ? normalizeRoot(given) : archivesRoot();
  } catch (error) {
    return refuseHere(refusalFields(error));
  }

  // Before the session, before the first request, before anything is written:
  // an archive this build cannot read must cost nothing to discover.
  try {
    await checkRoot(root);
  } catch (error) {
    return refuseHere(refusalFields(error));
  }

  // Everything an alias can be refused for except "it is already yours" needs
  // only the archives root, so it is decided before the session and the first
  // request. The id is whatever can be worked out without a fetch, and null for
  // an account never seen, which cannot collide with itself either way. doPlan
  // asks again once the real id is in hand.
  if (alias) {
    const existing = await findAccountDir(descriptor, root, {
      url: target.url, alias, handle: target.handle,
    });
    const verdict = await checkAlias(descriptor, root, {
      id: existing ? ((await readAccount(existing))?.account?.id ?? null) : (target.id ?? null),
      alias,
    });
    if (!verdict.ok) return refuseHere(refusalFields(verdict.refusal));
  }

  let session;
  try {
    session = await adapter.session({ opts, target, adapter });
  } catch (error) {
    return refuseHere(refusalFields(error));
  }

  const planCommand = commandFor(argv, 'plan');
  const shared = { adapter, root, alias, unalias, session, planCommand, command, opts, target, url: target.url };

  // Guarded like the listing half below. A hook a platform brings can raise a
  // Refusal of its own — Douyin's cookie mint does — and an unguarded throw
  // reaches the dispatcher as `internal-error` with a stack, where the user
  // should have been handed the code and its remedy.
  if (command === 'go') {
    try {
      return await runGo({ ...shared });
    } catch (error) {
      return refuseHere(refusalFields(error));
    }
  }

  let planned;
  try {
    planned = await doPlan({ ...shared, full: opts.full === true });
  } catch (error) {
    const fields = refusalFields(error);
    // The remedy text says the cached session has been thrown away, and leaving
    // the file in place would make that a lie the next run repeats.
    if (fields.code === 'session-rejected') await adapter.discardSession?.();
    return refuseHere(fields);
  }

  // Worked out once and carried through whichever branch answers, so a rename
  // or a moved archives root is reported whether the user is being asked or has
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
      account: accountFields(descriptor, planned.plan.account, target.url),
      dir: planned.accountDir,
      root,
      counts: planned.plan.counts,
      notes,
      plan: planWindow({ createdAt: planned.plan.created_at, ttlHours: DEFAULT_TTL_HOURS }),
      ...extra,
    });

  if (command === 'plan') {
    return answer({ command, platform, result: described({ nextFor: argv }) });
  }

  if (planned.plan.counts.to_fetch === 0) {
    // Nothing to download, but this run was still approved — so the rename it
    // asked for happens, and anything the platform refreshes on every finished
    // run is refreshed.
    let accountDir = planned.accountDir;
    try {
      accountDir = await moveToAlias(descriptor, root, accountDir, {
        id: planned.plan.account?.id, alias, unalias,
      });
      // The other two of the rename's three writes. Moving the folder and
      // stopping leaves account.json naming the folder this run just left and
      // archiver.json caching it — the archive disagreeing with itself until
      // something else happens to write it.
      await recordIdentity(descriptor, root, accountDir, {
        account: planned.plan.account, url: target.url,
      });
    } catch (error) {
      return refuseHere(refusalFields(error));
    }
    await adapter.afterFetch?.(accountDir, planned.plan.account);
    return answer({
      command,
      platform,
      result: described({ run: nothingFetched(planned.plan.counts) }),
    });
  }

  try {
    return await runGo({ ...shared, dir: planned.accountDir, notes, plan: planned.plan });
  } catch (error) {
    return refuseHere(refusalFields(error));
  }
}

/** The download half, and the document it answers with. */
async function runGo(args) {
  return await reportRun(args, args.command, await doGo(args), {
    url: args.url,
    notes: args.notes ?? null,
    plan: args.plan ?? null,
  });
}

/**
 * The listing half: collect the account, diff it against what is on disk, and
 * park the list for `--go`.
 *
 * Throws its refusals rather than composing documents. `runAccount` owns the
 * envelope, so a `--yes` emits exactly one.
 */
async function doPlan({ adapter, root, alias, unalias, session, target, full }) {
  const descriptor = adapter.account;
  const postIdKey = adapter.postIdKey;

  // All settled the moment the first row names the account, because none of
  // them can be known before it: the id itself only arrives with the first row,
  // and the folder is looked up from it.
  let accountDir = null;
  let archive = new Map();
  let incremental = false;
  let badId = null;

  const result = await adapter.collect({
    url: target.url,
    // The whole target as well as its URL, for a platform whose listing needs
    // what the URL was parsed into — Douyin reads the account's id out of it.
    target,
    session,
    // The adapter itself, as `session` and `preflight` are given it, so a
    // platform's listing half can reach its own substitutable members.
    adapter,
    threshold: adapter.threshold,
    // The stopping rule as a factory, called once per listing pass. A platform
    // sweeping one feed calls it once; Instagram calls it per feed, because the
    // two stop independently and a streak in one proves nothing about the other.
    stopper: ({ archive: seen, incremental: on }) =>
      makeStopper({ archive: seen, threshold: adapter.threshold, enabled: on }),
    onAccount: async (account) => {
      // Recorded and stopped rather than thrown: collect() reads this inside
      // its row loop, where a throw would surface as an unexplained stream
      // failure.
      if (!isSafeId(account.id)) {
        badId = String(account.id ?? '');
        return { archive: new Map(), incremental: false, stopNow: true };
      }
      // Resolved, never computed. The folder may be named for an alias, and
      // going straight to the id would quietly start a second, empty archive
      // beside the real one on every aliased account.
      accountDir =
        (await resolveAccountDir(descriptor, root, { id: account.id })) ??
        (alias ? aliasDirFor(descriptor, root, alias) : accountDirFor(descriptor, root, account.id));
      archive = await readArchive(accountDir);
      incremental = await sweepIsIncremental({
        accountDir, accountId: account.id, archive, full, postIdKey, root,
      });
      return { archive, incremental };
    },
  });

  if (badId !== null) throw adapter.refusals.badId(badId);
  if (result.failure) throw adapter.collectRefusal(result.failure, result);

  // Zero posts and no error is a real answer for an account that has posted
  // nothing. It is never reported as "up to date", because an account you are
  // not allowed to read produces exactly the same silence — unless the platform
  // recognises the silence as something it can describe, in which case it
  // declines to refuse and the plan carries the explanation instead.
  if (!result.rows.length) {
    const empty = adapter.refusals.empty(result);
    if (empty) throw empty;
  }

  // Without an id there is no folder to write into. Naming it after the handle
  // instead is not an option: the handle changes, so that folder is one the
  // next run would not find again, and inventing it is worse than stopping.
  const account = result.account;
  if (!account?.id) throw adapter.refusals.unidentified();

  // Checked again now the id is known. The pre-flight check ran before the
  // fetch on whatever identity could be worked out without one, which is enough
  // to catch a typo cheaply but not enough to be the answer — and promising a
  // move that --go would then refuse is worse than stopping here.
  if (alias) {
    const verdict = await checkAlias(descriptor, root, { id: account.id, alias });
    // Nothing has moved: the alias is decided before the plan is written, so a
    // refusal here leaves the archive exactly as it was found.
    if (!verdict.ok) throw verdict.refusal;
  }

  const posts = adapter.groupFiles(result.rows);
  const { counts, toFetch } = adapter.diff(posts, archive, postIdKey);

  const plan = buildPlan({
    account,
    root,
    // The files array is kept rather than reduced to a count: --go re-derives
    // what is still missing from this list, and totals alone could not say
    // which of a post's four images had landed.
    collected: posts,
    pending: toFetch,
    counts: archiveCounts({
      found: counts.foundPosts,
      onDisk: counts.onDiskPosts,
      toFetch: counts.fetchPosts,
      platform: adapter.platformCounts(counts, result),
    }),
    notes: await adapter.planNotes({
      incremental,
      result,
      threshold: adapter.threshold,
      counts,
      accountDir,
    }),
    now: new Date(),
  });

  await mkdir(accountDir, { recursive: true });
  await stampRoot(root);

  // Read before anything is written: the "last run used …" note compares this
  // run's root against the one the previous run recorded, and --go's recordRun
  // below will replace it.
  const lastRoot = await previousRoot(accountDir);

  // Written before the plan, and before anything is downloaded, so a folder
  // that exists always says whose it is — there is no moment where one holds a
  // list of posts and nothing naming the account they belong to. It is also
  // what --go finds the folder by when all it has is the URL, the alias or the
  // handle.
  await recordIdentity(descriptor, root, accountDir, { account, url: target.url });

  await savePlan(accountDir, plan);

  return {
    plan,
    accountDir,
    previousRoot: lastRoot,
    movingTo: aliasTarget(descriptor, root, { id: account.id, alias, unalias }),
  };
}

/**
 * The download half: which posts it hands the fetcher, and when it retires the
 * plan.
 *
 * Returns `{ refusal }` for a plan it will not run, and otherwise everything
 * the finished run has to report. It composes no document itself.
 */
async function doGo({ adapter, root, dir, alias, unalias, url, target, session, planCommand }) {
  const descriptor = adapter.account;
  const postIdKey = adapter.postIdKey;

  // --yes has just enumerated and knows exactly which folder it wrote into, so
  // it passes it in. A bare --go enumerates nothing — so it goes on the id where
  // the platform reads one out of the URL, and otherwise on the alias the user
  // gave it, the URL the plan was written from, and the handle.
  let accountDir =
    dir ??
    (await findAccountDir(descriptor, root, { id: target?.id, url, alias, handle: target?.handle }));
  if (!accountDir) return { refusal: noArchiveRefusal(root, planCommand) };

  // The id validatePlan checks the plan against — an identity check that holds
  // even when the plan's URL names something other than the account.
  const identity = await readAccount(accountDir);
  const account = identity?.account;

  // Read and approved before the folder moves. A plan this run will not act on
  // downloads nothing, so there is no final home to prepare, and a refusal that
  // renamed the archive on its way out would leave the user hunting for a folder
  // this run moved while telling them it did nothing.
  const plan = await loadPlan(accountDir);
  const valid = validatePlan(plan, { root, accountId: account?.id ?? target?.id });
  if (!valid.ok) return { refusal: withPlanRemedy(planRefusal(valid), planCommand) };

  // The rename lands here rather than on --plan, and before the download rather
  // than after, so what is fetched goes straight into its final home.
  try {
    accountDir = await moveToAlias(descriptor, root, accountDir, {
      id: account?.id ?? target?.id, alias, unalias,
    });
  } catch (error) {
    return { refusal: error };
  }

  const archive = await readArchive(accountDir);
  const todo = outstanding(approved(plan), archive, postIdKey);

  // What the folder held before the download, so what it holds afterwards can be
  // reported as a difference rather than as whatever the downloader said it did.
  const before = landedCount(archive);

  const { fetched, failed, stopped, platform } = await adapter.fetch({
    accountDir,
    posts: todo,
    plan,
    session,
    // The adapter itself, as `session` and `preflight` are given it, so a
    // platform's download half can reach its own substitutable members.
    adapter,
    // A long run takes hours. Without a line per post it is silent on stderr
    // for all of them, which is indistinguishable from a hang.
    onPost: ({ post, ok }, done) =>
      progress(adapter.progressLabel({ post, plan, done, total: todo.length, ok }), { progress: ok }),
  });

  await adapter.afterFetch?.(accountDir, plan.account);

  const landed = await readArchive(accountDir);
  const remaining = outstanding(approved(plan), landed, postIdKey).length;

  // Asked of the folder, so a resumed run reports the archive rather than its
  // own increment — and so does what this run added to it. A downloader that
  // exits clean without writing the files has archived nothing, and its own
  // count of what it fetched would have this document report posts landing in a
  // folder that never received them.
  const total = landedCount(landed);
  const downloaded = total - before;

  // One id in two folders leaves one of them answering for nothing, and its
  // media counted by nothing.
  const duplicates = await duplicateFolders(accountDir);

  // After the move, so the alias recorded is the folder this run finished in.
  await recordIdentity(descriptor, root, accountDir, { account: plan.account, url });
  await recordRun(accountDir, {
    root,
    found: plan.counts?.found ?? null,
    landed: downloaded,
    failed,
  });

  // Retired only once every post in it has landed. Kept when a run stops
  // partway, which is what makes the retry fetch only what is missing.
  if (remaining === 0) await clearPlan(accountDir);

  return {
    plan, accountDir, fetched, downloaded, failed, stopped, remaining, total, duplicates,
    // What the archive holds now, and whatever only this platform's
    // downloader knew. Both are read by `runNotes` and by nothing here.
    landed, platform,
  };
}

/**
 * A finished download, as the one document it answers with.
 *
 * A run that stopped partway carries both halves: the posts that landed and the
 * reason it stopped. Collapsing it either way loses something the user needs —
 * a rate-limited run that fetched two hundred posts is neither a success nor a
 * nothing.
 */
async function reportRun({ adapter }, command, outcome, { url = null, notes = null, plan = null } = {}) {
  const platform = adapter.platform;
  if (outcome.refusal) {
    return refuse({ command, platform, ...refusalFields(outcome.refusal) });
  }

  // A --yes has just made this plan and knows what it announced; a bare --go
  // has only what the plan recorded.
  const carried = notes ?? outcome.plan.notes ?? [];

  // Some of what a listing recorded describes the folder rather than the pass,
  // and is worth less the moment the download changes the folder. A platform
  // that has such a note hands back the whole list rewritten — dropping the
  // stale one as well as adding the fresh one, because a document carrying both
  // would carry two notes of the same code disagreeing with each other.
  const reported = (await adapter.runNotes?.({ notes: carried, outcome })) ?? carried;

  const payload = archiveResult({
    account: accountFields(adapter.account, outcome.plan.account, url),
    dir: outcome.accountDir,
    root: outcome.plan.root,
    counts: outcome.plan.counts,
    // The duplicate count is about the folder as it is now, so it is added by
    // the run rather than read back.
    notes: [...reported, ...duplicateNote(outcome.duplicates)],
    // Carried by the run that made the plan, and by that run only. A --go is
    // acting on a list already approved, and its window has done its work.
    plan: plan ? planWindow({ createdAt: plan.created_at, ttlHours: DEFAULT_TTL_HOURS }) : null,
    run: runCounts({
      downloaded: outcome.downloaded,
      // Asked of the folder rather than added to the plan's `on_disk`, which
      // was frozen when the plan was made. A --go that fetched 40 of 100 and
      // was rate-limited leaves the next one reporting 60 for an archive
      // holding 100.
      total: outcome.total,
      failed: outcome.failed,
      remaining: outcome.remaining,
    }),
  });

  if (!outcome.stopped) return answer({ command, platform, result: payload });

  // Discarded here as well as on the plan path. The remedy says the cached
  // session has been thrown away, and leaving the file in place would make that
  // a lie the next run repeats — it would read the same dead token back and
  // stop in exactly the same way, forever.
  if (outcome.stopped === 'session-rejected') await adapter.discardSession?.();

  const known = adapter.failures[outcome.stopped];
  return refuse({
    command,
    platform,
    code: outcome.stopped,
    message: known?.message ?? `the run stopped: ${outcome.stopped}`,
    remedy: known?.remedy ?? null,
    result: payload,
  });
}

function noArchiveRefusal(root, planCommand) {
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

/**
 * One post id found in more than one folder. Only one of them answers for the
 * post, so the other's media is counted by nothing and every figure here is
 * short by however much it holds.
 */
function duplicateNote(count) {
  return count ? [{ code: 'duplicate-posts', count }] : [];
}
