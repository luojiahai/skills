/**
 * run.mjs — the whole Douyin run: what the user asked for, in, and a block out.
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
 */
import path from 'node:path';

import { EXIT } from '../shared/exit.mjs';
import { fail, pickMode, self } from '../shared/run.mjs';
import { missingTool, onPath } from '../shared/tools.mjs';
import {
  COMMON_BOOLEAN_FLAGS,
  COMMON_FLAGS,
  isMainModule,
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
import { collect } from './collect.mjs';
import { YT_DLP, fetchPosts, outstanding } from './fetch.mjs';
import { onDiskIds, readArchive } from '../shared/landed.mjs';
import { login } from './login.mjs';
import { archivesRoot, cookieFile, normalizeRoot } from '../shared/paths.mjs';
import { PLATFORM, PROFILE_DIR, loadPlaywright } from './playwright.mjs';
import { descriptorFor } from '../shared/platforms.mjs';

const ACCOUNT = descriptorFor(PLATFORM);
const COOKIE_FILE = cookieFile(PLATFORM);
import {
  approved,
  buildPlan,
  listedIds,
  renderPlanBlock,
  renderSummaryBlock,
  unlistedCountFromPlan,
  validatePlan,
} from '../shared/plan.mjs';
import { foundDetail, headline, notes } from './blocks.mjs';
import { mintCookies, profileHasSession } from './session.mjs';
import { clearPlan, loadPlan, previousRoot, recordRun, savePlan } from '../shared/sync.mjs';
import { parseTarget } from './target.mjs';

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
  } = deps;

  const { opts, positional, unknown } = parseCommandLine(argv, {
    booleans: BOOLEAN_FLAGS,
    known: KNOWN_FLAGS,
  });

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

  if (unknown.length) {
    console.error(`error: unknown option '${unknown[0]}' (try --help)`);
    return EXIT.USAGE;
  }

  const url = positional[0];
  if (!url) {
    console.error(USAGE);
    console.error('\nerror: no URL given');
    return EXIT.USAGE;
  }

  // Settled before the archives root, before the preflight, before anything is
  // read or written, because refusing a URL needs nothing installed.
  let target;
  try {
    target = parseTarget(url);
  } catch (error) {
    return fail(error.message, EXIT.USAGE);
  }

  const profileDir = optString(opts, 'profile') || PROFILE_DIR;

  // Playwright drives the browser for both signing in and collecting, so it is
  // needed on every path past here.
  let chromium;
  try {
    ({ chromium } = await playwrightImpl());
  } catch (error) {
    return fail(error.message);
  }

  if (opts.login === true) {
    const result = await loginImpl({ url: target.url, profileDir, launch: chromium });
    if (result.ok) return EXIT.OK;
    return fail(`${result.reason}.\n  Nothing was archived. Run --login again when you are ready.`, EXIT.UNAUTHORIZED);
  }

  // yt-dlp is what downloads, so nothing past here works without it. Checked
  // after the URL, because a refusable URL should be refused on any machine.
  if (!(await onPathImpl(YT_DLP))) {
    console.error(
      missingTool(YT_DLP, {
        brew: 'brew install yt-dlp',
        otherwise: 'pipx install yt-dlp\n      or see https://github.com/yt-dlp/yt-dlp#installation',
        hasBrew: await onPathImpl('brew'),
      }),
    );
    return EXIT.FAILED;
  }

  const alias = optString(opts, 'alias');
  const unalias = opts.unalias === true;

  if (alias && unalias) {
    return fail('--alias and --unalias ask for opposite things. Pass one or the other.', EXIT.USAGE);
  }

  // The shape of an alias needs no filesystem and no browser, so a typo is
  // refused here rather than after a full profile scroll.
  if (alias && !isSafeAlias(alias)) return fail(aliasShapeRefusal(alias), EXIT.USAGE);

  let root;
  try {
    const given = optString(opts, 'archives');
    root = given ? normalizeRoot(given) : archivesRoot();
  } catch (error) {
    return fail(error.message, EXIT.USAGE);
  }

  // Before the session, before the first request, before anything is written:
  // an archive this build cannot read must cost nothing to discover. With no
  // old-layout detection behind it, this refusal is the only thing standing
  // between a version mismatch and a silent full re-download.
  try {
    await checkRoot(root);
  } catch (error) {
    return fail(error.message, EXIT.USAGE);
  }

  // Everything an alias can be refused for except "it is already yours" needs
  // only the archives root, so it is decided before the browser opens. The
  // sec_uid is in the URL, so this run always knows whose account it is.
  if (alias) {
    const existing = await findAccountDir(ACCOUNT, root, { url: target.url, alias, douyinId: null });
    const verdict = await checkAlias(ACCOUNT, root, {
      id: existing ? ((await readAccount(existing))?.account?.id ?? null) : target.secUid,
      alias,
    });
    if (!verdict.ok) return fail(verdict.reason, EXIT.USAGE);
  }

  // A cookie in the profile proves a sign-in happened. It does not prove Douyin
  // still accepts it — an expired-but-present session is caught later, by a grid
  // that renders nothing — but its absence is knowable now, and turns a
  // confusing half-minute into an instant, correct message.
  if (!(await hasSessionImpl(profileDir, { launch: chromium }))) {
    return fail(
      `no Douyin session in ${profileDir}.\n` +
        `  Only a human can pass Douyin's login. Sign in once with:\n` +
        `    ${self()} '${url}' --login`,
      EXIT.UNAUTHORIZED,
    );
  }

  const mode = pickMode(opts);
  const planHint = `${self()} '${url}'${
    optString(opts, 'archives') ? ` --archives '${optString(opts, 'archives')}'` : ''
  }${alias ? ` --alias '${alias}'` : ''} --plan`;

  if (mode === 'go') {
    return await doGo({ root, target, alias, unalias, profileDir, chromium, planHint, fetchImpl, mintImpl });
  }

  const planned = await doPlan({ root, target, alias, unalias, profileDir, chromium, collectImpl });
  if (planned.exit !== undefined) return planned.exit;

  console.log(planned.block);

  if (planned.pending === 0) return EXIT.OK;

  if (mode === 'plan') {
    console.log('\nNothing has been downloaded. To fetch the posts above:');
    console.log(`  ${planHint.replace(/ --plan$/, ' --go')}`);
    return EXIT.OK;
  }

  console.log('');
  return await doGo({ root, target, alias, unalias, profileDir, chromium, planHint, fetchImpl, mintImpl });
}

/** Collect the account, diff it against disk, park the plan, render the block. */
async function doPlan({ root, target, alias, unalias, profileDir, chromium, collectImpl }) {
  console.log('[douyin] collecting post IDs…');
  const listing = await collectImpl({
    url: target.url,
    secUid: target.secUid,
    profileDir,
    headless: true,
    launch: chromium,
    log: progress,
  });

  if (listing.failure === 'empty-grid') {
    return {
      exit: fail(
        'found 0 posts in the profile grid.\n' +
          (listing.reported
            ? `  The profile reports ${listing.reported} post(s), so the grid exists but did\n` +
              '  not render — almost certainly an expired session.\n'
            : '  An account can genuinely have none. It also looks like this when the\n' +
              '  saved session has expired without saying so.\n') +
          `  Sign in again with:  ${self()} '${target.url}' --login`,
        listing.reported ? EXIT.UNAUTHORIZED : EXIT.EMPTY,
      ),
    };
  }

  if (!listing.account?.douyin_id) {
    return {
      exit: fail(
        'the profile was readable but never showed its 抖音号, so there is no\n' +
          '  identity to file this archive under. Try again; if it persists, the\n' +
          '  saved session may be partly rejected.',
      ),
    };
  }

  // Asked again now the 抖音号 is known: the first check could not tell an
  // account's own alias apart from a collision with someone else's.
  if (alias) {
    const verdict = await checkAlias(ACCOUNT, root, { id: target.secUid, alias });
    if (!verdict.ok) return { exit: fail(verdict.reason, EXIT.USAGE) };
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

  // Written at the one point every run passes through once its folder is known,
  // so a folder that exists always says whose it is — before anything has been
  // downloaded into it. The alias is not passed: recordIdentity reads it off the
  // folder's own name, which is what keeps account.json and the directory from
  // disagreeing.
  await recordIdentity(ACCOUNT, root, accountDir, {
    account: {
      id: target.secUid,
      douyin_id: listing.account.douyin_id,
      nickname: listing.account.nickname,
    },
    url: target.url,
  });

  const archive = await readArchive(accountDir);
  const onDisk = await onDiskIds(accountDir);
  const pending = outstanding(listing.posts, archive);

  const listed = listedIds(listing.posts);
  const unlisted = [...onDisk].filter((id) => !listed.has(id)).length;

  const plan = buildPlan({
    account: {
      id: target.secUid,
      douyin_id: listing.account.douyin_id,
      nickname: listing.account.nickname,
    },
    root,
    collected: listing.posts,
    pending,
    counts: {
      found: listing.posts.length,
      foundDetail: foundDetail(listing.reported),
      onDisk: onDisk.size,
      toFetch: pending.length,
      // Kept because the summary makes its own notes from them. Carrying the
      // rendered notes alone would leave the finished run picking its own
      // sentences back out of the plan by matching on their wording.
      reported: listing.reported,
      skipped: listing.skippedImagePosts,
    },
    notes: notes({
      collected: listing.posts.length,
      reported: listing.reported,
      skipped: listing.skippedImagePosts,
      unlisted,
    }),
    now: new Date(),
  });

  if (pending.length) await savePlan(accountDir, plan);
  // A plan left over from an earlier run would otherwise outlive the work it
  // described, and --go would happily download it.
  else await clearPlan(accountDir);

  return {
    pending: pending.length,
    block: renderPlanBlock({
      headline: headline(plan.account),
      folder: accountDir,
      movingTo: aliasTarget(ACCOUNT, root, { id: target.secUid, alias, unalias }),
      previousRoot: lastRoot,
      root,
      counts: plan.counts,
      notes: plan.notes,
    }),
  };
}

/** Download the plan that was approved. No collection, no browser. */
async function doGo({ root, target, alias, unalias, profileDir, chromium, planHint, fetchImpl, mintImpl }) {
  // resolveAccountDir returns a folder only once account.json there names this
  // sec_uid, so a non-null answer *is* the identity check. Falling back to the
  // bare sec_uid path would be the one case that matters: a folder of that name
  // belonging to somebody else, handed to --go to run a plan against.
  let accountDir = await resolveAccountDir(ACCOUNT, root, { id: target.secUid });

  if (!accountDir) {
    return fail(
      `no folder for this account under ${root}, so there is no plan to run.\n  make one with:\n    ${planHint}`,
      EXIT.REFUSED,
    );
  }

  const plan = await loadPlan(accountDir);
  const verdict = validatePlan(plan, { accountId: target.secUid, root });

  if (!verdict.ok) {
    console.error(`error: ${verdict.reason}`);
    console.error(`  make one with:\n    ${planHint}`);
    return EXIT.REFUSED;
  }

  // The move happens before the download, so what is fetched goes straight into
  // its final home. A rename between --plan and --go invalidates nothing,
  // because a plan records the archives root and the account, never the folder.
  accountDir = await moveIfAsked({ root, alias, unalias, secUid: target.secUid, accountDir });

  const archive = await readArchive(accountDir);
  const before = (await onDiskIds(accountDir)).size;

  // Re-checked against disk rather than taken as written. A --go that died
  // partway leaves a plan still listing what it managed to fetch, and every one
  // of those would otherwise cost a request to discover it was already there.
  const pending = outstanding(approved(plan), archive);

  let fetched = 0;
  let failed = 0;
  if (!pending.length) {
    console.log('[douyin] every post in the plan is already downloaded');
  } else {
    console.log(`[douyin] downloading ${pending.length} post(s) to ${path.join(accountDir, 'posts')}…`);
    const cookies = await mintImpl(profileDir, COOKIE_FILE, { launch: chromium });
    ({ fetched, failed } = await fetchImpl({
      accountDir,
      posts: pending,
      cookies,
      refreshCookies: () => mintImpl(profileDir, COOKIE_FILE, { launch: chromium }),
      log: progress,
    }));
  }

  const landed = await onDiskIds(accountDir);
  const total = landed.size;

  // Asked of the folder rather than of the fetcher. A downloader that exits
  // clean without writing the files has archived nothing, and a plan retired on
  // its word would cost a second listing to find that out.
  const remaining = outstanding(approved(plan), await readArchive(accountDir)).length;

  await recordRun(accountDir, {
    root,
    found: plan.counts?.found ?? null,
    landed: total - before,
    failed,
  });

  console.log('');
  console.log(
    renderSummaryBlock({
      headline: headline(plan.account),
      folder: accountDir,
      counts: plan.counts,
      // Made afresh from the numbers the plan recorded, with the unlisted count
      // recomputed against what is on disk now. The rest describe the listing
      // pass and are as true as when it ran.
      notes: notes({
        collected: plan.counts?.found ?? 0,
        reported: plan.counts?.reported ?? null,
        skipped: plan.counts?.skipped ?? null,
        unlisted: unlistedCountFromPlan(plan, landed),
      }),
      downloaded: total - before,
      total,
      failed,
    }),
  );

  // Kept after a partial run, so a retry re-fetches only what is missing without
  // paying for another collection; retired once it has all landed.
  if (remaining === 0) await clearPlan(accountDir);

  return failed ? EXIT.FAILED : EXIT.OK;
}

async function moveIfAsked({ root, alias, unalias, secUid, accountDir }) {
  if (unalias) return (await clearAlias(ACCOUNT, root, { id: secUid })) ?? accountDir;
  if (alias) return (await applyAlias(ACCOUNT, root, { id: secUid, alias })) ?? accountDir;
  return accountDir;
}

/** Progress lines rewrite one line rather than scrolling a wall of them. */
function progress(message, { progress: inPlace } = {}) {
  if (inPlace && process.stdout.isTTY) process.stdout.write(`\r${message}`);
  else console.log(message);
}

if (isMainModule(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
