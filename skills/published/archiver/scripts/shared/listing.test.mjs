import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ACCOUNT_VERSION } from './account.mjs';
import { SCHEMA_VERSION } from './archiver.mjs';
import { listArchive, readAccounts } from './listing.mjs';
import { POST_VERSION } from './post.mjs';
import { SYNC_VERSION } from './sync.mjs';

const root = () => mkdtemp(path.join(os.tmpdir(), 'archiver-listing-'));

const NOW = Date.parse('2026-08-17T12:00:00Z');
const hoursAgo = (hours) => new Date(NOW - hours * 60 * 60 * 1000).toISOString();

/**
 * One account folder as the platforms write it: the identity file, however many
 * post folders, and optionally the working file beside them.
 */
async function seed(dir, platform, folder, { id, nickname, url = 'https://x.com/who', posts = [], sync } = {}) {
  const account = path.join(dir, platform, folder);
  await mkdir(account, { recursive: true });
  await writeFile(
    path.join(account, 'account.json'),
    JSON.stringify({
      version: ACCOUNT_VERSION,
      platform,
      account: { id, nickname },
      url,
    }),
  );

  for (const name of posts) await mkdir(path.join(account, 'posts', name), { recursive: true });
  if (sync) {
    await writeFile(path.join(account, 'sync.json'), JSON.stringify({ version: SYNC_VERSION, ...sync }));
  }
  return account;
}

/**
 * A post folder holding everything its post.json lists, which is what counts as
 * downloaded — see landed.mjs.
 */
async function land(accountDir, folder, files) {
  const dir = path.join(accountDir, 'posts', folder);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, 'post.json'),
    JSON.stringify({ version: POST_VERSION, media: files.map((file) => ({ file })) }),
  );
  for (const file of files) await writeFile(path.join(dir, file), '');
}

/** A plan --go would accept: this account, this root, made just now. */
const plan = (dir, id, pending) => ({
  created_at: hoursAgo(1),
  root: dir,
  account: { id },
  counts: {},
  notes: [],
  collected: [],
  pending,
});

test('a root with nothing in it reports no accounts, and where it looked', async () => {
  const dir = await root();
  assert.deepEqual(await listArchive(dir, { now: NOW }), { root: dir, accounts: [] });
});

test('a root that does not exist reads the same as an empty one', async () => {
  // To the user they are one situation — nothing to sync — and the remedy is
  // the same, so nothing here tells them apart.
  const dir = path.join(await root(), 'never-made');
  assert.deepEqual(await listArchive(dir, { now: NOW }), { root: dir, accounts: [] });
});

test('nothing is created by looking', async () => {
  const dir = path.join(await root(), 'never-made');
  await listArchive(dir, { now: NOW });
  await assert.rejects(() => stat(dir), 'looking must not create the root');
});

test('an account is reported as facts, and nothing is worded', async () => {
  // The words a user reads are the skill's. What comes out of here has to carry
  // everything those words could need and decide none of them.
  const dir = await root();
  const account = await seed(dir, 'x', 'jia', {
    id: '1',
    nickname: 'Jia',
    url: 'https://x.com/jia',
    posts: ['2026-01-01_111', '2026-01-02_222'],
    sync: { last_run: { at: '2026-06-02T09:41:00Z' } },
  });

  assert.deepEqual(await readAccounts(dir, { now: NOW }), [
    {
      platform: 'x',
      folder: 'jia',
      dir: account,
      nickname: 'Jia',
      url: 'https://x.com/jia',
      posts: 2,
      last_run: '2026-06-02T09:41:00Z',
      to_fetch: null,
    },
  ]);
});

test('the folder is given outright, never left to be rebuilt from the platform and the name', async () => {
  const dir = await root();
  const account = await seed(dir, 'douyin', '小明', { id: 'MS4w', nickname: '旅行的小明' });

  const [entry] = await readAccounts(dir, { now: NOW });
  assert.equal(entry.dir, account);
  assert.equal(entry.folder, '小明');
});

test('a directory with no account.json is not an account', async () => {
  const dir = await root();
  await mkdir(path.join(dir, 'x', 'junk'), { recursive: true });
  await seed(dir, 'x', 'jia', { id: '1', nickname: 'Jia' });

  const entries = await readAccounts(dir, { now: NOW });
  assert.deepEqual(entries.map((entry) => entry.folder), ['jia']);
});

test('an account.json this build cannot read is skipped like an absent one', async () => {
  const dir = await root();
  const folder = path.join(dir, 'x', 'broken');
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, 'account.json'), '{ not json');

  assert.deepEqual(await readAccounts(dir, { now: NOW }), []);
});

test('accounts come grouped by platform, in the registry order', async () => {
  const dir = await root();
  await seed(dir, 'x', 'jia', { id: '1', nickname: 'Jia' });
  await seed(dir, 'douyin', 'xiaoming', { id: 'MS4w', nickname: '旅行的小明' });

  const entries = await readAccounts(dir, { now: NOW });
  assert.deepEqual(entries.map((entry) => entry.platform), ['douyin', 'x']);
});

test('posts are counted as the post folders on disk', async () => {
  const dir = await root();
  await seed(dir, 'x', 'jia', {
    id: '1',
    nickname: 'Jia',
    // The third is not a post folder: the name carries no id.
    posts: ['2026-01-01_111', 'undated_222', 'notes'],
  });

  const [entry] = await readAccounts(dir, { now: NOW });
  assert.equal(entry.posts, 2);
});

test('the most recently run account comes first, and never-run ones sort by name', async () => {
  const dir = await root();
  await seed(dir, 'x', 'older', { id: '1', sync: { last_run: { at: hoursAgo(200) } } });
  await seed(dir, 'x', 'newer', { id: '2', sync: { last_run: { at: hoursAgo(2) } } });
  await seed(dir, 'x', 'bravo', { id: '3' });
  await seed(dir, 'x', 'alpha', { id: '4' });

  const entries = await readAccounts(dir, { now: NOW });
  assert.deepEqual(entries.map((entry) => entry.folder), ['newer', 'older', 'alpha', 'bravo']);
});

test('an account that has never run says so with a null rather than a missing key', async () => {
  const dir = await root();
  await seed(dir, 'x', 'jia', { id: '1', nickname: 'Jia' });

  const [entry] = await readAccounts(dir, { now: NOW });
  assert.equal(entry.last_run, null);
  assert.ok('last_run' in entry, 'the key is always there, so a reader need not guess');
});

test('the last run is reported whole, for the reader to say in their own way', async () => {
  // Not a date this file has already formatted: whoever reports it may be
  // writing in another language, and a day cut out of the timestamp here is a
  // choice made for them.
  const dir = await root();
  await seed(dir, 'x', 'jia', { id: '1', sync: { last_run: { at: '2026-06-02T09:41:00Z' } } });

  const [entry] = await readAccounts(dir, { now: NOW });
  assert.equal(entry.last_run, '2026-06-02T09:41:00Z');
});

test('a live plan is reported as how many it would fetch', async () => {
  const dir = await root();
  await seed(dir, 'x', 'jia', {
    id: '1',
    sync: { plan: plan(dir, '1', [{ tweetId: 'a' }, { tweetId: 'b' }]) },
  });

  const [entry] = await readAccounts(dir, { now: NOW });
  assert.equal(entry.to_fetch, 2);
});

test('what has landed since is not counted again', async () => {
  // A plan is kept after a run that stopped partway so the retry fetches the
  // remainder. Reporting the whole approved list would offer 37 when 7 are left.
  const dir = await root();
  const account = await seed(dir, 'x', 'jia', {
    id: '1',
    sync: { plan: plan(dir, '1', [{ tweetId: '111' }, { tweetId: '222' }, { tweetId: '333' }]) },
  });
  await land(account, '2026-01-01_111', ['1.jpg']);

  const [entry] = await readAccounts(dir, { now: NOW });
  assert.equal(entry.to_fetch, 2);
});

test('Douyin posts are counted by their own id key, not Xes', async () => {
  // The two platforms name a collected post's id differently, which is the only
  // thing separating them from one rule. Getting it wrong here counts every post
  // as still missing.
  const dir = await root();
  const account = await seed(dir, 'douyin', 'MS4w', {
    id: 'MS4w',
    sync: { plan: plan(dir, 'MS4w', [{ id: '111' }, { id: '222' }]) },
  });
  await land(account, '2026-01-01_111', ['1.mp4']);

  const [entry] = await readAccounts(dir, { now: NOW });
  assert.equal(entry.to_fetch, 1);
});

test('a plan whose posts have all landed reports nothing waiting', async () => {
  const dir = await root();
  const account = await seed(dir, 'x', 'jia', {
    id: '1',
    sync: { plan: plan(dir, '1', [{ tweetId: '111' }]) },
  });
  await land(account, '2026-01-01_111', ['1.jpg']);

  const [entry] = await readAccounts(dir, { now: NOW });
  assert.equal(entry.to_fetch, null);
});

test('a plan --go would refuse is not reported', async () => {
  // The mark and the acceptance are the same question, so they are answered by
  // the same validatePlan call. Reporting one --go then refuses is how a user is
  // told there are 37 waiting, picks it, and is sent back to the start.
  const dir = await root();
  const stale = { ...plan(dir, '1', [{ tweetId: 'a' }]), created_at: hoursAgo(30) };
  const foreign = { ...plan(path.join(dir, 'elsewhere'), '2', [{ tweetId: 'b' }]) };
  const spent = plan(dir, '3', []);

  await seed(dir, 'x', 'stale', { id: '1', sync: { plan: stale } });
  await seed(dir, 'x', 'foreign', { id: '2', sync: { plan: foreign } });
  await seed(dir, 'x', 'spent', { id: '3', sync: { plan: spent } });

  for (const entry of await readAccounts(dir, { now: NOW })) {
    assert.equal(entry.to_fetch, null, `${entry.folder} should report nothing waiting`);
  }
});

test('an account with no id reports nothing waiting, whatever plan is parked in it', async () => {
  // This has nothing to check the plan's account against; --go does, taking the
  // id from the URL it was handed. Answering here would answer a question --go
  // answers differently, which is the one thing this must never do.
  const dir = await root();
  await seed(dir, 'douyin', 'nameless', {
    nickname: '匿名',
    sync: { plan: plan(dir, 'MS4wSomebodyElse', [{ tweetId: 'a' }]) },
  });

  const [entry] = await readAccounts(dir, { now: NOW });
  assert.equal(entry.to_fetch, null);
});

test('an account with no recorded url reports null, and is still listed', async () => {
  // It is still syncable, but not without asking: a URL rebuilt from a handle
  // would archive whoever holds that name today.
  const dir = await root();
  await seed(dir, 'x', 'jia', { id: '1', nickname: 'Jia', url: null });

  const [entry] = await readAccounts(dir, { now: NOW });
  assert.equal(entry.url, null);
});

test('the recorded url is carried through, and never rebuilt from the handle', async () => {
  const dir = await root();
  await seed(dir, 'x', 'jia', { id: '1', nickname: 'Jia', url: 'https://x.com/old_name' });

  const [entry] = await readAccounts(dir, { now: NOW });
  assert.equal(entry.url, 'https://x.com/old_name');
});

test('a schema this build cannot read refuses, and reads nothing', async () => {
  const dir = await root();
  await seed(dir, 'x', 'jia', { id: '1', nickname: 'Jia' });
  await writeFile(path.join(dir, 'archiver.json'), JSON.stringify({ schema: SCHEMA_VERSION + 1 }));

  await assert.rejects(() => listArchive(dir, { now: NOW }), /newer version of this skill/);
});

test('listing stamps nothing into the root', async () => {
  // Listing is a read. A mistyped --archives must not leave a stamped empty
  // directory behind on a run that then went nowhere.
  const dir = await root();
  await seed(dir, 'x', 'jia', { id: '1', nickname: 'Jia' });
  await listArchive(dir, { now: NOW });

  assert.deepEqual(await readdir(dir), ['x']);
});
