/**
 * run.mjs — the whole run: what the user asked for, in, and a block out.
 *
 * All of the orchestration lives here rather than in archive.sh. The sibling
 * skill records what the alternative costs: a shell function called under `||`
 * runs with errexit off, and a refused plan there printed its refusal and then
 * kept going, through the state write and a summary telling the user to re-run
 * the command that had just failed. Shell holds the preflight and hands over.
 *
 *   --plan   enumerate, diff, report. Downloads nothing.
 *   --go     download exactly what the last plan listed.
 *   --yes    both, without stopping to confirm.
 */
import { access, constants, chmod, mkdir, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';

import { readArchive } from './landed.mjs';
import { isMainModule, optString, parseCommandLine } from './cli.mjs';
import { DEFAULT_ABORT, collect, makeStopper } from './collect.mjs';
import {
  accountDirFor,
  aliasDirFor,
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
} from './account.mjs';
import { checkRoot, stampRoot } from './archiver.mjs';
import { saveProfileAssets } from './assets.mjs';
import { REMEDIES, cookieExportArgs } from './gallerydl.mjs';
import { fetchPosts, outstanding } from './fetch.mjs';
import { COOKIE_FILE, STATE_DIR, archivesRoot, normalizeRoot } from './paths.mjs';
import {
  diff,
  groupFiles,
  renderPlanBlock,
  renderSummaryBlock,
  validatePlan,
} from './plan.mjs';
import { clearPlan, loadPlan, previousRoot, recordRun, savePlan } from './sync.mjs';
import { parseTarget } from './target.mjs';

const EXIT = { OK: 0, USAGE: 2, REFUSED: 3, FAILED: 4, UNAUTHORIZED: 5, EMPTY: 6 };

const USAGE = `Usage: archive.sh <url> [--archives DIR] [--alias NAME] [--plan|--go|--yes]

  <url>                 https://x.com/<handle>              an account's media

      --plan            Enumerate the account, report what would be fetched,
                        and stop. Downloads nothing, and moves nothing.
      --go              Download the posts the last --plan listed. Needs a
                        plan for this account and root, under a day old.
      --yes, -y         Plan and download in one run, without stopping.

      --archives DIR    Root directory the archives live in. The account
                        folder is DIR/x/<alias>, or DIR/x/<numeric user id>
                        for an account that has no alias.
      --alias NAME      Name this account's folder NAME instead of its id, so
                        the archive is readable to a person. An existing folder
                        is renamed on the next --go; a new one is created with
                        this name. Recorded in archiver.json against the id,
                        which is what finds the folder again afterwards.
      --unalias         Put this account's folder back under its numeric id.
      --full            Enumerate the whole timeline even when a re-run could
                        stop early.
      --browser NAME    Browser to read the X session from the first time
                        (chrome, firefox, safari, edge, brave, chromium...).
      --cookies FILE    Use this cookies.txt instead of a browser or the cache.
  -h, --help            Show this help

State lives in the account folder: posts/ holds one folder per post,
account.json the account's identity, assets/ the current avatar and banner, and
sync.json the list awaiting approval between --plan and --go. <DIR>/archiver.json
records which schema the archive uses and maps each account's id to its alias.
The cached X session is in ${STATE_DIR}.`;

function fail(message, code = EXIT.FAILED) {
  console.error(`error: ${message}`);
  return code;
}

/**
 * The session, as a cookies.txt path.
 *
 * Preferring the cache to the live browser is not an optimisation. Reading a
 * browser profile prompts for Keychain access on macOS and wants the browser
 * closed, and a plan and a go would each pay it — twice per download is the
 * friction that makes people paste a raw token instead.
 */
async function ensureCookies({ cookies, browser, url, bin = 'gallery-dl' }) {
  if (cookies) return cookies;

  try {
    await access(COOKIE_FILE, constants.R_OK);
    return COOKIE_FILE;
  } catch {
    // No cache yet — fall through and make one.
  }

  if (!browser) {
    throw new Error(
      'no saved X session yet, and no browser to read one from.\n' +
        '  Sign in to X in a browser, then add --browser NAME to this command\n' +
        '  (chrome, firefox, safari, edge, brave, chromium, opera, vivaldi).\n' +
        '  Or point at an exported session with --cookies FILE.',
    );
  }

  await mkdir(STATE_DIR, { recursive: true });
  const code = await new Promise((resolve) => {
    const child = spawn(bin, cookieExportArgs({ browser, cookies: COOKIE_FILE, url }), {
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    child.on('close', resolve);
    child.on('error', () => resolve(-1));
  });

  if (code !== 0) {
    throw new Error(
      `could not read an X session from ${browser}.\n` +
        '  Close that browser and try again, or sign in to X in it first.',
    );
  }

  // It is a live session token sitting in a file; nobody else on this machine
  // needs to be able to read it.
  await chmod(COOKIE_FILE, 0o600).catch(() => {});
  return COOKIE_FILE;
}

/** A rejected session is discarded, so the next run reads the browser again. */
async function discardCookies() {
  await rm(COOKIE_FILE, { force: true });
}

/**
 * Where `--alias`/`--unalias` would put this account's folder, or null when
 * neither was asked for.
 *
 * Only ever *computed* here. The move itself belongs to `--go`: a `--plan` that
 * silently reorganised the archive would be a preview that lied, and a rename
 * between the two invalidates nothing, because a plan records the archives root
 * and the account — never the folder it is sitting in.
 */
function aliasTarget(root, { id, alias, unalias }) {
  if (unalias) return accountDirFor(root, id);
  return alias ? aliasDirFor(root, alias) : null;
}

/**
 * The account's current look, refreshed on every run that downloads.
 *
 * Not on `--plan`, which fetches nothing by definition — but on every run past
 * that, including a `--yes` against an account with no new posts, because
 * `assets/` is the account as it is *now* rather than as it was when it last
 * posted. Two CDN requests, and a failure is swallowed: an avatar must not end
 * a run that has just fetched an account's history.
 */
function refreshAssets(accountDir, account) {
  return saveProfileAssets(accountDir, { avatar: account?.avatar, banner: account?.banner });
}

async function doPlan({ target, root, alias, unalias, cookies, full, threshold, bin = 'gallery-dl' }) {
  // All settled the moment the first row names the account, because none of them
  // can be known before it: the id itself only arrives with the first row, and
  // the folder is looked up from it.
  let accountDir = null;
  let archive = new Map();
  let incremental = false;
  let badId = null;

  const result = await collect({
    url: target.url,
    cookies,
    bin,
    onAccount: async (account) => {
      // Recorded and stopped rather than thrown: collect() reads this inside its
      // row loop, where a throw would surface as an unexplained stream failure.
      if (!isSafeId(account.id)) {
        badId = String(account.id ?? '');
        return () => true;
      }
      // Resolved, never computed. The folder may be named for an alias, and
      // going straight to the id would quietly start a second, empty archive
      // beside the real one on every aliased account.
      accountDir =
        (await resolveAccountDir(root, { id: account.id })) ??
        (alias ? aliasDirFor(root, alias) : accountDirFor(root, account.id));
      archive = await readArchive(accountDir);
      // A first run has nothing to recognise, so there is nothing to stop at.
      incremental = archive.size > 0 && !full;
      return makeStopper({ archive, threshold, enabled: incremental });
    },
  });

  if (result.failure) return { failure: result.failure, stderr: result.stderr };
  if (badId !== null) return { badId };
  if (!result.rows.length) return { empty: true };

  // Without an id there is no folder to write into. The old layout could fall
  // back to naming the folder after the handle; this one cannot, and inventing a
  // folder that the next run would not find again is worse than stopping.
  const account = result.account;
  if (!account?.id) return { unidentified: true };

  // Checked again now the id is known. The pre-flight check ran before the
  // fetch on whatever identity could be worked out without one, which is enough
  // to catch a typo cheaply but not enough to be the answer — and promising a
  // move in the block that --go would then refuse is worse than stopping here.
  if (alias) {
    const verdict = await checkAlias(root, { id: account.id, alias });
    if (!verdict.ok) return { aliasRefused: verdict.reason };
  }

  const posts = groupFiles(result.rows);
  const { counts } = diff(posts, archive);

  const plan = {
    createdAt: new Date().toISOString(),
    account,
    root,
    url: target.url,
    mode: incremental ? 'incremental' : 'full',
    stoppedEarly: result.stoppedEarly,
    abortThreshold: threshold,
    counts,
    // The files array is kept rather than reduced to a count: --go re-derives
    // what is still missing from this list, and totals alone could not say
    // which of a post's four images had landed.
    posts,
  };

  await mkdir(accountDir, { recursive: true });
  await stampRoot(root);

  // Read before anything is written: the block's "last run used …" note compares
  // this run's root against the one the previous run recorded, and --go's
  // recordRun below will replace it.
  const lastRoot = await previousRoot(accountDir);

  await savePlan(accountDir, plan);

  // Written now rather than after the download, so a folder that exists always
  // says whose it is. It is also what --go finds the folder by when all it has
  // is the URL, the alias or the handle.
  await recordIdentity(root, accountDir, { account, url: target.url });

  return {
    plan,
    accountDir,
    previousRoot: lastRoot,
    movingTo: aliasTarget(root, { id: account.id, alias, unalias }),
  };
}

async function doGo({
  root, dir, alias, unalias, url, handle, cookies, planHint, bin = 'gallery-dl',
}) {
  // --yes has just enumerated and knows exactly which folder it wrote into, so
  // it passes it in. A bare --go enumerates nothing, never learns the numeric
  // id, and cannot go straight to the folder — the alias the user gave it, the
  // URL the plan was written from, and the handle are the keys that still work.
  let accountDir = dir ?? (await findAccountDir(root, { url, alias, handle }));
  if (!accountDir) {
    return { refused: `no archive under ${root} for this account yet`, planHint };
  }

  // Read before the move, because the move is what makes the path stale. This is
  // also the id that validatePlan checks the plan against: --go could not do
  // that before, and fell back to comparing URLs.
  const identity = await readAccount(accountDir);
  const account = identity?.account;

  // The rename lands here rather than on --plan, and before the download rather
  // than after, so what is fetched goes straight into its final home.
  if (account?.id && (alias || unalias)) {
    try {
      accountDir = unalias
        ? await clearAlias(root, { id: account.id })
        : await applyAlias(root, { id: account.id, alias });
    } catch (error) {
      return { refused: error.message };
    }
  }

  const plan = await loadPlan(accountDir);
  const valid = validatePlan(plan, { root, account });
  if (!valid.ok) return { refused: valid.reason, planHint };

  const archive = await readArchive(accountDir);
  const todo = outstanding(plan.posts, archive);

  const { fetched, failed, stopped } = await fetchPosts({
    accountDir,
    posts: todo,
    handle: plan.account?.handle,
    cookies,
    bin,
  });

  await refreshAssets(accountDir, plan.account);

  const remaining = outstanding(plan.posts, await readArchive(accountDir)).length;

  // After the move, so the alias recorded is the folder this run finished in.
  await recordIdentity(root, accountDir, { account: plan.account, url });
  await recordRun(accountDir, {
    root,
    found: plan.counts?.foundPosts ?? null,
    landed: fetched.posts,
    failed,
  });

  // Retired only once every post in it has landed. Kept when a run stops
  // partway, which is what makes the retry fetch only what is missing.
  if (remaining === 0) await clearPlan(accountDir);

  return { plan, accountDir, fetched, failed, stopped, remaining };
}

export async function main(argv) {
  const { opts, positional, unknown } = parseCommandLine(argv);

  if (opts.help || opts.h) {
    console.log(USAGE);
    return EXIT.OK;
  }

  // Named rather than left to the unknown-flag path below. The old flag is the
  // one thing likely to still be sitting in a shell history, and "unknown
  // option" would be true while sending the user to --help to work out why.
  if (unknown.includes('--downloads')) {
    console.error(
      'error: --downloads was renamed to --archives (and the default root is now archives/)',
    );
    console.error(
      '  the old root is not read: rename downloads/ to archives/, or pass --archives DIR',
    );
    return EXIT.USAGE;
  }

  // Whatever the user typed is passed through as given, so an unknown flag is
  // their typo to see rather than something for the agent to guess at.
  if (unknown.length) {
    console.error(`error: unknown option '${unknown[0]}' (try --help)`);
    return EXIT.USAGE;
  }

  const url = positional[0];
  if (!url) {
    console.error(USAGE);
    return EXIT.USAGE;
  }

  let target;
  try {
    target = parseTarget(url);
  } catch (error) {
    return fail(`${error.message}.\n  This skill takes an account URL: https://x.com/<handle>.`, EXIT.USAGE);
  }

  const browser = optString(opts, 'browser');
  const full = opts.full === true;
  const alias = optString(opts, 'alias');
  const unalias = opts.unalias === true;

  if (alias && unalias) {
    return fail('--alias and --unalias ask for opposite things. Pass one or the other.', EXIT.USAGE);
  }

  // The shape of an alias needs no filesystem and no network, so a typo is
  // refused here rather than after a full timeline crawl. checkAlias says the
  // same thing later in the same words — they share the sentence rather than
  // keeping two copies of it that could come to disagree.
  if (alias && !isSafeAlias(alias)) return fail(aliasShapeRefusal(alias), EXIT.USAGE);

  let root;
  try {
    const given = optString(opts, 'archives');
    root = given ? normalizeRoot(given) : archivesRoot();
  } catch (error) {
    return fail(error.message, EXIT.USAGE);
  }

  // Before the session, before the first API call, before anything is written:
  // an archive this build cannot read must cost nothing to discover. With no
  // old-layout detection behind it, this refusal is the only thing standing
  // between a version mismatch and a silent full re-download.
  try {
    await checkRoot(root);
  } catch (error) {
    return fail(error.message, EXIT.USAGE);
  }

  // Everything an alias can be refused for except "it is already yours" needs
  // only the archives root, so it is decided before the session and the first
  // API call. The id is whatever can be worked out without a fetch — an account
  // already archived under this alias, URL or handle — and null for one that has
  // never been seen, which cannot collide with itself either way. doPlan asks
  // again once the real id is in hand.
  if (alias) {
    const existing = await findAccountDir(root, { url: target.url, alias, handle: target.handle });
    const verdict = await checkAlias(root, {
      id: existing ? ((await readAccount(existing))?.account?.id ?? null) : null,
      alias,
    });
    if (!verdict.ok) return fail(verdict.reason, EXIT.USAGE);
  }

  let cookies;
  try {
    cookies = await ensureCookies({ cookies: optString(opts, 'cookies'), browser, url: target.url });
  } catch (error) {
    return fail(error.message);
  }

  const mode = pickMode(opts);

  const planHint = `${process.env.ARCHIVE_SELF || 'archive.sh'} '${url}'${
    optString(opts, 'archives') ? ` --archives '${optString(opts, 'archives')}'` : ''
  } --plan`;

  if (mode === 'go') {
    return report(
      await doGo({
        root, url: target.url, alias, unalias, handle: target.handle, cookies, planHint,
      }),
    );
  }

  const planned = await doPlan({
    target, root, alias, unalias, cookies, full, threshold: DEFAULT_ABORT,
  });

  if (planned.failure) {
    if (planned.failure === 'unauthorized') await discardCookies();
    return fail(
      `${planned.failure}\n\n${REMEDIES[planned.failure] ?? planned.stderr?.trim().split('\n').slice(-8).join('\n') ?? ''}`,
      planned.failure === 'unauthorized' ? EXIT.UNAUTHORIZED : EXIT.FAILED,
    );
  }

  if (planned.badId) {
    return fail(
      `X reported an account id this skill will not use as a folder name: ${JSON.stringify(planned.badId)}.\n` +
        '  Nothing has been written. Please report this — an X user id should be digits.',
    );
  }

  if (planned.aliasRefused) {
    // Nothing has moved: the alias is decided before the plan is written, so a
    // refusal here leaves the archive exactly as it was found.
    return fail(planned.aliasRefused, EXIT.USAGE);
  }

  if (planned.unidentified) {
    return fail(
      'the timeline was readable but never named the account, so there is no id to file it under.\n' +
        '  Try again; if it persists, the saved session may be partly rejected.',
    );
  }

  if (planned.empty) {
    // Zero posts and no error is a real answer for an account that has posted
    // no media. It is never rendered as "up to date", because an account you
    // are not allowed to read produces exactly the same silence.
    return fail(
      'found no media posts there.\n' +
        '  An account can genuinely have none. It also looks like this when the account is\n' +
        '  protected, or when the saved session has expired without saying so.',
      EXIT.EMPTY,
    );
  }

  console.log(
    renderPlanBlock(planned.plan, {
      previousRoot: planned.previousRoot,
      folder: planned.accountDir,
      movingTo: planned.movingTo,
    }),
  );

  if (mode === 'plan') return EXIT.OK;

  if (planned.plan.counts.fetchPosts === 0) {
    // Nothing to download, but this run was still approved — and the avatar may
    // have changed even where the timeline has not.
    await refreshAssets(planned.accountDir, planned.plan.account);
    return EXIT.OK;
  }

  console.log('');
  return report(
    await doGo({
      root, dir: planned.accountDir, alias, unalias, url: target.url, handle: target.handle,
      cookies, planHint,
    }),
  );
}

async function report(result) {
  if (result.refused) {
    console.error(`error: ${result.refused}`);
    if (result.planHint) console.error(`  make one with:\n    ${result.planHint}`);
    return EXIT.REFUSED;
  }

  console.log(
    renderSummaryBlock({
      account: result.plan.account,
      folder: result.accountDir,
      fetched: result.fetched,
      failed: result.failed,
      remaining: result.remaining,
    }),
  );

  if (result.stopped) {
    // Discarded here as well as on the plan path. The remedy text tells the user
    // the cached session has been thrown away, and leaving the file in place
    // would make that a lie the next run repeats — it would read the same dead
    // token back and stop in exactly the same way, forever.
    if (result.stopped === 'unauthorized') await discardCookies();
    console.error(`\n${REMEDIES[result.stopped] ?? `the run stopped: ${result.stopped}`}`);
    return result.stopped === 'unauthorized' ? EXIT.UNAUTHORIZED : EXIT.FAILED;
  }
  return EXIT.OK;
}

/**
 * --yes outranks a --plan or --go after it on the command line. The skill never
 * reaches for --yes; a user who typed it has pre-authorised the run, and the
 * skill appending its own mode flag must not take that back.
 */
export function pickMode(opts) {
  if (opts.yes === true || opts.y === true) return 'yes';
  if (opts.go === true) return 'go';
  return 'plan';
}

if (isMainModule(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
