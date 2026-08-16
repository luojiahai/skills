import assert from 'node:assert/strict';
import { execFile as execFileCb } from 'node:child_process';
import { mkdtemp, mkdir, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);

import {
  ACCOUNT_VERSION,
  PLATFORM,
  accountDirFor,
  aliasDirFor,
  applyAlias,
  checkAlias,
  clearAlias,
  existingIds,
  findAccountDir,
  isSafeAlias,
  isSafeId,
  mergeAccount,
  platformDir,
  readAccount,
  recordIdentity,
  resolveAccountDir,
  writeAccount,
} from './account.mjs';
import { readAliases, writeAlias } from './archiver.mjs';

const root = () => mkdtemp(path.join(os.tmpdir(), 'douyin-account-'));

async function seed(dir, folderName, json) {
  const folder = path.join(dir, PLATFORM, folderName);
  await mkdir(folder, { recursive: true });
  await writeFile(
    path.join(folder, 'account.json'),
    JSON.stringify({ version: ACCOUNT_VERSION, platform: PLATFORM, ...json }),
  );
  return folder;
}

test('an account folder is the sec_uid, under the platform folder', () => {
  assert.equal(accountDirFor('/data', 'MS4wSEC'), path.join('/data', 'douyin', 'MS4wSEC'));
  assert.equal(platformDir('/data'), path.join('/data', 'douyin'));
});

test('a real sec_uid is accepted', () => {
  assert.equal(isSafeId('MS4wLjABAAAAv7iSuuXDJGDvn02WdIXqDoyorEcHy4RUKQzOxPbmHIQ'), true);
});

test('an id that would escape the archives root is refused, not sanitised', () => {
  for (const bad of ['..', '.', '', 'a/b', '../../etc', 'a\0b', 'x'.repeat(129)]) {
    assert.equal(isSafeId(bad), false, `expected ${JSON.stringify(bad)} to be refused`);
    assert.throws(() => accountDirFor('/data', bad));
  }
});

test('an alias may be any script a person writes their own name in', () => {
  // The motivating case: these accounts are Chinese, and a nickname the user
  // wants to read is not going to be ASCII.
  for (const good of ['jia', '罗嘉海', '小明', 'work-2', 'a.b_c']) {
    assert.equal(isSafeAlias(good), true, `expected ${JSON.stringify(good)} to be allowed`);
  }
});

test('an alias that could not safely be a folder is refused', () => {
  // Spaces are refused rather than munged: a silently rewritten alias is one the
  // user cannot predict, and every quoted example in the docs would be a trap.
  for (const bad of ['', '.', '..', '.hidden', 'a/b', 'a\\b', 'two words', 'a\0b', 'a\nb', 'x'.repeat(129)]) {
    assert.equal(isSafeAlias(bad), false, `expected ${JSON.stringify(bad)} to be refused`);
  }
});

test('aliasDirFor refuses rather than joining an unsafe alias into a path', () => {
  assert.equal(aliasDirFor('/data', '小明'), path.join('/data', 'douyin', '小明'));
  assert.throws(() => aliasDirFor('/data', '../escape'));
});

test('mergeAccount keeps what an earlier run knew', () => {
  // A run that learned only the 抖音号 must not erase the nickname a full sweep
  // recorded.
  const merged = mergeAccount(
    { account: { id: 'MS4wSEC', douyin_id: 'old', nickname: '小明' }, url: 'https://www.douyin.com/user/MS4wSEC' },
    { account: { douyin_id: 'new' } },
  );
  assert.equal(merged.account.id, 'MS4wSEC');
  assert.equal(merged.account.douyin_id, 'new');
  assert.equal(merged.account.nickname, '小明');
  assert.equal(merged.url, 'https://www.douyin.com/user/MS4wSEC');
  assert.equal(merged.platform, PLATFORM);
});

test('mergeAccount treats a blank as silence, not as an erasure', () => {
  // The collector emits every key it knows *of*, null where it found nothing.
  const merged = mergeAccount(
    { account: { id: 'MS4wSEC', douyin_id: 'abc', nickname: '小明' } },
    { account: { id: null, douyin_id: 'abc', nickname: '' } },
  );
  assert.equal(merged.account.id, 'MS4wSEC');
  assert.equal(merged.account.nickname, '小明');
});

test('a dropped key is the one way to erase, so --unalias is not a blank', () => {
  const merged = mergeAccount(
    { account: { id: 'MS4wSEC', douyin_id: 'abc', alias: '小明' } },
    { account: { douyin_id: 'abc' } },
    { drop: ['alias'] },
  );
  assert.equal('alias' in merged.account, false);
  assert.equal(merged.account.douyin_id, 'abc');
});

test('the account reads in the same order however it was learned', () => {
  const merged = mergeAccount(
    { account: { nickname: '小明' } },
    { account: { alias: 'work', douyin_id: 'abc', id: 'MS4wSEC', verified: 'ignored' } },
  );
  assert.deepEqual(Object.keys(merged.account), ['id', 'douyin_id', 'nickname', 'alias']);
});

test('account.json holds identity and provenance, and nothing about progress', () => {
  const merged = mergeAccount(
    { root: '/data', updated_at: 'yesterday', collected_count: 86 },
    { account: { id: 'MS4wSEC' }, url: 'https://www.douyin.com/user/MS4wSEC' },
  );
  assert.deepEqual(Object.keys(merged).sort(), ['account', 'platform', 'url', 'version']);
});

test('writeAccount merges rather than overwrites, and creates the folder', async () => {
  const dir = accountDirFor(await root(), 'MS4wSEC');
  await writeAccount(dir, { account: { id: 'MS4wSEC', douyin_id: 'abc' }, url: 'https://www.douyin.com/user/MS4wSEC' });
  const merged = await writeAccount(dir, { account: { nickname: '小明' } });
  assert.equal(merged.account.douyin_id, 'abc');
  assert.equal(merged.url, 'https://www.douyin.com/user/MS4wSEC');
  assert.deepEqual(await readAccount(dir), merged);
});

test('readAccount reads nothing as null rather than failing', async () => {
  assert.equal(await readAccount(path.join(await root(), 'douyin', 'nobody')), null);
});

test('an archive that only recorded a 抖音号 still finds its account', async () => {
  const dir = await root();
  const folder = await seed(dir, 'MS4wSEC', { account: { id: 'MS4wSEC', douyin_id: 'abc123' } });
  assert.equal(await findAccountDir(dir, { douyinId: 'abc123' }), folder);
});

test('findAccountDir takes the alias as a path before it scans anything', async () => {
  const dir = await root();
  const folder = await seed(dir, '小明', { account: { id: 'MS4wSEC', douyin_id: 'abc123', alias: '小明' } });
  assert.equal(await findAccountDir(dir, { alias: '小明' }), folder);
});

test('findAccountDir falls back through the mapping when the alias path is empty', async () => {
  const dir = await root();
  const folder = await seed(dir, 'MS4wSEC', { account: { id: 'MS4wSEC', douyin_id: 'abc123' } });
  await writeAlias(dir, PLATFORM, 'MS4wSEC', '小明');
  assert.equal(await findAccountDir(dir, { alias: '小明' }), folder);
});

test('an alias outranks a 抖音号 that happens to match another account', async () => {
  // The alias is the user's own word for this archive; the 抖音号 is what the
  // platform calls it today, and the user can change it.
  const dir = await root();
  await seed(dir, 'MS4wOTHER', { account: { id: 'MS4wOTHER', douyin_id: 'work' } });
  const aliased = await seed(dir, 'MS4wSEC', { account: { id: 'MS4wSEC', douyin_id: 'abc123', alias: 'work' } });
  assert.equal(await findAccountDir(dir, { alias: 'work', douyinId: 'work' }), aliased);
});

test('the profile URL an archive was made from wins outright', async () => {
  const dir = await root();
  const folder = await seed(dir, 'MS4wSEC', {
    account: { id: 'MS4wSEC', douyin_id: 'abc123' },
    url: 'https://www.douyin.com/user/MS4wSEC',
  });
  assert.equal(await findAccountDir(dir, { url: 'https://www.douyin.com/user/MS4wSEC' }), folder);
});

test('a file from a version this build cannot read is not an archive', async () => {
  const dir = await root();
  const folder = path.join(dir, PLATFORM, 'MS4wSEC');
  await mkdir(folder, { recursive: true });
  await writeFile(
    path.join(folder, 'account.json'),
    JSON.stringify({ version: ACCOUNT_VERSION + 1, account: { id: 'MS4wSEC', douyin_id: 'abc123' } }),
  );
  assert.equal(await findAccountDir(dir, { douyinId: 'abc123' }), null);
});

test('findAccountDir is null for a root nothing has been archived into', async () => {
  assert.equal(await findAccountDir(await root(), { douyinId: 'abc123' }), null);
  assert.equal(await findAccountDir('/no/such/root', { douyinId: 'abc123' }), null);
});

test('findAccountDir with nothing to go on matches nothing', async () => {
  const dir = await root();
  await seed(dir, 'MS4wSEC', { account: { id: 'MS4wSEC', douyin_id: 'abc123' } });
  assert.equal(await findAccountDir(dir, {}), null);
});

test('resolveAccountDir goes straight to the mapped folder', async () => {
  const dir = await root();
  const folder = await seed(dir, '小明', { account: { id: 'MS4wSEC', alias: '小明' } });
  await writeAlias(dir, PLATFORM, 'MS4wSEC', '小明');
  assert.equal(await resolveAccountDir(dir, { id: 'MS4wSEC' }), folder);
});

test('resolveAccountDir finds an un-aliased account at its sec_uid', async () => {
  const dir = await root();
  const folder = await seed(dir, 'MS4wSEC', { account: { id: 'MS4wSEC' } });
  assert.equal(await resolveAccountDir(dir, { id: 'MS4wSEC' }), folder);
});

test('a mapping entry pointing at nothing is a stale cache line, not a lost archive', async () => {
  const dir = await root();
  const folder = await seed(dir, '小明2', { account: { id: 'MS4wSEC', alias: '小明' } });
  await writeAlias(dir, PLATFORM, 'MS4wSEC', '小明');
  assert.equal(await resolveAccountDir(dir, { id: 'MS4wSEC' }), folder);
});

test('a folder sitting at another sec_uid does not answer for that id', async () => {
  const dir = await root();
  await seed(dir, 'MS4wSEC', { account: { id: 'MS4wOTHER' } });
  assert.equal(await resolveAccountDir(dir, { id: 'MS4wSEC' }), null);
});

test('resolveAccountDir is null for an account nothing has archived', async () => {
  assert.equal(await resolveAccountDir(await root(), { id: 'MS4wSEC' }), null);
});

test('the ids on a platform are the mapping keys plus the folders that are not aliases', async () => {
  const dir = await root();
  await seed(dir, 'MS4wOTHER', { account: { id: 'MS4wOTHER' } });
  await seed(dir, '小明', { account: { id: 'MS4wSEC', alias: '小明' } });
  await writeAlias(dir, PLATFORM, 'MS4wSEC', '小明');

  assert.deepEqual([...(await existingIds(dir))].sort(), ['MS4wOTHER', 'MS4wSEC']);
});

test('an alias that is another sec_uid is refused, even while that folder is aliased away', async () => {
  const dir = await root();
  await seed(dir, '小明', { account: { id: 'MS4wSEC', alias: '小明' } });
  await writeAlias(dir, PLATFORM, 'MS4wSEC', '小明');

  const verdict = await checkAlias(dir, { id: 'MS4wOTHER', alias: 'MS4wSEC' });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /sec_uid/);
});

test('an alias already taken by another account is refused, and names the account holding it', async () => {
  const dir = await root();
  await seed(dir, '小明', { account: { id: 'MS4wSEC', alias: '小明' } });
  await writeAlias(dir, PLATFORM, 'MS4wSEC', '小明');

  const verdict = await checkAlias(dir, { id: 'MS4wOTHER', alias: '小明' });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /MS4wSEC/);
});

test('re-passing the alias an account already has is not a collision with itself', async () => {
  const dir = await root();
  await seed(dir, '小明', { account: { id: 'MS4wSEC', alias: '小明' } });
  await writeAlias(dir, PLATFORM, 'MS4wSEC', '小明');

  assert.equal((await checkAlias(dir, { id: 'MS4wSEC', alias: '小明' })).ok, true);
});

test('a malformed alias is refused without the filesystem being consulted', async () => {
  const verdict = await checkAlias('/no/such/root', { id: 'MS4wSEC', alias: 'two words' });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /alias/);
});

test('applyAlias names the folder for a brand new account', async () => {
  const dir = await root();
  assert.equal(await applyAlias(dir, { id: 'MS4wSEC', alias: '小明' }), aliasDirFor(dir, '小明'));
});

test('applyAlias moves an existing archive, contents and all', async () => {
  const dir = await root();
  const before = await seed(dir, 'MS4wSEC', { account: { id: 'MS4wSEC' } });
  await mkdir(path.join(before, 'posts', '2024-01-01_1'), { recursive: true });

  const after = await applyAlias(dir, { id: 'MS4wSEC', alias: '小明' });
  assert.equal(after, aliasDirFor(dir, '小明'));
  assert.deepEqual(await readdir(path.join(after, 'posts')), ['2024-01-01_1']);
  assert.equal(await readAccount(before), null);
});

test('applyAlias adopts a folder the same account is already sitting in', async () => {
  const dir = await root();
  const folder = await seed(dir, '小明', { account: { id: 'MS4wSEC' } });
  assert.equal(await applyAlias(dir, { id: 'MS4wSEC', alias: '小明' }), folder);
});

test('applyAlias refuses to move onto another account, and never merges', async () => {
  const dir = await root();
  await seed(dir, 'MS4wSEC', { account: { id: 'MS4wSEC' } });
  await seed(dir, '小明', { account: { id: 'MS4wOTHER' } });
  await assert.rejects(() => applyAlias(dir, { id: 'MS4wSEC', alias: '小明' }), /MS4wOTHER/);
});

test('applyAlias refuses a destination it cannot identify', async () => {
  const dir = await root();
  await seed(dir, 'MS4wSEC', { account: { id: 'MS4wSEC' } });
  await mkdir(path.join(dir, PLATFORM, '小明'), { recursive: true });
  await assert.rejects(() => applyAlias(dir, { id: 'MS4wSEC', alias: '小明' }), /小明/);
});

test('applyAlias refuses when one account has somehow ended up in two folders', async () => {
  const dir = await root();
  await seed(dir, 'MS4wSEC', { account: { id: 'MS4wSEC' } });
  await seed(dir, '小明', { account: { id: 'MS4wSEC' } });
  await assert.rejects(() => applyAlias(dir, { id: 'MS4wSEC', alias: '小明' }), /two folders/);
});

test('recordIdentity derives the alias from where the folder actually is', async () => {
  const dir = await root();
  const folder = await seed(dir, '小明2', { account: { id: 'MS4wSEC', alias: '小明' } });
  await writeAlias(dir, PLATFORM, 'MS4wSEC', '小明');

  await recordIdentity(dir, folder, { account: { id: 'MS4wSEC', douyin_id: 'abc123' } });

  assert.equal((await readAccount(folder)).account.alias, '小明2');
  assert.deepEqual(await readAliases(dir, PLATFORM), { MS4wSEC: '小明2' });
});

test('recordIdentity finds the id in the folder when the caller has none', async () => {
  // The write run_plan makes after a move passes only --url. The folder already
  // says whose it is, and guarding on the caller's id left account.json holding
  // an alias that archiver.json had never heard of.
  const dir = await root();
  const folder = await seed(dir, '小明', { account: { id: 'MS4wSEC', douyin_id: 'abc123' } });

  await recordIdentity(dir, folder, { url: 'https://www.douyin.com/user/MS4wSEC' });

  assert.equal((await readAccount(folder)).account.alias, '小明');
  assert.deepEqual(await readAliases(dir, PLATFORM), { MS4wSEC: '小明' });
});

test('recordIdentity leaves no alias on a folder that is named for its sec_uid', async () => {
  const dir = await root();
  const folder = await seed(dir, 'MS4wSEC', { account: { id: 'MS4wSEC', alias: '小明' } });
  await writeAlias(dir, PLATFORM, 'MS4wSEC', '小明');

  await recordIdentity(dir, folder, { account: { id: 'MS4wSEC', douyin_id: 'abc123' } });

  assert.equal('alias' in (await readAccount(folder)).account, false);
  assert.deepEqual(await readAliases(dir, PLATFORM), {});
});

test('clearAlias puts the folder back under the sec_uid', async () => {
  const dir = await root();
  await seed(dir, '小明', { account: { id: 'MS4wSEC', douyin_id: 'abc123', alias: '小明' } });
  await writeAlias(dir, PLATFORM, 'MS4wSEC', '小明');

  const back = await clearAlias(dir, { id: 'MS4wSEC' });
  assert.equal(back, accountDirFor(dir, 'MS4wSEC'));
  assert.equal((await readAccount(back)).account.douyin_id, 'abc123');
  assert.equal('alias' in (await readAccount(back)).account, false);
  assert.deepEqual(await readAliases(dir, PLATFORM), {});
});

test('clearAlias on an account that never had one is not an error', async () => {
  const dir = await root();
  const folder = await seed(dir, 'MS4wSEC', { account: { id: 'MS4wSEC' } });
  assert.equal(await clearAlias(dir, { id: 'MS4wSEC' }), folder);
});

const CLI = new URL('./account.mjs', import.meta.url).pathname;
const runCli = (...args) => execFile(process.execPath, [CLI, ...args]);

test('check-alias without a sec_uid does not refuse an account its own alias', async () => {
  // A profile URL that carried no sec_uid: all the run has is the 抖音号 and the
  // alias. Passing the alias this account already has must find
  // it, not be read as a collision with itself — the account cannot take a name
  // off itself.
  const dir = await root();
  await seed(dir, '小明', { account: { id: 'MS4wSEC', douyin_id: 'abc123', alias: '小明' } });
  await writeAlias(dir, PLATFORM, 'MS4wSEC', '小明');

  await runCli('check-alias', '--archives', dir, '--sec-uid', '', '--alias', '小明', '--douyin-id', 'abc123');
});

test('a known sec_uid asking for somebody else\'s alias is still refused', async () => {
  // The collision that matters, and the only one that can do harm: this is the
  // path that goes on to *rename* a folder. Where no sec_uid is known nothing
  // moves, and an alias there is only ever a way of naming a folder to look in.
  const dir = await root();
  await seed(dir, '小明', { account: { id: 'MS4wSEC', douyin_id: 'abc123', alias: '小明' } });
  await writeAlias(dir, PLATFORM, 'MS4wSEC', '小明');

  await assert.rejects(
    () => runCli('check-alias', '--archives', dir, '--sec-uid', 'MS4wOTHER', '--alias', '小明'),
    (err) => /already belongs/.test(err.stderr),
  );
});

test('an alias nothing has taken is free, sec_uid or no sec_uid', async () => {
  const dir = await root();
  await seed(dir, '小明', { account: { id: 'MS4wSEC', douyin_id: 'abc123', alias: '小明' } });
  await writeAlias(dir, PLATFORM, 'MS4wSEC', '小明');

  await runCli('check-alias', '--archives', dir, '--sec-uid', '', '--alias', '小红', '--douyin-id', 'other');
  await runCli('check-alias', '--archives', dir, '--sec-uid', 'MS4wOTHER', '--alias', '小红');
});
