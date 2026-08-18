/**
 * Tests for run.mjs — the orchestration.
 *
 * What is written, in what order, what is refused before anything is written at
 * all, and what the run says about it. The browser, yt-dlp and the network are
 * injected, so these assert on the run's decisions rather than on what happens
 * to be installed.
 *
 * Every run goes through `emitted`, which takes the one document off stdout and
 * validates it against the output schema — so schema conformance is asserted on
 * every document every test here produces.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, realpathSync } from 'node:fs';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { main } from './run.mjs';
import { postDir } from './fetch.mjs';
import { EXIT } from '../shared/exit.mjs';
import { Refusal } from '../shared/errors.mjs';
import { buildPost, writePost } from '../shared/post.mjs';
import { savePlan } from '../shared/sync.mjs';
import { emitted } from '../testing.mjs';

// Realpath'd, because normalizeRoot does: on macOS /var is a symlink to
// /private/var, and a plan made one way would be refused the other.
const root = async () => realpathSync(await mkdtemp(path.join(os.tmpdir(), 'douyin-run-')));
const URL_MS4W = 'https://www.douyin.com/user/MS4wSEC';

const post = (id, over = {}) => ({ id, text: '', createTime: 1710144139, ...over });

/** One post on disk and complete — a post.json listing no media lists nothing missing. */
const land = (accountDir, p) => writePost(postDir(accountDir, p), buildPost({ id: p.id }));

/** A listing pass that answers from memory. */
const listing = (over = {}) => ({
  posts: [post('7111'), post('7222')],
  account: { id: 'MS4wSEC', douyin_id: 'abc123', nickname: '小明' },
  reported: 284,
  skippedImagePosts: 0,
  hitRoundLimit: false,
  described: 2,
  ...over,
});

function deps(over = {}) {
  return {
    collectImpl: async () => listing(),
    fetchImpl: async () => ({ fetched: 0, failed: 0, undescribed: 0 }),
    loginImpl: async () => ({ ok: true }),
    playwrightImpl: async () => ({ chromium: {} }),
    hasSessionImpl: async () => true,
    mintImpl: async () => '/tmp/cookies.txt',
    // No cached session by default, so a test says so when it means to have one.
    freshCookiesImpl: async () => false,
    discardCookiesImpl: async () => {},
    onPathImpl: async () => true,
    ensureEnvImpl: async () => {},
    discardImpl: async () => {},
    ...over,
  };
}

const run = (argv, over = {}) => emitted(main, argv, deps(over));

const accountJson = async (folder) =>
  JSON.parse(await readFile(path.join(folder, 'account.json'), 'utf8'));
const syncJson = async (folder) =>
  JSON.parse(await readFile(path.join(folder, 'sync.json'), 'utf8'));

const noteWith = (document, code) => document.result.notes.find((note) => note.code === code);

// ---- the envelope -----------------------------------------------------------

test('a plan answers in one document, naming the command and the platform', async () => {
  const dir = await root();
  const { document, stdout } = await run([URL_MS4W, '--archives', dir, '--plan']);

  assert.equal(document.schema, 1);
  assert.equal(document.ok, true);
  assert.equal(document.command, 'plan');
  assert.equal(document.platform, 'douyin');
  assert.equal(document.exit, EXIT.OK);
  assert.deepEqual(JSON.parse(stdout), document, 'stdout holds the document and nothing else');
});

test('the account arrives as fields rather than a rendered headline', async () => {
  const dir = await root();
  const { document } = await run([URL_MS4W, '--archives', dir, '--plan']);

  assert.deepEqual(document.result.account, {
    id: 'MS4wSEC',
    douyin_id: 'abc123',
    nickname: '小明',
    url: URL_MS4W,
  });
});

test('counts are raw integers, and the platform ones sit beside them', async () => {
  const dir = await root();
  const { document } = await run([URL_MS4W, '--archives', dir, '--plan'], {
    collectImpl: async () => listing({ reported: 284, skippedImagePosts: 3 }),
  });

  assert.deepEqual(document.result.counts, {
    found: 2,
    on_disk: 0,
    to_fetch: 2,
    platform: { reported: 284, skipped_image_posts: 3, unlisted: 0 },
  });
});

test('a plan carries when it was made and when it stops being one', async () => {
  // So that nobody does TTL arithmetic against a 24-hour rule themselves.
  const dir = await root();
  const { document } = await run([URL_MS4W, '--archives', dir, '--plan']);

  const window = document.result.plan;
  assert.equal(Date.parse(window.expires_at) - Date.parse(window.created_at), 24 * 3600 * 1000);
});

test('a plan with work to do hands over the exact next command, flags and all', async () => {
  // Rebuilt from the command line as given, so the archives root the user chose
  // cannot be silently dropped on the way to the next step.
  const dir = await root();
  const { document } = await run([URL_MS4W, '--archives', dir, '--alias', '小明', '--plan']);

  assert.equal(document.result.next.run_by, 'agent');
  assert.match(document.result.next.command, /--go$/);
  assert.ok(document.result.next.command.includes(dir), 'the archives root survives');
  assert.ok(document.result.next.command.includes('小明'), 'so does the alias');
  assert.doesNotMatch(document.result.next.command, /--plan/);
});

test('nothing to fetch is a count of zero and no next step', async () => {
  const dir = await root();
  const { document } = await run([URL_MS4W, '--archives', dir, '--plan'], {
    collectImpl: async () => listing({ posts: [] }),
  });

  assert.equal(document.result.counts.to_fetch, 0);
  assert.equal(document.result.next, undefined, 'there is nothing to approve');
  assert.equal(document.exit, EXIT.OK);
});

test('progress goes to stderr, so it never lands in the middle of the document', async () => {
  const dir = await root();
  const { stderr, stdout } = await run([URL_MS4W, '--archives', dir, '--plan']);

  assert.match(stderr, /collecting post IDs/);
  assert.doesNotMatch(stdout, /collecting post IDs/);
});

test('the in-place counter is suppressed when nothing is a terminal', async () => {
  // Those messages exist to show a human that a long run is still going. Off a
  // terminal there is nobody watching, and a thousand-post download would fill
  // the reader's context with a counter.
  const dir = await root();
  const { stderr } = await run([URL_MS4W, '--archives', dir, '--plan'], {
    collectImpl: async ({ log }) => {
      log('[douyin] 40 posts…', { progress: true });
      log('[douyin] opening profile…');
      return listing();
    },
  });

  assert.doesNotMatch(stderr, /40 posts/);
  assert.match(stderr, /opening profile/, 'the discrete steps still land');
});

// ---- what a plan writes -----------------------------------------------------

test('a plan records the account before anything is downloaded', async () => {
  // account.json is written the moment the folder is known, so a folder that
  // exists always says whose it is.
  const dir = await root();
  const { document } = await run([URL_MS4W, '--archives', dir, '--plan']);

  assert.equal(document.exit, EXIT.OK);
  const folder = path.join(dir, 'douyin', 'MS4wSEC');
  const json = await accountJson(folder);
  assert.equal(json.account.id, 'MS4wSEC');
  assert.equal(json.account.douyin_id, 'abc123');
  assert.equal(json.account.nickname, '小明');
  assert.equal(json.url, URL_MS4W);
});

test('a plan downloads nothing', async () => {
  const dir = await root();
  let fetched = false;
  await run([URL_MS4W, '--archives', dir, '--plan'], {
    fetchImpl: async () => ((fetched = true), { fetched: 0, failed: 0 }),
  });
  assert.equal(fetched, false);
});

test('an account new to the archive is created under its alias straight away', async () => {
  const dir = await root();
  const { document } = await run([URL_MS4W, '--archives', dir, '--alias', '小明', '--plan']);

  assert.ok(existsSync(path.join(dir, 'douyin', '小明')));
  assert.ok(!existsSync(path.join(dir, 'douyin', 'MS4wSEC')), 'no second, empty archive beside it');
  // There is nowhere to move from, so nothing is announced as moving.
  assert.equal(noteWith(document, 'moving-to'), undefined);
});

test('a plan says where --alias would move an existing folder, and moves nothing', async () => {
  // The move is reported and performed on --go, never before: a preview that
  // silently reorganised the archive would be a preview that lied.
  const dir = await root();
  await run([URL_MS4W, '--archives', dir, '--plan']);

  const { document } = await run([URL_MS4W, '--archives', dir, '--alias', '小明', '--plan']);
  assert.equal(noteWith(document, 'moving-to').dir, path.join(dir, 'douyin', '小明'));
  assert.ok(existsSync(path.join(dir, 'douyin', 'MS4wSEC')), 'still where it was');
  assert.ok(!existsSync(path.join(dir, 'douyin', '小明')));
});

test('an archive whose root has moved says where the last run put it', async () => {
  // Left unsaid, a run against a different root starts a second archive in
  // silence, and its on_disk of zero reads as an account that has lost its files.
  const first = await root();
  const second = await root();
  await run([URL_MS4W, '--archives', first, '--yes'], {
    fetchImpl: async ({ posts }) => ({ fetched: posts.length, failed: 0 }),
  });
  await cp(path.join(first, 'douyin'), path.join(second, 'douyin'), { recursive: true });

  const { document } = await run([URL_MS4W, '--archives', second, '--plan']);
  assert.equal(noteWith(document, 'root-changed').previous, first);

  // The note is about the last run, and only a run that downloads records one.
  await run([URL_MS4W, '--archives', second, '--go'], {
    fetchImpl: async ({ posts }) => ({ fetched: posts.length, failed: 0 }),
  });
  const again = await run([URL_MS4W, '--archives', second, '--plan']);
  assert.equal(noteWith(again.document, 'root-changed'), undefined, 'a root that has not moved says nothing');
});

test('--go performs the move the plan announced, before downloading', async () => {
  const dir = await root();
  await run([URL_MS4W, '--archives', dir, '--plan']);
  await run([URL_MS4W, '--archives', dir, '--alias', '小明', '--plan']);

  let fetchedInto = null;
  await run([URL_MS4W, '--archives', dir, '--alias', '小明', '--go'], {
    fetchImpl: async ({ accountDir }) => ((fetchedInto = accountDir), { fetched: 2, failed: 0 }),
  });

  assert.equal(fetchedInto, path.join(dir, 'douyin', '小明'));
  assert.ok(!existsSync(path.join(dir, 'douyin', 'MS4wSEC')));

  // The move is only half of it. Without the mapping, the folder is a directory
  // archiver.json does not name — which reads as another account's id, so the
  // user is refused their own alias from then on, permanently.
  const map = JSON.parse(await readFile(path.join(dir, 'archiver.json'), 'utf8'));
  assert.equal(map.accounts.douyin.MS4wSEC, '小明');

  const again = await run([URL_MS4W, '--archives', dir, '--alias', '小明', '--plan']);
  assert.equal(again.document.ok, true, 'the alias is still the account’s own on the next run');
});

test('an account keeps its own alias when archiver.json is gone', async () => {
  // Deleting archiver.json is documented as safe: it is a cache the tree can
  // rebuild. What must not happen is the rebuild reading the account's own
  // folder as somebody else's id and refusing the name from then on.
  const dir = await root();
  await run([URL_MS4W, '--archives', dir, '--alias', '小明', '--plan']);
  await run([URL_MS4W, '--archives', dir, '--alias', '小明', '--go'], {
    fetchImpl: async ({ posts }) => ({ fetched: posts.length, failed: 0 }),
  });

  await rm(path.join(dir, 'archiver.json'));

  const { document } = await run([URL_MS4W, '--archives', dir, '--alias', '小明', '--plan']);
  assert.equal(document.ok, true, document.error?.message);
  assert.equal(document.result.dir, path.join(dir, 'douyin', '小明'));
});

test('account.json holds identity and no progress', async () => {
  // It is authoritative for who this is and never for what has landed — that is
  // answered by the post folders alone.
  const dir = await root();
  await run([URL_MS4W, '--archives', dir, '--plan']);
  const json = await accountJson(path.join(dir, 'douyin', 'MS4wSEC'));

  assert.deepEqual(Object.keys(json.account).sort(), ['douyin_id', 'id', 'nickname']);
  assert.ok(!('downloaded' in json));
  assert.ok(!('archives_root' in json));
});

test('the plan is parked where --go will look for it', async () => {
  const dir = await root();
  await run([URL_MS4W, '--archives', dir, '--plan']);
  const sync = await syncJson(path.join(dir, 'douyin', 'MS4wSEC'));

  assert.equal(sync.plan.account.id, 'MS4wSEC');
  assert.equal(sync.plan.root, dir);
  assert.deepEqual(sync.plan.pending.map((p) => p.id), ['7111', '7222']);
});

test('a plan with nothing pending replaces the last one, and --go says so by name', async () => {
  // The plan is parked whether or not anything is pending, so a plan an earlier
  // run left behind cannot outlive the work it described. What a bare --go then
  // meets is `plan-empty` — the same code X answers with, rather than a second
  // code for one situation.
  const dir = await root();
  const { document } = await run([URL_MS4W, '--archives', dir, '--plan'], {
    collectImpl: async () => listing({ posts: [] }),
  });

  assert.equal(document.result.counts.to_fetch, 0);
  const sync = await syncJson(path.join(dir, 'douyin', 'MS4wSEC'));
  assert.deepEqual(sync.plan.pending, []);

  const go = await run([URL_MS4W, '--archives', dir, '--go']);
  assert.equal(go.document.error.code, 'plan-empty');
});

// ---- what --go refuses ------------------------------------------------------

test('--go without a plan is refused, with the plan command as the remedy', async () => {
  const dir = await root();
  const { document } = await run([URL_MS4W, '--archives', dir, '--go']);

  assert.equal(document.exit, EXIT.REFUSED);
  assert.equal(document.error.code, 'no-archive');
  assert.equal(document.error.details.root, dir);
  assert.equal(document.error.remedy.run_by, 'agent');
  assert.match(document.error.remedy.command, /--plan$/);
});

test('--go refuses a plan made for another archives root, and names it', async () => {
  // Downloading it would fetch a list the user approved somewhere else.
  const dir = await root();
  await run([URL_MS4W, '--archives', dir, '--plan']);
  const folder = path.join(dir, 'douyin', 'MS4wSEC');
  const sync = await syncJson(folder);
  await savePlan(folder, { ...sync.plan, root: '/somewhere/else' });

  const { document } = await run([URL_MS4W, '--archives', dir, '--go']);
  assert.equal(document.exit, EXIT.REFUSED);
  assert.equal(document.error.code, 'plan-foreign-root');
  assert.equal(document.error.details.plan_root, '/somewhere/else');
});

test('--go refuses a plan past its day, and says how old it is as a number', async () => {
  const dir = await root();
  await run([URL_MS4W, '--archives', dir, '--plan']);
  const folder = path.join(dir, 'douyin', 'MS4wSEC');
  const sync = await syncJson(folder);
  await savePlan(folder, {
    ...sync.plan,
    created_at: new Date(Date.now() - 30 * 3600 * 1000).toISOString(),
  });

  const { document } = await run([URL_MS4W, '--archives', dir, '--go']);
  assert.equal(document.exit, EXIT.REFUSED);
  assert.equal(document.error.code, 'plan-stale');
  assert.ok(document.error.details.age_hours >= 30);
  assert.equal(document.error.details.ttl_hours, 24);
});

// ---- what --go downloads ----------------------------------------------------

test('--go hands the fetcher exactly the posts the plan listed', async () => {
  const dir = await root();
  await run([URL_MS4W, '--archives', dir, '--plan']);

  let handed = null;
  await run([URL_MS4W, '--archives', dir, '--go'], {
    fetchImpl: async ({ posts }) => ((handed = posts), { fetched: posts.length, failed: 0 }),
  });

  assert.deepEqual(handed.map((p) => p.id), ['7111', '7222']);
  // Whole records, not ids: --go writes every post.json without a browser.
  assert.equal(handed[0].createTime, 1710144139);
});

test('--go fetches what the plan counted, not everything the listing saw', async () => {
  // 7111 is on disk when the plan is made, so one post is counted as new. It
  // then leaves the disk before --go runs. --go re-checks against disk, but only
  // across what was approved, so it still fetches exactly the one.
  const dir = await root();
  const folder = path.join(dir, 'douyin', 'MS4wSEC');
  await land(folder, post('7111'));

  const { document } = await run([URL_MS4W, '--archives', dir, '--plan']);
  assert.equal(document.result.counts.to_fetch, 1);

  await rm(postDir(folder, post('7111')), { recursive: true });

  let handed = null;
  await run([URL_MS4W, '--archives', dir, '--go'], {
    fetchImpl: async ({ posts }) => ((handed = posts), { fetched: posts.length, failed: 0 }),
  });

  assert.deepEqual(handed.map((p) => p.id), ['7222']);
});

test('a finished run reports what landed and what is left', async () => {
  const dir = await root();
  await run([URL_MS4W, '--archives', dir, '--plan']);

  const { document } = await run([URL_MS4W, '--archives', dir, '--go'], {
    fetchImpl: async ({ accountDir, posts }) => {
      for (const p of posts) await land(accountDir, p);
      return { fetched: posts.length, failed: 0 };
    },
  });

  assert.deepEqual(document.result.run, { downloaded: 2, total: 2, failed: 0, remaining: 0 });
  assert.equal(document.exit, EXIT.OK);
});

test('a run that lost posts says how many, and still says what landed', async () => {
  // The plan it keeps is what makes the retry cheap, so the count is all the
  // agent needs to offer one.
  const dir = await root();
  await run([URL_MS4W, '--archives', dir, '--plan']);

  const { document } = await run([URL_MS4W, '--archives', dir, '--go'], {
    fetchImpl: async ({ accountDir, posts }) => {
      await land(accountDir, posts[0]);
      return { fetched: 1, failed: 1 };
    },
  });

  assert.equal(document.result.run.failed, 1);
  assert.equal(document.result.run.downloaded, 1);
  assert.equal(document.result.run.remaining, 1);
  assert.equal(document.exit, EXIT.FAILED, 'the exit shell callers have always seen');
});

test('a plan is retired by what is on disk, not by the fetcher’s own report', async () => {
  // A fetcher that exits clean without writing the files has downloaded
  // nothing. Retiring the plan on its word would cost a second listing to
  // discover that.
  const dir = await root();
  await run([URL_MS4W, '--archives', dir, '--plan']);

  await run([URL_MS4W, '--archives', dir, '--go'], {
    fetchImpl: async ({ posts }) => ({ fetched: posts.length, failed: 0 }),
  });

  const sync = await syncJson(path.join(dir, 'douyin', 'MS4wSEC'));
  assert.ok(sync.plan, 'the plan stays, so the retry needs no new approval');
});

test('a plan is retired once every post in it has landed', async () => {
  const dir = await root();
  await run([URL_MS4W, '--archives', dir, '--plan']);

  await run([URL_MS4W, '--archives', dir, '--go'], {
    fetchImpl: async ({ accountDir, posts }) => {
      for (const p of posts) await land(accountDir, p);
      return { fetched: posts.length, failed: 0 };
    },
  });

  const sync = await syncJson(path.join(dir, 'douyin', 'MS4wSEC'));
  assert.equal(sync.plan ?? null, null);
});

test('--go never collects again', async () => {
  const dir = await root();
  await run([URL_MS4W, '--archives', dir, '--plan']);

  let collected = false;
  await run([URL_MS4W, '--archives', dir, '--go'], {
    collectImpl: async () => ((collected = true), listing()),
  });
  assert.equal(collected, false);
});

test('--yes still says a rename is happening, and which root the last run used', async () => {
  // The user is past being asked, not past being told: a rename they never heard
  // about and an archive that moved are exactly what an unexplained on_disk of
  // zero looks like afterwards.
  const first = await root();
  const second = await root();
  await run([URL_MS4W, '--archives', first, '--yes'], {
    fetchImpl: async ({ posts }) => ({ fetched: posts.length, failed: 0 }),
  });
  await cp(path.join(first, 'douyin'), path.join(second, 'douyin'), { recursive: true });

  const { document } = await run([URL_MS4W, '--archives', second, '--alias', '小明', '--yes'], {
    fetchImpl: async ({ posts }) => ({ fetched: posts.length, failed: 0 }),
  });

  assert.equal(noteWith(document, 'moving-to').dir, path.join(second, 'douyin', '小明'));
  assert.equal(noteWith(document, 'root-changed').previous, first);
});

test('--go carries no plan window, because it is acting on a list already approved', async () => {
  const dir = await root();
  await run([URL_MS4W, '--archives', dir, '--plan']);

  const { document } = await run([URL_MS4W, '--archives', dir, '--go'], {
    fetchImpl: async ({ posts }) => ({ fetched: posts.length, failed: 0 }),
  });

  assert.equal(document.result.plan, undefined);
  assert.equal(noteWith(document, 'moving-to'), undefined, 'nor a move it has already made');
});

test('--yes plans and fetches in one run, and emits exactly one document', async () => {
  const dir = await root();
  let fetched = false;
  const { document, stdout } = await run([URL_MS4W, '--archives', dir, '--yes'], {
    fetchImpl: async ({ posts }) => ((fetched = true), { fetched: posts.length, failed: 0 }),
  });

  assert.equal(document.command, 'yes');
  assert.equal(fetched, true);
  assert.deepEqual(JSON.parse(stdout), document, 'one document, no framing rules needed');
  assert.ok(document.result.plan, '--yes carries the plan window too');
  assert.ok(document.result.run);
});

test('--yes against an account with nothing new still answers once', async () => {
  const dir = await root();
  const { document, stdout } = await run([URL_MS4W, '--archives', dir, '--yes'], {
    collectImpl: async () => listing({ posts: [] }),
  });

  assert.equal(document.result.counts.to_fetch, 0);
  assert.deepEqual(document.result.run, { downloaded: 0, total: 0, failed: 0, remaining: 0 });
  assert.deepEqual(JSON.parse(stdout), document);
});

test('--yes outranks a --plan the skill appended after it', async () => {
  // The skill appends its own mode flag; a user who typed --yes has
  // pre-authorised the run and that must not be taken back.
  const dir = await root();
  let fetched = false;
  await run([URL_MS4W, '--archives', dir, '--yes', '--plan'], {
    fetchImpl: async () => ((fetched = true), { fetched: 1, failed: 0 }),
  });
  assert.equal(fetched, true);
});

// ---- the session ------------------------------------------------------------

test('a run with no session refuses before opening anything', async () => {
  // A cookie's absence is knowable instantly. Without this the user waits half
  // a minute for a grid that renders nothing.
  const dir = await root();
  let collected = false;
  const { document } = await run([URL_MS4W, '--archives', dir, '--plan'], {
    hasSessionImpl: async () => false,
    collectImpl: async () => ((collected = true), listing()),
  });

  assert.equal(document.exit, EXIT.UNAUTHORIZED);
  assert.equal(document.error.code, 'session-missing');
  assert.equal(collected, false);
  assert.equal(document.error.remedy.run_by, 'user', 'only a human can pass this login');
});

test('--login returns a document, so "wait for the user" has a machine answer', async () => {
  // Finishing the sign-in does not start a collection. That coupling is what
  // made an Enter pressed a moment early look exactly like an expired session.
  const dir = await root();
  let collected = false;
  const { document } = await run([URL_MS4W, '--archives', dir, '--login'], {
    collectImpl: async () => ((collected = true), listing()),
  });

  assert.equal(document.command, 'login');
  assert.equal(document.exit, EXIT.OK);
  assert.ok(document.result.profile_dir);
  assert.equal(collected, false);
});

test('a --login that never signed in is not reported as success', async () => {
  const { document } = await run([URL_MS4W, '--login'], {
    loginImpl: async () => ({ ok: false, code: 'login-timed-out', reason: 'gave up waiting for a sign-in', details: { waited_seconds: 600 } }),
  });

  assert.equal(document.exit, EXIT.UNAUTHORIZED);
  assert.equal(document.error.code, 'login-timed-out');
  assert.equal(document.error.details.waited_seconds, 600);
});

test('giving up and running out of time are two codes', async () => {
  const { document } = await run([URL_MS4W, '--login'], {
    loginImpl: async () => ({ ok: false, code: 'login-abandoned', reason: 'the wait was ended' }),
  });
  assert.equal(document.error.code, 'login-abandoned');
});

test('--login needs no yt-dlp and no session', async () => {
  // Signing in is what a user does *because* they have no session, on a machine
  // where the downloader may not be installed yet.
  const { document } = await run([URL_MS4W, '--login'], {
    onPathImpl: async () => false,
    hasSessionImpl: async () => false,
  });
  assert.equal(document.exit, EXIT.OK);
});

test('an empty grid with a post count reads as an expired session', async () => {
  // Never as "up to date": the profile says there are posts, so the grid not
  // rendering is the session, not the account.
  const dir = await root();
  const { document } = await run([URL_MS4W, '--archives', dir, '--plan'], {
    collectImpl: async () => ({ failure: 'empty-grid', reported: 284, account: null }),
  });

  assert.equal(document.exit, EXIT.UNAUTHORIZED);
  assert.equal(document.error.code, 'session-expired-grid');
  assert.equal(document.error.details.reported, 284);
  assert.equal(document.error.remedy.run_by, 'user');
});

test('an empty grid with no post count is a different code', async () => {
  // An account can genuinely have nothing. Handing the sign-in step back to the
  // user is only right when the session is what is wrong.
  const dir = await root();
  const { document } = await run([URL_MS4W, '--archives', dir, '--plan'], {
    collectImpl: async () => ({ failure: 'empty-grid', reported: null, account: null }),
  });

  assert.equal(document.exit, EXIT.EMPTY);
  assert.equal(document.error.code, 'empty-grid');
});

// ---- the command line -------------------------------------------------------

test('a post URL is refused before anything is fetched', async () => {
  const dir = await root();
  const { document } = await run(['https://www.douyin.com/video/7412', '--yes', '--archives', dir]);

  assert.equal(document.exit, EXIT.USAGE);
  assert.equal(document.error.code, 'url-single-post');
  assert.ok(!existsSync(path.join(dir, 'douyin')), 'nothing was written');
});

test('an unknown flag is the user’s typo to see', async () => {
  const { document } = await run([URL_MS4W, '--nonsense']);
  assert.equal(document.exit, EXIT.USAGE);
  assert.equal(document.error.code, 'unknown-flag');
  assert.equal(document.error.details.flag, '--nonsense');
});

test('--alias and --unalias together is refused rather than guessed at', async () => {
  const { document } = await run([URL_MS4W, '--alias', '小明', '--unalias']);
  assert.equal(document.exit, EXIT.USAGE);
  assert.equal(document.error.code, 'alias-and-unalias');
});

test('an unusable alias is refused before the browser opens', async () => {
  const dir = await root();
  let collected = false;
  const { document } = await run([URL_MS4W, '--archives', dir, '--alias', 'has space'], {
    collectImpl: async () => ((collected = true), listing()),
  });

  assert.equal(document.exit, EXIT.USAGE);
  assert.equal(document.error.code, 'alias-invalid');
  assert.equal(document.error.details.alias, 'has space');
  assert.equal(collected, false);
});

test('under the escape hatch a missing downloader still names itself', async () => {
  // The hatch is the one way back to PATH, and the machine it leads to can never
  // be reproduced from here — so the refusal is the entire diagnostic and stays.
  process.env.ARCHIVER_SYSTEM_TOOLS = '1';
  try {
    const dir = await root();
    const { document } = await run([URL_MS4W, '--archives', dir, '--plan'], {
      onPathImpl: async () => false,
    });

    assert.equal(document.exit, EXIT.FAILED);
    assert.equal(document.error.code, 'tool-missing');
    assert.equal(document.error.details.tool, 'yt-dlp');
    assert.equal(document.error.remedy.run_by, 'user', 'nothing here installs anything for anyone');
  } finally {
    delete process.env.ARCHIVER_SYSTEM_TOOLS;
  }
});

test('signing in downloads a browser but never a downloader', async () => {
  // An account nobody can collect yet still needs the browser the login happens
  // in, and yt-dlp is no part of passing a login.
  let asked = null;
  const { document } = await run([URL_MS4W, '--login'], {
    ensureEnvImpl: async (boxes) => {
      asked = boxes;
    },
  });

  assert.equal(document.exit, EXIT.OK);
  assert.deepEqual(asked, ['runtime', 'browser']);
});

test('the first run asks before downloading anything', async () => {
  const dir = await root();
  let collected = false;
  const { document } = await run([URL_MS4W, '--archives', dir, '--plan'], {
    collectImpl: async () => {
      collected = true;
      return listing();
    },
    ensureEnvImpl: async (boxes, { platform }) => {
      assert.deepEqual(boxes, ['runtime', 'tools', 'browser']);
      assert.equal(platform, 'douyin');
      throw new Refusal('env-consent', 'nothing built yet', {
        details: { boxes, download_mb: 320, dir: '/cache' },
        remedy: { message: 'ask first', command: '/skill/setup.sh douyin', run_by: 'agent' },
      });
    },
  });

  assert.equal(document.exit, EXIT.REFUSED);
  assert.equal(document.error.code, 'env-consent');
  assert.equal(document.error.remedy.run_by, 'agent');
  assert.equal(collected, false);
});

// ---- the notes --------------------------------------------------------------

test('the skipped image-post count is a number, and the ticket rides with it', async () => {
  // The rule "say that number out loud when it is not zero" has to key off a
  // number rather than off a sentence.
  const dir = await root();
  const { document } = await run([URL_MS4W, '--archives', dir, '--plan'], {
    collectImpl: async () => listing({ skippedImagePosts: 3 }),
  });

  const note = noteWith(document, 'image-posts-skipped');
  assert.equal(note.count, 3);
  assert.match(note.issue, /issues\/48/);
  assert.equal(document.result.counts.platform.skipped_image_posts, 3);
});

test('a finished run repeats the notes the plan carried', async () => {
  const dir = await root();
  await run([URL_MS4W, '--archives', dir, '--plan'], {
    collectImpl: async () => listing({ skippedImagePosts: 3 }),
  });

  const { document } = await run([URL_MS4W, '--archives', dir, '--go'], {
    fetchImpl: async ({ posts }) => ({ fetched: posts.length, failed: 0 }),
  });

  assert.equal(noteWith(document, 'image-posts-skipped').count, 3);
});

test('a cached session still works, and costs no browser launch', async () => {
  // Minting reads the Playwright profile, which means launching Chromium — the
  // slowest thing in the skill. A --go that mints unconditionally is paying the
  // whole cost of having no cache at all, twice: once to check the profile holds
  // a session and once to export it.
  const dir = await root();
  await run([URL_MS4W, '--archives', dir, '--plan']);

  let launches = 0;
  const { document } = await run([URL_MS4W, '--archives', dir, '--go'], {
    freshCookiesImpl: async () => true,
    hasSessionImpl: async () => (launches++, true),
    mintImpl: async () => (launches++, '/tmp/cookies.txt'),
    fetchImpl: async ({ posts, cookies }) => {
      assert.match(cookies, /cookies\.txt$/, 'the cached file is what yt-dlp is handed');
      return { fetched: posts.length, failed: 0 };
    },
  });

  assert.equal(document.ok, true, document.error?.message);
  assert.equal(launches, 0, 'no browser was opened');
});

test('a session the re-mint could not rescue is thrown away, so the next run mints', async () => {
  const dir = await root();
  await run([URL_MS4W, '--archives', dir, '--plan']);

  let discarded = 0;
  await run([URL_MS4W, '--archives', dir, '--go'], {
    freshCookiesImpl: async () => true,
    discardCookiesImpl: async () => discarded++,
    fetchImpl: async ({ posts }) => ({ fetched: 0, failed: posts.length, sessionStale: true }),
  });

  assert.equal(discarded, 1);
});

test('a rate limit stops the run rather than hammering the limiter', async () => {
  // 750 more yt-dlp invocations, each with --retries 3, against a limiter that
  // has just said no. What is at risk there is the user's account, not the
  // archive — and the run has to say which of the two it stopped for.
  const dir = await root();
  await run([URL_MS4W, '--archives', dir, '--plan']);

  const { document } = await run([URL_MS4W, '--archives', dir, '--go'], {
    fetchImpl: async () => ({ fetched: 0, failed: 0, stopped: 'rate-limited' }),
  });

  assert.equal(document.ok, false);
  assert.equal(document.error.code, 'rate-limited');
  assert.equal(document.error.remedy.run_by, 'agent');
  assert.ok(document.result, 'what did land is still reported');
});

test('a --go whose session mint refuses says so by name, not as a crash', async () => {
  // mintCookies raises session-empty and launchPersistentContext throws on a
  // locked profile. Unguarded, both reach the dispatcher as internal-error with
  // a stack, where the user should have had the code and its remedy.
  const dir = await root();
  await run([URL_MS4W, '--archives', dir, '--plan']);

  const { document } = await run([URL_MS4W, '--archives', dir, '--go'], {
    mintImpl: async () => {
      throw new Refusal('session-empty', 'no douyin.com cookies in the browser profile');
    },
  });

  assert.equal(document.error.code, 'session-empty');
  assert.equal(document.exit, EXIT.UNAUTHORIZED);
});

test('a listing that hit the round limit says so in the document', async () => {
  // The flag exists on the collect result and nothing read it, so a truncated
  // listing was reported as a complete one — with a hidden-posts count blaming
  // every post below the cut.
  const dir = await root();
  const { document } = await run([URL_MS4W, '--archives', dir, '--plan'], {
    collectImpl: async () => listing({ hitRoundLimit: true }),
  });

  assert.ok(noteWith(document, 'listing-truncated'), 'the caveat every other count is read under');
});

test('an abbreviated profile count explains no gap', async () => {
  const dir = await root();
  const { document } = await run([URL_MS4W, '--archives', dir, '--plan'], {
    collectImpl: async () => listing({ reported: 12000, reportedRounded: true }),
  });

  assert.equal(noteWith(document, 'hidden-posts'), undefined);
});

test('cards no feed response named are counted rather than collected', async () => {
  const dir = await root();
  const { document } = await run([URL_MS4W, '--archives', dir, '--plan'], {
    collectImpl: async () => listing({ unattributed: 2 }),
  });

  assert.equal(noteWith(document, 'unattributed-posts').count, 2);
});

test('posts that could not be dated reach the document, not just stderr', async () => {
  // 40 posts landing as undated_<id> is something the archive should say out
  // loud. The agent reads stdout; a count that only ever reached stderr is a
  // count nobody sees.
  const dir = await root();
  await run([URL_MS4W, '--archives', dir, '--plan']);

  const { document } = await run([URL_MS4W, '--archives', dir, '--go'], {
    fetchImpl: async ({ posts }) => ({ fetched: posts.length, failed: 0, undated: 2, undescribed: 2 }),
  });

  assert.equal(noteWith(document, 'undated-posts').count, 2);
});

test('a --go repeats the listing’s own caveats, which it cannot recompute', async () => {
  const dir = await root();
  await run([URL_MS4W, '--archives', dir, '--plan'], {
    collectImpl: async () => listing({ hitRoundLimit: true, unattributed: 1 }),
  });

  const { document } = await run([URL_MS4W, '--archives', dir, '--go'], {
    fetchImpl: async ({ posts }) => ({ fetched: posts.length, failed: 0 }),
  });

  assert.ok(noteWith(document, 'listing-truncated'));
  assert.equal(noteWith(document, 'unattributed-posts').count, 1);
});
