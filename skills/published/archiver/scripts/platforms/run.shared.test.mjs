/**
 * The run behaviours every gallery-dl platform owes, asserted of each of them.
 *
 * These are decisions the run makes the same way whoever is being archived —
 * what `--go` may act on, when the account folder is settled, what an alias
 * does, what order the environment and the session are reached in. A platform
 * suite beside this one holds what is that platform's alone: its own counts,
 * its own refusal codes, the shape of its listing.
 *
 * One bench per platform, and every case runs against all of them. A behaviour
 * asserted here of one platform and not the others is the hole this file
 * exists to close.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, realpathSync } from 'node:fs';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { main as xMain } from './x/run.mjs';
import { fetchPosts as xFetch, postDir as xPostDir } from './x/fetch.mjs';
import { main as igMain } from './instagram/run.mjs';
import { fetchPosts as igFetch, postDir as igPostDir } from './instagram/fetch.mjs';

import { recordIdentity } from '../shared/account.mjs';
import { descriptorFor } from '../shared/platforms.mjs';
import { EXIT } from '../shared/exit.mjs';
import { Refusal } from '../shared/errors.mjs';
import { buildPlan } from '../shared/plan.mjs';
import { savePlan } from '../shared/sync.mjs';
import { archiveCounts } from '../shared/output.mjs';
import { buildPost, writePost } from '../shared/post.mjs';
import { capture, emitted } from '../testing.mjs';

// ---- the benches ------------------------------------------------------------

const X = {
  name: 'x',
  main: xMain,
  url: 'https://x.com/jack',
  handle: 'jack',
  id: '55',
  idKey: 'tweetId',
  boxes: ['runtime', 'tools'],
  postDir: xPostDir,
  fetchPosts: xFetch,
  account: { id: '55', handle: 'jack', nickname: 'Jack', avatar: '', banner: '' },
  identity: { id: '55', handle: 'jack' },
  ids: ['1', '2', '3'],
  row: (tweetId) => ({
    tweetId,
    num: 1,
    ext: 'jpg',
    mediaId: `m${tweetId}`,
    type: 'photo',
    url: `https://pbs.twimg.com/${tweetId}.jpg`,
    date: '2024-03-11T09:22:19Z',
    user: { id: '55', name: 'jack', nick: 'Jack', avatar: '', banner: '' },
    replyId: '',
    content: '',
  }),
  listed: (rows) => ({ rows, stoppedEarly: false }),
  post: (tweetId) => ({ tweetId, date: '2024-03-11T09:22:19Z', content: '', files: [] }),
};

const INSTAGRAM = {
  name: 'instagram',
  main: igMain,
  url: 'https://www.instagram.com/someone',
  handle: 'someone',
  id: '55',
  idKey: 'shortcode',
  boxes: ['runtime', 'tools'],
  postDir: igPostDir,
  fetchPosts: igFetch,
  account: { id: '55', username: 'someone', nickname: 'Some One' },
  identity: { id: '55', username: 'someone' },
  ids: ['AAA', 'BBB', 'CCC'],
  row: (shortcode) => ({
    shortcode,
    num: 1,
    count: 1,
    ext: 'jpg',
    mediaId: `m${shortcode}`,
    type: 'GraphImage',
    url: `https://scontent.cdninstagram.com/${shortcode}.jpg`,
    date: '2024-03-11 07:22:19',
    user: { id: '55', name: 'someone', nick: 'Some One' },
    content: '',
    category: 'posts',
  }),
  listed: (rows) => ({
    rows,
    sweeps: [
      { category: 'posts', stoppedEarly: false },
      { category: 'reels', stoppedEarly: false },
    ],
  }),
  post: (shortcode) => ({ shortcode, date: '2024-03-11 07:22:19', content: '', files: [] }),
};

const BENCHES = [X, INSTAGRAM];

// ---- the harness ------------------------------------------------------------

// Realpath'd, because normalizeRoot does: on macOS /var is a symlink to
// /private/var, and a plan made one way would be refused the other.
const archivesRoot = async () => realpathSync(await mkdtemp(path.join(os.tmpdir(), 'shared-run-')));

const collected = (bench, over = {}) => ({
  account: bench.account,
  failure: null,
  stderr: '',
  code: 0,
  ...bench.listed(bench.ids.slice(0, 2).map(bench.row)),
  ...over,
});

function overrides(bench, over = {}) {
  const listing = over.collect ?? (async () => collected(bench));
  return {
    // Lands each post the way the real fetcher does — post.json written, media
    // listed and present — because the run reports its total by asking the
    // folder, and a fetcher that wrote nothing would be reporting on nothing.
    fetch: async ({ accountDir, posts }) => {
      for (const post of posts) {
        await writePost(bench.postDir(accountDir, post), buildPost({ id: post[bench.idKey] }));
      }
      return { fetched: { posts: posts.length, files: posts.length }, failed: 0, stopped: null };
    },
    onPath: async () => true,
    session: async () => '/tmp/cookies.txt',
    ensureEnv: async () => {},
    ...over,
    // Wrapped last, so a test's own listing still goes through the account
    // callback. That callback is what settles the folder and reads the archive,
    // so a listing that never fired it would exercise none of doPlan's real work.
    collect: async (args) => {
      const result = await listing(args);
      if (result.account && args.onAccount) await args.onAccount(result.account);
      return result;
    },
  };
}

const run = (bench, argv, over = {}) => emitted(bench.main, argv, overrides(bench, over));

const accountDirIn = (root, bench, name = bench.id) => path.join(root, bench.name, name);

const syncJson = async (dir) => JSON.parse(await readFile(path.join(dir, 'sync.json'), 'utf8'));
const accountJson = async (dir) => JSON.parse(await readFile(path.join(dir, 'account.json'), 'utf8'));

/** An account folder with a plan parked in it, which is what a bare `--go` acts on. */
async function parked(bench, root, { collected: seen, pending, counts } = {}) {
  const accountDir = accountDirIn(root, bench);
  await mkdir(accountDir, { recursive: true });

  // A bare --go knows only the URL, so the folder has to be findable by it.
  await recordIdentity(descriptorFor(bench.name), root, accountDir, {
    account: bench.identity,
    url: bench.url,
  });

  await savePlan(
    accountDir,
    buildPlan({
      account: bench.identity,
      root,
      collected: seen,
      pending,
      counts:
        counts ??
        archiveCounts({ found: seen.length, onDisk: seen.length - pending.length, toFetch: pending.length }),
      now: new Date(),
    }),
  );

  return accountDir;
}

/** A `--go` against that parked plan, through the real fetcher over a downloader that succeeds. */
async function go(bench, root, plan = {}, over = {}) {
  const accountDir = await parked(bench, root, plan);
  const { document } = await run(bench, [bench.url, '--archives', root, '--go'], {
    // The real fetcher against a downloader that succeeds and writes nothing,
    // because what is being asserted is which folders it makes. The pacing
    // between posts is real and is asserted in each platform's fetch tests.
    fetch: (args) => bench.fetchPosts({ ...args, bin: '/usr/bin/true', intervalMs: 0 }),
    ...over,
  });
  return { accountDir, document };
}

// ---- the cases --------------------------------------------------------------

for (const bench of BENCHES) {
  const at = (title) => `[${bench.name}] ${title}`;

  // ---- what --go may act on -------------------------------------------------

  test(at('--go without an archive under this root is refused, and says how to make one'), async () => {
    const root = await archivesRoot();
    const { document } = await run(bench, [bench.url, '--archives', root, '--go']);

    assert.equal(document.exit, EXIT.REFUSED);
    assert.equal(document.error.code, 'no-archive');
    assert.equal(document.error.details.root, root);
    assert.match(document.error.remedy.command, /--plan$/);
    assert.equal(document.error.remedy.run_by, 'agent');
  });

  test(at('--go against an archive with no plan hands back the command that makes one'), async () => {
    const root = await archivesRoot();
    const accountDir = accountDirIn(root, bench);
    await mkdir(accountDir, { recursive: true });
    await recordIdentity(descriptorFor(bench.name), root, accountDir, {
      account: bench.identity,
      url: bench.url,
    });

    const { document } = await run(bench, [bench.url, '--archives', root, '--go']);

    assert.equal(document.ok, false);
    assert.equal(document.error.code, 'plan-missing');
    assert.match(document.error.remedy.command, /--plan$/);
    assert.equal(document.error.remedy.run_by, 'agent');
  });

  test(at('--go fetches what the plan counted, not everything the listing saw'), async () => {
    const root = await archivesRoot();
    const [seen, alsoSeen, fresh] = bench.ids.map(bench.post);

    const { accountDir } = await go(bench, root, {
      collected: [seen, alsoSeen, fresh],
      pending: [fresh],
    });

    assert.equal(existsSync(bench.postDir(accountDir, fresh)), true, 'the approved post was fetched');
    assert.equal(existsSync(bench.postDir(accountDir, seen)), false, 'one the plan did not list was not');
  });

  test(at('a plan is retired once every post in it has landed'), async () => {
    const root = await archivesRoot();
    const fresh = bench.post(bench.ids[2]);

    const { accountDir, document } = await go(bench, root, {
      collected: [bench.post(bench.ids[0]), fresh],
      pending: [fresh],
    });

    assert.equal(document.result.run.remaining, 0);
    assert.equal((await syncJson(accountDir)).plan ?? null, null);
  });

  test(at('a resumed --go reports the archive, not its own increment'), async () => {
    // The plan's on_disk is frozen at plan time. Plan finds two with none on
    // disk; a second --go over the same plan fetches nothing and must still
    // report the two the folder holds.
    const root = await archivesRoot();
    const both = [bench.post(bench.ids[0]), bench.post(bench.ids[1])];

    await go(bench, root, { collected: both, pending: both });

    const { document } = await go(bench, root, {
      collected: both,
      pending: both,
      counts: archiveCounts({ found: 2, onDisk: 0, toFetch: 2 }),
    });

    assert.equal(document.result.run.downloaded, 0, 'nothing was left to fetch');
    assert.equal(document.result.run.total, 2, 'and the archive holds two');
  });

  test(at('a --go carries no plan window, because the list was already approved'), async () => {
    const root = await archivesRoot();
    const fresh = bench.post(bench.ids[2]);
    const { document } = await go(bench, root, { collected: [fresh], pending: [fresh] });

    assert.equal(document.result.plan ?? null, null);
  });

  // ---- the account folder ---------------------------------------------------

  test(at('the account folder is the immutable id, not the handle that can change'), async () => {
    const root = await archivesRoot();
    await run(bench, [bench.url, '--archives', root, '--yes']);

    assert.equal(existsSync(accountDirIn(root, bench)), true);
    assert.equal(existsSync(accountDirIn(root, bench, bench.handle)), false);
  });

  test(at('account.json records the identity before anything is downloaded'), async () => {
    const root = await archivesRoot();
    let written = null;
    await run(bench, [bench.url, '--archives', root, '--yes'], {
      fetch: async ({ accountDir, posts }) => {
        written = await accountJson(accountDir);
        for (const post of posts) {
          await writePost(bench.postDir(accountDir, post), buildPost({ id: post[bench.idKey] }));
        }
        return { fetched: { posts: posts.length, files: posts.length }, failed: 0, stopped: null };
      },
    });

    assert.equal(written?.platform, bench.name);
    assert.equal(written?.account.id, bench.id);
  });

  test(at('a new account given an alias is created under it, with nothing to move'), async () => {
    const root = await archivesRoot();
    const { document } = await run(bench, [bench.url, '--archives', root, '--alias', 'mine', '--yes']);

    assert.equal(document.ok, true);
    assert.equal(existsSync(accountDirIn(root, bench, 'mine')), true);
    assert.equal((await accountJson(accountDirIn(root, bench, 'mine'))).account.alias, 'mine');
  });

  test(at('an alias renames on the download step, and is announced before it happens'), async () => {
    const root = await archivesRoot();
    await run(bench, [bench.url, '--archives', root, '--yes']);
    assert.equal(existsSync(accountDirIn(root, bench)), true);

    // --plan announces the move and moves nothing.
    const { document: planned } = await run(bench, [bench.url, '--archives', root, '--alias', 'mine', '--plan']);
    assert.equal(planned.result.notes.some((note) => note.code === 'moving-to'), true);
    assert.equal(existsSync(accountDirIn(root, bench, 'mine')), false, '--plan moves nothing');

    await run(bench, [bench.url, '--archives', root, '--alias', 'mine', '--yes']);
    assert.equal(existsSync(accountDirIn(root, bench, 'mine')), true);
    assert.equal(existsSync(accountDirIn(root, bench)), false);
  });

  test(at('one post id in two folders is reported'), async () => {
    const root = await archivesRoot();
    const id = bench.ids[0];
    const accountDir = accountDirIn(root, bench);

    // The same id filed once undated and once under a date: one of them answers
    // for nothing, and its media is counted by nothing.
    await writePost(path.join(accountDir, 'posts', `undated_${id}`), buildPost({ id }));
    await writePost(path.join(accountDir, 'posts', `2024-03-11_${id}`), buildPost({ id }));
    await recordIdentity(descriptorFor(bench.name), root, accountDir, {
      account: bench.identity,
      url: bench.url,
    });

    const fresh = bench.post(bench.ids[2]);
    const { document } = await go(bench, root, { collected: [fresh], pending: [fresh] });

    const note = document.result.notes.find((one) => one.code === 'duplicate-posts');
    assert.equal(note?.count, 1);
  });

  // ---- what a re-run says ---------------------------------------------------

  test(at('a second run finds nothing new and says so without asking'), async () => {
    const root = await archivesRoot();
    await run(bench, [bench.url, '--archives', root, '--yes']);

    const { document } = await run(bench, [bench.url, '--archives', root, '--yes']);

    assert.equal(document.ok, true);
    assert.equal(document.result.counts.to_fetch, 0);
    assert.equal(document.result.run.downloaded, 0);
  });

  test(at('an interrupted download plus an expired plan is not reported as up to date forever'), async () => {
    // The plan is stale and one post never landed. Re-planning must find that
    // post outstanding rather than reading the archive as complete.
    const root = await archivesRoot();
    const accountDir = accountDirIn(root, bench);
    await mkdir(accountDir, { recursive: true });
    await recordIdentity(descriptorFor(bench.name), root, accountDir, {
      account: bench.identity,
      url: bench.url,
    });

    const stale = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const posts = bench.ids.slice(0, 2).map(bench.post);
    await savePlan(
      accountDir,
      buildPlan({
        account: bench.identity,
        root,
        collected: posts,
        pending: posts,
        counts: archiveCounts({ found: 2, onDisk: 0, toFetch: 2 }),
        now: stale,
      }),
    );

    const { document } = await run(bench, [bench.url, '--archives', root, '--plan']);

    assert.equal(document.result.counts.to_fetch, 2, 'the unfetched posts are still outstanding');
  });

  // ---- the order things are reached in --------------------------------------

  test(at('the environment is built before the session is read out of a browser'), async () => {
    // Reading a browser profile prompts for Keychain access and wants the
    // browser closed. Paying that for a run that cannot proceed is the wrong
    // order.
    const root = await archivesRoot();
    let readCookies = false;
    const { document } = await run(bench, [bench.url, '--archives', root, '--plan'], {
      ensureEnv: async () => {
        throw new Refusal('env-build-failed', 'no network', {
          details: { boxes: ['tools'], dir: '/cache', output: '' },
          remedy: { message: 'try again', run_by: 'user' },
        });
      },
      session: async () => {
        readCookies = true;
        return '/tmp/cookies.txt';
      },
    });

    assert.equal(document.exit, EXIT.FAILED);
    assert.equal(document.error.code, 'env-build-failed');
    assert.equal(readCookies, false);
  });

  test(at('the first run asks before downloading anything, and names only the boxes it needs'), async () => {
    const root = await archivesRoot();
    const { document } = await run(bench, [bench.url, '--archives', root, '--plan'], {
      ensureEnv: async (boxes, { platform }) => {
        assert.deepEqual(boxes, bench.boxes, 'no browser box is asked for');
        assert.equal(platform, bench.name);
        throw new Refusal('env-consent', 'nothing built yet', {
          details: { boxes, download_mb: 150, dir: '/cache' },
          remedy: { message: 'ask first', command: '/skill/setup.sh', run_by: 'agent' },
        });
      },
    });

    assert.equal(document.exit, EXIT.REFUSED);
    assert.equal(document.error.code, 'env-consent');
    assert.equal(document.error.remedy.run_by, 'agent');
  });

  test(at('a session refusal stops the run before anything is collected'), async () => {
    const root = await archivesRoot();
    let listed = false;
    const { document } = await run(bench, [bench.url, '--archives', root, '--plan'], {
      session: async () => {
        throw new Refusal('session-missing', 'no session', { details: {} });
      },
      collect: async () => {
        listed = true;
        return collected(bench);
      },
    });

    assert.equal(document.ok, false);
    assert.equal(document.error.code, 'session-missing');
    assert.equal(listed, false);
  });

  // ---- the command line -----------------------------------------------------

  test(at('every flag the usage text offers is declared, and the ones taking a value consume it'), async () => {
    // Asked of main() rather than of the parser, because the parser is only ever
    // as right as the sets it is handed and this is where they are handed to it.
    //
    // Each flag leads the command line so a value has somewhere wrong to go: a
    // flag that takes one and is not declared as taking one leaves its value in
    // the positional list, where it is read as the URL and refused as one.
    const root = await archivesRoot();
    const { stdout } = await capture(() => bench.main(['--help']));
    const offered = [...stdout.matchAll(/^\s+(?:-\w, )?(--[a-z-]+)(?: ([A-Z]+))?(?=,|\s{2,}|$)/gm)];
    assert.ok(offered.length > 3, 'the usage text offers flags');

    const values = { '--archives': root, '--alias': 'mine', '--browser': 'chrome', '--cookies': '/tmp/c.txt' };

    for (const [, flag, takesValue] of offered) {
      if (flag === '--help') continue;
      const argv = [
        flag,
        ...(takesValue ? [values[flag] ?? 'value'] : []),
        bench.url, '--archives', root, '--plan',
      ];
      const { document } = await run(bench, argv);
      const code = document.error?.code ?? null;
      assert.notEqual(code, 'unknown-flag', `${flag} is declared`);
      assert.ok(!String(code).startsWith('url-'), `${flag} consumes its own value rather than leaving it as the URL`);
    }
  });
}
