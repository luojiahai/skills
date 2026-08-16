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
  findFolderByUrl,
  folderNameFor,
  readMetadata,
  resolveFolder,
  writeMetadata,
} from './metadata.mjs';
import { REMEDIES, cookieExportArgs } from './gallerydl.mjs';
import { fetchPosts, outstanding } from './fetch.mjs';
import { COOKIE_FILE, STATE_DIR, archivesRoot, normalizeRoot } from './paths.mjs';
import {
  PLAN_VERSION,
  deletePlan,
  diff,
  groupFiles,
  loadPlan,
  renderPlanBlock,
  renderSummaryBlock,
  savePlan,
  validatePlan,
} from './plan.mjs';
import { parseTarget } from './target.mjs';

const EXIT = { OK: 0, USAGE: 2, REFUSED: 3, FAILED: 4, UNAUTHORIZED: 5, EMPTY: 6 };

const USAGE = `Usage: archive.sh <url> [--archives DIR] [--name NAME] [--plan|--go|--yes]

  <url>                 https://x.com/<handle>              an account's media
                        https://x.com/<handle>/status/<id>  one post

      --plan            Enumerate the account, report what would be fetched,
                        and stop. Downloads nothing.
      --go              Download the posts the last --plan listed. Needs a
                        plan for this account, root and folder, under a day old.
      --yes, -y         Plan and download in one run, without stopping.

      --archives DIR    Root directory the archives live in. The account
                        folder is DIR/x_<handle or --name>.
      --name NAME       Account name for the folder (default: its handle). The
                        x_ prefix is always kept, so a shared archives root
                        cannot collide with douyin-archiver's folders.
      --full            Enumerate the whole timeline even when a re-run could
                        stop early.
      --browser NAME    Browser to read the X session from the first time
                        (chrome, firefox, safari, edge, brave, chromium...).
      --cookies FILE    Use this cookies.txt instead of a browser or the cache.
  -h, --help            Show this help

State lives in <DIR>/<folder>: posts/ holds the media, metadata.json the
account's identity, and between --plan and --go, .plan.json is the list
awaiting approval. The cached X session is in ${STATE_DIR}.`;

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
 * Who this folder belongs to, written before the download rather than after.
 *
 * `accountUrl` is null for a single-post run: the URL it was given names a
 * post, not the account, and recording it would break the one lookup `--go` has
 * — `findFolderByUrl` matches the account URL an archive was made from. The
 * merge leaves the recorded one alone when this run has none to offer.
 */
function recordAccount(accountDir, { account, root, accountUrl }) {
  return writeMetadata(accountDir, {
    account,
    root,
    url: accountUrl,
    updated_at: new Date().toISOString(),
  });
}

async function doPlan({ target, root, name, cookies, full, threshold, accountUrl, bin = 'gallery-dl' }) {
  // All three are settled the moment the first row names the account, because
  // none of them can be known before it. Resolving the folder from the URL's
  // handle instead would look in the wrong place for any account that has been
  // renamed — it would find an empty directory, report "on disk 0", quietly
  // downgrade the incremental sweep to a full one, and write the plan somewhere
  // --go then cannot find it.
  let settled = null;
  let archive = new Map();
  let incremental = false;

  const result = await collect({
    url: target.url,
    cookies,
    bin,
    onAccount: async (account) => {
      settled = await resolveFolder({ root, accountId: account.id, handle: account.handle, name });
      archive = await readArchive(path.join(root, settled));
      // A first run has nothing to recognise, so there is nothing to stop at.
      incremental = archive.size > 0 && !full && target.kind === 'account';
      return makeStopper({ archive, threshold, enabled: incremental });
    },
  });

  if (result.failure) return { failure: result.failure, stderr: result.stderr };

  if (!result.rows.length) {
    return { empty: true };
  }

  const posts = groupFiles(result.rows);
  const { counts } = diff(posts, archive);
  const account = result.account ?? { id: '', handle: target.handle, nickname: '' };
  settled ??= folderNameFor({ handle: account.handle || target.handle, name });
  const settledDir = path.join(root, settled);

  const plan = {
    version: PLAN_VERSION,
    createdAt: new Date().toISOString(),
    account,
    root,
    folder: settled,
    url: target.url,
    mode: incremental ? 'incremental' : 'full',
    stoppedEarly: result.stoppedEarly,
    abortThreshold: threshold,
    counts,
    // The files array is kept rather than reduced to a count: --go re-derives
    // what is still missing from this list, and totals alone could not say
    // which of a post's four images had landed.
    posts,
    // Whether the folder was named by the user rather than after the handle.
    // The drift note compares the two, and without this a --name archive would
    // be reported as a renamed account on every single run.
    named: Boolean(name),
  };

  await mkdir(settledDir, { recursive: true });
  await savePlan(settledDir, plan);

  // Read before write, and in this order for a reason: the block's "last run
  // used …" note compares this run's root against the one the file recorded,
  // and the write on the next line replaces it.
  const previousRoot = (await readMetadata(settledDir))?.root ?? null;

  // Written now rather than after the download, so a folder that exists always
  // says whose it is. It is what --go finds the folder by, and what a later run
  // matches a renamed account against.
  await recordAccount(settledDir, { account, root, accountUrl });

  return { plan, folder: settled, previousRoot };
}

async function doGo({ root, folder, url, cookies, planHint, accountUrl, bin = 'gallery-dl' }) {
  // --go enumerates nothing, so it never learns the numeric id and cannot find
  // a renamed account's folder the way --plan does. The URL the plan was written
  // from is the key that still works.
  const settled = (await findFolderByUrl(root, url)) ?? folder;
  const accountDir = path.join(root, settled);
  const plan = await loadPlan(accountDir);
  const valid = validatePlan(plan, { root, folder: settled, url });
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

  const remaining = outstanding(plan.posts, await readArchive(accountDir)).length;

  await recordAccount(accountDir, { account: plan.account, root, accountUrl });

  // Deleted only once every post in it has landed. Kept when a run stops
  // partway, which is what makes the retry fetch only what is missing.
  if (remaining === 0) await deletePlan(accountDir);

  return { plan, fetched, failed, stopped, remaining };
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

  const target = parseTarget(url);
  if (target.kind === 'unsupported') {
    return fail(`${target.why}.\n  This skill takes an account URL or a single post URL.`, EXIT.USAGE);
  }

  const browser = optString(opts, 'browser');
  const full = opts.full === true;

  let root;
  try {
    const given = optString(opts, 'archives');
    root = given ? normalizeRoot(given) : archivesRoot();
  } catch (error) {
    return fail(error.message, EXIT.USAGE);
  }

  let cookies;
  try {
    cookies = await ensureCookies({ cookies: optString(opts, 'cookies'), browser, url: target.url });
  } catch (error) {
    return fail(error.message);
  }

  // A single post is already as specific as an instruction gets, so it needs no
  // approval step. An account does, always.
  const mode = target.kind === 'post' ? 'yes' : pickMode(opts);

  const name = optString(opts, 'name');
  const planHint = `${process.env.ARCHIVE_SELF || 'archive.sh'} '${url}'${
    optString(opts, 'archives') ? ` --archives '${optString(opts, 'archives')}'` : ''
  } --plan`;

  // A post URL names a post; only an account URL says whose archive this is.
  const accountUrl = target.kind === 'account' ? target.url : null;

  if (mode === 'go') {
    const folder = folderNameFor({ handle: target.handle, name });
    return report(await doGo({ root, folder, url: target.url, cookies, planHint, accountUrl }));
  }

  const planned = await doPlan({
    target, root, name, cookies, full, threshold: DEFAULT_ABORT, accountUrl,
  });

  if (planned.failure) {
    if (planned.failure === 'unauthorized') await discardCookies();
    return fail(
      `${planned.failure}\n\n${REMEDIES[planned.failure] ?? planned.stderr?.trim().split('\n').slice(-8).join('\n') ?? ''}`,
      planned.failure === 'unauthorized' ? EXIT.UNAUTHORIZED : EXIT.FAILED,
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

  console.log(renderPlanBlock(planned.plan, { previousRoot: planned.previousRoot }));

  if (mode === 'plan') return EXIT.OK;

  if (planned.plan.counts.fetchPosts === 0) return EXIT.OK;

  console.log('');
  return report(
    await doGo({ root, folder: planned.folder, url: target.url, cookies, planHint, accountUrl }),
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
      root: result.plan.root,
      folder: result.plan.folder,
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
