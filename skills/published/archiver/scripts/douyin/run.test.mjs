/**
 * Tests for run.mjs — the orchestration.
 *
 * What is written, in what order, and what is refused before anything is
 * written at all. The browser, yt-dlp and the network are injected, so these
 * assert on the run's decisions rather than on what happens to be installed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, realpathSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { main } from './run.mjs';
import { EXIT } from '../shared/exit.mjs';
import { savePlan } from '../shared/sync.mjs';

// Realpath'd, because normalizeRoot does: on macOS /var is a symlink to
// /private/var, and a plan made one way would be refused the other.
const root = async () => realpathSync(await mkdtemp(path.join(os.tmpdir(), 'douyin-run-')));
const URL_MS4W = 'https://www.douyin.com/user/MS4wSEC';

const post = (id, over = {}) => ({ id, text: '', createTime: 1710144139, ...over });

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
    onPathImpl: async () => true,
    ...over,
  };
}

/** Runs main() with its output captured, so a block can be asserted on. */
async function run(argv, over = {}) {
  const out = [];
  const log = console.log;
  const err = console.error;
  console.log = (...args) => out.push(args.join(' '));
  console.error = (...args) => out.push(args.join(' '));
  try {
    const code = await main(argv, deps(over));
    return { code, output: out.join('\n') };
  } finally {
    console.log = log;
    console.error = err;
  }
}

const accountJson = async (folder) =>
  JSON.parse(await readFile(path.join(folder, 'account.json'), 'utf8'));
const syncJson = async (folder) =>
  JSON.parse(await readFile(path.join(folder, 'sync.json'), 'utf8'));

test('a plan records the account before anything is downloaded', async () => {
  // account.json is written the moment the folder is known, so a folder that
  // exists always says whose it is.
  const dir = await root();
  const { code } = await run([URL_MS4W, '--archives', dir, '--plan']);

  assert.equal(code, EXIT.OK);
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
  const { output } = await run([URL_MS4W, '--archives', dir, '--alias', '小明', '--plan']);

  assert.ok(existsSync(path.join(dir, 'douyin', '小明')));
  assert.ok(!existsSync(path.join(dir, 'douyin', 'MS4wSEC')), 'no second, empty archive beside it');
  // There is nowhere to move from, so nothing is announced as moving.
  assert.doesNotMatch(output, /moves to/);
});

test('a plan says where --alias would move an existing folder, and moves nothing', async () => {
  // The move is reported and performed on --go, never before: a preview that
  // silently reorganised the archive would be a preview that lied.
  const dir = await root();
  await run([URL_MS4W, '--archives', dir, '--plan']);

  const { output } = await run([URL_MS4W, '--archives', dir, '--alias', '小明', '--plan']);
  assert.match(output, /moves to.*小明.*on --go/);
  assert.ok(existsSync(path.join(dir, 'douyin', 'MS4wSEC')), 'still where it was');
  assert.ok(!existsSync(path.join(dir, 'douyin', '小明')));
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

test('an account with nothing left to fetch parks no plan', async () => {
  // A plan left over from an earlier run would outlive the work it described,
  // and --go would happily download it.
  const dir = await root();
  const { output } = await run([URL_MS4W, '--archives', dir, '--plan'], {
    collectImpl: async () => listing({ posts: [] }),
  });

  assert.match(output, /to fetch\s+0 — already up to date/);
  const sync = await syncJson(path.join(dir, 'douyin', 'MS4wSEC'));
  assert.equal(sync.plan ?? null, null);
});

test('--go without a plan is refused, and says how to make one', async () => {
  const dir = await root();
  const { code, output } = await run([URL_MS4W, '--archives', dir, '--go']);

  assert.equal(code, EXIT.REFUSED);
  assert.match(output, /no folder for this account/);
  assert.match(output, /--plan/);
});

test('--go refuses a plan made for another archives root', async () => {
  // Downloading it would fetch a list the user approved somewhere else.
  const dir = await root();
  await run([URL_MS4W, '--archives', dir, '--plan']);
  const folder = path.join(dir, 'douyin', 'MS4wSEC');
  const sync = await syncJson(folder);
  await savePlan(folder, { ...sync.plan, root: '/somewhere/else' });

  const { code, output } = await run([URL_MS4W, '--archives', dir, '--go']);
  assert.equal(code, EXIT.REFUSED);
  assert.match(output, /different archives root/);
});

test('--go refuses a plan past its day', async () => {
  const dir = await root();
  await run([URL_MS4W, '--archives', dir, '--plan']);
  const folder = path.join(dir, 'douyin', 'MS4wSEC');
  const sync = await syncJson(folder);
  await savePlan(folder, {
    ...sync.plan,
    created_at: new Date(Date.now() - 30 * 3600 * 1000).toISOString(),
  });

  const { code, output } = await run([URL_MS4W, '--archives', dir, '--go']);
  assert.equal(code, EXIT.REFUSED);
  assert.match(output, /the account may have posted since/);
});

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

test('--go never collects again', async () => {
  const dir = await root();
  await run([URL_MS4W, '--archives', dir, '--plan']);

  let collected = false;
  await run([URL_MS4W, '--archives', dir, '--go'], {
    collectImpl: async () => ((collected = true), listing()),
  });
  assert.equal(collected, false);
});

test('--yes plans and fetches in one run, without stopping', async () => {
  const dir = await root();
  let fetched = false;
  const { code } = await run([URL_MS4W, '--archives', dir, '--yes'], {
    fetchImpl: async ({ posts }) => ((fetched = true), { fetched: posts.length, failed: 0 }),
  });

  assert.equal(code, EXIT.OK);
  assert.equal(fetched, true);
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

test('a run with no session refuses before opening anything', async () => {
  // A cookie's absence is knowable instantly. Without this the user waits half
  // a minute for a grid that renders nothing.
  const dir = await root();
  let collected = false;
  const { code, output } = await run([URL_MS4W, '--archives', dir, '--plan'], {
    hasSessionImpl: async () => false,
    collectImpl: async () => ((collected = true), listing()),
  });

  assert.equal(code, EXIT.UNAUTHORIZED);
  assert.equal(collected, false);
  assert.match(output, /--login/);
});

test('--login signs in and stops, archiving nothing', async () => {
  // Finishing the sign-in does not start a collection. That coupling is what
  // made an Enter pressed a moment early look exactly like an expired session.
  const dir = await root();
  let collected = false;
  const { code } = await run([URL_MS4W, '--archives', dir, '--login'], {
    collectImpl: async () => ((collected = true), listing()),
  });

  assert.equal(code, EXIT.OK);
  assert.equal(collected, false);
});

test('a --login that never signed in is not reported as success', async () => {
  const { code, output } = await run([URL_MS4W, '--login'], {
    loginImpl: async () => ({ ok: false, reason: 'gave up waiting for a sign-in' }),
  });

  assert.equal(code, EXIT.UNAUTHORIZED);
  assert.match(output, /gave up waiting/);
});

test('--login needs no yt-dlp and no session', async () => {
  // Signing in is what a user does *because* they have no session, on a machine
  // where the downloader may not be installed yet.
  const { code } = await run([URL_MS4W, '--login'], {
    onPathImpl: async () => false,
    hasSessionImpl: async () => false,
  });
  assert.equal(code, EXIT.OK);
});

test('a post URL is refused before anything is fetched', async () => {
  const dir = await root();
  const { code, output } = await run(
    ['https://www.douyin.com/video/7412', '--yes', '--archives', dir],
  );

  assert.equal(code, EXIT.USAGE);
  assert.match(output, /not a Douyin profile URL/);
  assert.ok(!existsSync(path.join(dir, 'douyin')), 'nothing was written');
});

test('an empty grid with a post count reads as an expired session', async () => {
  // Never as "up to date": the profile says there are posts, so the grid not
  // rendering is the session, not the account.
  const dir = await root();
  const { code, output } = await run([URL_MS4W, '--archives', dir, '--plan'], {
    collectImpl: async () => ({ failure: 'empty-grid', reported: 284, account: null }),
  });

  assert.equal(code, EXIT.UNAUTHORIZED);
  assert.match(output, /--login/);
});

test('an unknown flag is the user’s typo to see', async () => {
  const { code, output } = await run([URL_MS4W, '--nonsense']);
  assert.equal(code, EXIT.USAGE);
  assert.match(output, /unknown option '--nonsense'/);
});

test('--downloads is refused by name rather than as a generic unknown flag', async () => {
  const { code, output } = await run([URL_MS4W, '--downloads', '/data']);
  assert.equal(code, EXIT.USAGE);
  assert.match(output, /--downloads was renamed to --archives/);
});

test('--alias and --unalias together is refused rather than guessed at', async () => {
  const { code, output } = await run([URL_MS4W, '--alias', '小明', '--unalias']);
  assert.equal(code, EXIT.USAGE);
  assert.match(output, /opposite things/);
});

test('an unusable alias is refused before the browser opens', async () => {
  const dir = await root();
  let collected = false;
  const { code } = await run([URL_MS4W, '--archives', dir, '--alias', 'has space'], {
    collectImpl: async () => ((collected = true), listing()),
  });

  assert.equal(code, EXIT.USAGE);
  assert.equal(collected, false);
});

test('the skipped image-post count reaches the block, and the ticket with it', async () => {
  const dir = await root();
  const { output } = await run([URL_MS4W, '--archives', dir, '--plan'], {
    collectImpl: async () => listing({ skippedImagePosts: 3 }),
  });

  assert.match(output, /3 image posts skipped/);
  assert.match(output, /issues\/48/);
});
