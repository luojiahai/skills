/**
 * run.mjs — what X brings to a run, and nothing else.
 *
 * The run itself is `shared/run.mjs`: what the command line asked for, the
 * order refusals are reached in, where the account folder is, and the one
 * document it all answers with. What is here is the adapter — the six things
 * this platform does its own way, and the data that names them.
 *
 *   --plan   collect, diff, report. Downloads nothing.
 *   --go     download exactly what the last plan listed.
 *   --yes    both, without stopping to confirm.
 *
 * Nothing here writes a sentence for a user — that belongs to `SKILL.md`,
 * which reads the document this answers with.
 */
import { COMMON_BOOLEAN_FLAGS, COMMON_FLAGS, isMainModule, optString } from '../../shared/cli.mjs';
import { Refusal } from '../../shared/errors.mjs';
import { descriptorFor, labelFor, postIdKeyFor } from '../../shared/platforms.mjs';
import { stateDir, toolPath } from '../../shared/paths.mjs';
import { BROWSERS, discardCookies as discardSession, ensureCookies } from '../../shared/session.mjs';
import { runAccount, sweepNote } from '../../shared/run.mjs';
import { hatchToolMissing, onPath } from '../../shared/tools.mjs';
import { ensureEnv } from '../../shared/env.mjs';

import { saveProfileAssets } from './assets.mjs';
import { DEFAULT_ABORT, collect, diff, groupFiles } from './collect.mjs';
import { FAILURES } from './gallerydl.mjs';
import { fetchPosts } from './fetch.mjs';
import { parseTarget, permalink } from './target.mjs';

const PLATFORM = 'x';
const ACCOUNT = descriptorFor(PLATFORM);
const POST_ID_KEY = postIdKeyFor(PLATFORM);
const STATE_DIR = stateDir(PLATFORM);

/** What a session refusal calls this site, taken from the registry rather than respelled. */
export const SESSION = { platform: PLATFORM, label: labelFor(PLATFORM) };

/** What X adds to the flags every platform shares. */
const BOOLEAN_FLAGS = new Set([...COMMON_BOOLEAN_FLAGS, 'full']);
const KNOWN_FLAGS = new Set([...COMMON_FLAGS, ...BOOLEAN_FLAGS, 'browser', 'cookies']);

const USAGE = `Usage: archive.sh <url> [--archives DIR] [--alias NAME] [--plan|--go|--yes]

  <url>                 https://x.com/<handle>              an account's media

      --plan            Collect the account, report what would be fetched,
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
      --full            Collect the whole timeline even when a re-run could
                        stop early.
      --browser NAME    Browser to read the X session from the first time
                        (${BROWSERS.join(', ')}).
      --cookies FILE    Use this cookies.txt instead of a browser or the cache.
  -h, --help            Show this help

Every command but this one answers with a single JSON document on stdout;
progress goes to stderr. gallery-dl's own output is buffered rather than
relayed — it is what a failure is classified from.

State lives in the account folder: posts/ holds one folder per post,
account.json the account's identity, assets/ the current avatar and banner, and
sync.json the list awaiting approval between --plan and --go. <DIR>/archiver.json
records which schema the archive uses and maps each account's id to its alias.
The cached X session is in ${STATE_DIR}.`;

/**
 * The account's current look, refreshed on every run that downloads.
 *
 * Not on `--plan`, which fetches nothing by definition — but on every run past
 * that, including a `--yes` against an account with no new posts, because
 * `assets/` is the account as it is *now* rather than as it was when it last
 * posted. Two CDN requests, and a failure is swallowed: an avatar must not end
 * a run that has just fetched an account's history.
 */
const refreshAssets = (accountDir, account) =>
  saveProfileAssets(accountDir, { avatar: account?.avatar, banner: account?.banner });

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

const ADAPTER = {
  platform: PLATFORM,
  account: ACCOUNT,
  postIdKey: POST_ID_KEY,
  usage: USAGE,
  booleans: BOOLEAN_FLAGS,
  flags: KNOWN_FLAGS,
  threshold: DEFAULT_ABORT,
  failures: FAILURES,
  // X adds no command of its own to the three every platform answers.
  commands: {},

  parseTarget,
  groupFiles,
  diff,
  collectRefusal,

  // Somebody who only ever archives X never downloads Chromium: nothing here
  // drives a page.
  boxes: () => ['runtime', 'tools'],
  ensureEnv,

  // Answers only under the escape hatch, where the machine's own gallery-dl is
  // being used and can simply not be there. Off it the box holds gallery-dl,
  // and a box that could not be built has already refused.
  preflight: (a) =>
    hatchToolMissing(
      toolPath('gallery-dl'),
      { install: 'uv tool install gallery-dl', docs: 'https://github.com/mikf/gallery-dl#installation' },
      a.onPath,
    ),
  onPath,

  session: ({ opts, target }) =>
    ensureCookies(SESSION, {
      cookies: optString(opts, 'cookies'),
      browser: optString(opts, 'browser'),
      url: target.url,
      bin: toolPath('gallery-dl'),
    }),
  /** A rejected session is discarded, so the next run reads the browser again. */
  discardSession: () => discardSession(PLATFORM),

  // The run settles the folder and reads the archive in `onAccount`, and hands
  // back the stopping rule as a factory rather than a built stopper — X sweeps
  // one feed and calls it once, where Instagram calls it per pass.
  collect: ({ url, session, onAccount, stopper }) =>
    collect({
      url,
      cookies: session,
      bin: toolPath('gallery-dl'),
      onAccount: async (account) => {
        const rule = await onAccount(account);
        if (rule.stopNow) return () => true;
        const stop = stopper(rule);
        return (row) => stop(row[POST_ID_KEY]);
      },
    }),

  fetch: ({ accountDir, posts, plan, session, onPost }) =>
    fetchPosts({
      accountDir,
      posts,
      handle: plan.account?.handle,
      cookies: session,
      bin: toolPath('gallery-dl'),
      onPost,
    }),
  afterFetch: refreshAssets,

  platformCounts: (counts) => ({
    found_files: counts.foundFiles,
    fetch_files: counts.fetchFiles,
    images: counts.images,
    videos: counts.videos,
  }),
  planNotes: ({ incremental, result, threshold }) => [
    sweepNote({ incremental, stoppedEarly: result.stoppedEarly, threshold }),
  ],
  progressLabel: ({ post, plan, done, total, ok }) =>
    ok
      ? `[x] ${done}/${total} — ${post.tweetId}`
      : `[x] failed: ${permalink(post.handle || plan.account?.handle, post.tweetId)}`,

  refusals: {
    badId: (id) =>
      new Refusal(
        'bad-account-id',
        `X reported an account id this skill will not use as a folder name: ${JSON.stringify(id)}`,
        { details: { id } },
      ),
    empty: () =>
      new Refusal(
        'empty',
        'found no media posts there — an account can genuinely have none, and it also ' +
          'looks like this when the account is protected or the saved session has expired without saying so',
      ),
    unidentified: () =>
      new Refusal(
        'unidentified-account',
        'the timeline was readable but never named the account, so there is no id to file it under',
      ),
  },
};

export const main = (argv, overrides = {}) => runAccount(ADAPTER, argv, overrides);

if (isMainModule(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
