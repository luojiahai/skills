import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  ACCOUNT_VERSION,
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
import { descriptorFor } from './platforms.mjs';

/**
 * The store is exercised through X's descriptor throughout, and through
 * Douyin's where the descriptor is the thing under test — those are the only
 * places the two platforms can differ.
 */
const ACCOUNT = descriptorFor('x');
const PLATFORM = ACCOUNT.platform;

const root = () => mkdtemp(path.join(os.tmpdir(), 'x-account-'));

async function seed(dir, folderName, json) {
  const folder = path.join(dir, PLATFORM, folderName);
  await mkdir(folder, { recursive: true });
  await writeFile(
    path.join(folder, 'account.json'),
    JSON.stringify({ version: ACCOUNT_VERSION, platform: PLATFORM, ...json }),
  );
  return folder;
}

test('an account folder is the id, under the platform folder', () => {
  assert.equal(accountDirFor(ACCOUNT, '/data', '55'), path.join('/data', 'x', '55'));
  assert.equal(platformDir(ACCOUNT, '/data'), path.join('/data', 'x'));
});

test('an id that would escape the archives root is refused, not sanitised', () => {
  // The id arrives from a subprocess's stdout and lands in a path. A separator
  // here does not make a badly named folder, it makes a tree somewhere else.
  for (const bad of ['..', '.', '', 'a/b', '../../etc', 'a\0b', 'x'.repeat(129)]) {
    assert.equal(isSafeId(bad), false, `expected ${JSON.stringify(bad)} to be refused`);
    assert.throws(() => accountDirFor(ACCOUNT, '/data', bad));
  }
});

test('a real X id is accepted', () => {
  assert.equal(isSafeId('1458023001234567890'), true);
});

test('an alias may be any script a person writes their own name in', () => {
  // The motivating case is the sibling skill, where a nickname is Chinese. An
  // alias is typed by the user, not scraped, so ASCII would be the wrong rule.
  for (const good of ['jia', '罗嘉海', 'работа', 'work-2', 'a.b_c', 'Ω']) {
    assert.equal(isSafeAlias(good), true, `expected ${JSON.stringify(good)} to be allowed`);
  }
});

test('an alias that could not safely be a folder is refused', () => {
  // Spaces are refused rather than munged: a silently rewritten alias is one the
  // user cannot predict, and every shell snippet in the docs would need quoting.
  for (const bad of ['', '.', '..', '.hidden', 'a/b', 'a\\b', 'two words', 'a\0b', 'a\nb', 'x'.repeat(129)]) {
    assert.equal(isSafeAlias(bad), false, `expected ${JSON.stringify(bad)} to be refused`);
  }
});

test('aliasDirFor refuses rather than joining an unsafe alias into a path', () => {
  assert.equal(aliasDirFor(ACCOUNT, '/data', 'jia'), path.join('/data', 'x', 'jia'));
  assert.throws(() => aliasDirFor(ACCOUNT, '/data', '../escape'));
});

test('mergeAccount keeps what an earlier run knew', () => {
  const merged = mergeAccount(ACCOUNT, 
    { account: { id: '55', handle: 'old', nickname: 'Old Name' }, url: 'https://x.com/old' },
    { account: { handle: 'new' } },
  );
  assert.equal(merged.account.id, '55');
  assert.equal(merged.account.handle, 'new');
  assert.equal(merged.account.nickname, 'Old Name');
  assert.equal(merged.url, 'https://x.com/old');
  assert.equal(merged.version, ACCOUNT_VERSION);
  assert.equal(merged.platform, PLATFORM);
});

test('mergeAccount treats a blank as silence, not as an erasure', () => {
  const merged = mergeAccount(ACCOUNT, 
    { account: { id: '55', handle: 'someone', nickname: 'Some One' } },
    { account: { id: '', handle: 'someone', nickname: '' } },
  );
  assert.equal(merged.account.id, '55');
  assert.equal(merged.account.nickname, 'Some One');
});

test('a dropped key is the one way to erase, so --unalias is not a blank', () => {
  // Silence must stay silence — every run passes fields it does not know. So
  // taking an alias off is a separate, explicit instruction rather than a value.
  const merged = mergeAccount(ACCOUNT, 
    { account: { id: '55', handle: 'someone', alias: 'jia' } },
    { account: { handle: 'someone' } },
    { drop: ['alias'] },
  );
  assert.equal('alias' in merged.account, false);
  assert.equal(merged.account.handle, 'someone');
});

test('the account reads in the same order however it was learned', () => {
  const merged = mergeAccount(ACCOUNT, 
    { account: { nickname: 'Some One' } },
    { account: { alias: 'work', handle: 'someone', id: '55', verified: 'ignored' } },
  );
  assert.deepEqual(Object.keys(merged.account), ['id', 'handle', 'nickname', 'alias']);
});

test('account.json holds identity and provenance, and nothing about progress', () => {
  const merged = mergeAccount(ACCOUNT, 
    { root: '/data', updated_at: 'yesterday', collected_count: 86 },
    { account: { id: '55' }, url: 'https://x.com/someone' },
  );
  assert.deepEqual(Object.keys(merged).sort(), ['account', 'platform', 'url', 'version']);
});

test('writeAccount merges rather than overwrites, and creates the folder', async () => {
  const dir = accountDirFor(ACCOUNT, await root(), '55');
  await writeAccount(ACCOUNT, dir, { account: { id: '55', handle: 'someone' }, url: 'https://x.com/someone' });
  const merged = await writeAccount(ACCOUNT, dir, { account: { nickname: 'Some One' } });
  assert.equal(merged.account.handle, 'someone');
  assert.equal(merged.url, 'https://x.com/someone');
  assert.deepEqual(await readAccount(dir), merged);
});

test('readAccount reads nothing as null rather than failing', async () => {
  assert.equal(await readAccount(path.join(await root(), 'x', 'nobody')), null);
});

test('findAccountDir finds the folder --go is looking for by the URL it was made from', async () => {
  const dir = await root();
  const folder = await seed(dir, '55', { account: { id: '55', handle: 'oldhandle' }, url: 'https://x.com/newhandle' });
  assert.equal(await findAccountDir(ACCOUNT, dir, { url: 'https://x.com/newhandle' }), folder);
});

test('findAccountDir takes the alias as a path before it scans anything', async () => {
  const dir = await root();
  const folder = await seed(dir, 'jia', { account: { id: '55', handle: 'someone', alias: 'jia' } });
  assert.equal(await findAccountDir(ACCOUNT, dir, { alias: 'jia' }), folder);
});

test('findAccountDir falls back through the mapping when the alias path is empty', async () => {
  // The mapping says the folder is aliased; the folder on disk is not. That is a
  // stale cache line, and a scan is what it costs.
  const dir = await root();
  const folder = await seed(dir, '55', { account: { id: '55', handle: 'someone' } });
  await writeAlias(dir, PLATFORM, '55', 'jia');
  assert.equal(await findAccountDir(ACCOUNT, dir, { alias: 'jia' }), folder);
});

test('findAccountDir falls back to the alias inside account.json, then to the handle', async () => {
  const dir = await root();
  const byAlias = await seed(dir, '55', { account: { id: '55', handle: 'someone', alias: 'work' } });
  const byHandle = await seed(dir, '66', { account: { id: '66', handle: 'other' } });

  assert.equal(await findAccountDir(ACCOUNT, dir, { alias: 'work' }), byAlias);
  assert.equal(await findAccountDir(ACCOUNT, dir, { handle: 'other' }), byHandle);
});

test('an alias outranks a handle that happens to match another account', async () => {
  const dir = await root();
  await seed(dir, '66', { account: { id: '66', handle: 'work' } });
  const aliased = await seed(dir, '55', { account: { id: '55', handle: 'someone', alias: 'work' } });
  assert.equal(await findAccountDir(ACCOUNT, dir, { alias: 'work', handle: 'work' }), aliased);
});

test('a file from a version this build cannot read is not an archive', async () => {
  const dir = await root();
  const folder = path.join(dir, PLATFORM, '55');
  await mkdir(folder, { recursive: true });
  await writeFile(
    path.join(folder, 'account.json'),
    JSON.stringify({ version: ACCOUNT_VERSION + 1, account: { id: '55', handle: 'someone' } }),
  );
  assert.equal(await findAccountDir(ACCOUNT, dir, { handle: 'someone' }), null);
});

test('findAccountDir is null for a root nothing has been archived into', async () => {
  assert.equal(await findAccountDir(ACCOUNT, await root(), { handle: 'someone' }), null);
  assert.equal(await findAccountDir(ACCOUNT, '/no/such/root', { handle: 'someone' }), null);
});

test('findAccountDir with nothing to go on matches nothing', async () => {
  const dir = await root();
  await seed(dir, '55', { account: { id: '55', handle: 'someone' } });
  assert.equal(await findAccountDir(ACCOUNT, dir, {}), null);
});

test('resolveAccountDir goes straight to the mapped folder', async () => {
  const dir = await root();
  const folder = await seed(dir, 'jia', { account: { id: '55', handle: 'someone', alias: 'jia' } });
  await writeAlias(dir, PLATFORM, '55', 'jia');
  assert.equal(await resolveAccountDir(ACCOUNT, dir, { id: '55' }), folder);
});

test('resolveAccountDir finds an un-aliased account at its id', async () => {
  const dir = await root();
  const folder = await seed(dir, '55', { account: { id: '55', handle: 'someone' } });
  assert.equal(await resolveAccountDir(ACCOUNT, dir, { id: '55' }), folder);
});

test('a mapping entry pointing at nothing is a stale cache line, not a lost archive', async () => {
  // The case the map exists to make fast, failing. The scan is the repair, and
  // it costs a directory read rather than a re-download.
  const dir = await root();
  const folder = await seed(dir, 'jiahai', { account: { id: '55', handle: 'someone', alias: 'jia' } });
  await writeAlias(dir, PLATFORM, '55', 'jia');
  assert.equal(await resolveAccountDir(ACCOUNT, dir, { id: '55' }), folder);
});

test('a folder sitting at another accountid does not answer for that id', async () => {
  const dir = await root();
  await seed(dir, '55', { account: { id: '99', handle: 'someone' } });
  assert.equal(await resolveAccountDir(ACCOUNT, dir, { id: '55' }), null);
});

test('resolveAccountDir is null for an account nothing has archived', async () => {
  assert.equal(await resolveAccountDir(ACCOUNT, await root(), { id: '55' }), null);
});

test('the ids on a platform are the mapping keys plus the folders that are not aliases', async () => {
  const dir = await root();
  await seed(dir, '66', { account: { id: '66' } });
  await seed(dir, 'jia', { account: { id: '55', alias: 'jia' } });
  await writeAlias(dir, PLATFORM, '55', 'jia');

  assert.deepEqual([...(await existingIds(ACCOUNT, dir))].sort(), ['55', '66']);
});

test('an alias that is another account id is refused, even while that folder is aliased away', async () => {
  // 55 is aliased to jia, so x/55 is free — but unaliasing 55 would then want a
  // folder another account had taken. The id is what is reserved, not the path.
  const dir = await root();
  await seed(dir, 'jia', { account: { id: '55', alias: 'jia' } });
  await writeAlias(dir, PLATFORM, '55', 'jia');

  const verdict = await checkAlias(ACCOUNT, dir, { id: '77', alias: '55' });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /id/);
});

test('an alias already taken by another account is refused, and names the account holding it', async () => {
  const dir = await root();
  await seed(dir, 'jia', { account: { id: '55', alias: 'jia' } });
  await writeAlias(dir, PLATFORM, '55', 'jia');

  const verdict = await checkAlias(ACCOUNT, dir, { id: '77', alias: 'jia' });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /55/);
});

test('re-passing the alias an account already has is not a collision with itself', async () => {
  const dir = await root();
  await seed(dir, 'jia', { account: { id: '55', alias: 'jia' } });
  await writeAlias(dir, PLATFORM, '55', 'jia');

  assert.equal((await checkAlias(ACCOUNT, dir, { id: '55', alias: 'jia' })).ok, true);
});

test('a malformed alias is refused without the filesystem being consulted', async () => {
  const verdict = await checkAlias(ACCOUNT, '/no/such/root', { id: '55', alias: 'two words' });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /alias/);
});

test('applyAlias names the folder for a brand new account', async () => {
  const dir = await root();
  assert.equal(await applyAlias(ACCOUNT, dir, { id: '55', alias: 'jia' }), aliasDirFor(ACCOUNT, dir, 'jia'));
});

test('applyAlias moves an existing archive, contents and all', async () => {
  const dir = await root();
  const before = await seed(dir, '55', { account: { id: '55', handle: 'someone' } });
  await mkdir(path.join(before, 'posts', '2024-01-01_1'), { recursive: true });

  const after = await applyAlias(ACCOUNT, dir, { id: '55', alias: 'jia' });
  assert.equal(after, aliasDirFor(ACCOUNT, dir, 'jia'));
  assert.deepEqual((await readdir(path.join(after, 'posts'))).sort(), ['2024-01-01_1']);
  assert.equal(await readAccount(before), null);
});

test('applyAlias adopts a folder the same account is already sitting in', async () => {
  // What a crash between the move and the record leaves behind, and what a hand
  // rename leaves. Refusing here would strand the user with a folder they could
  // not re-alias.
  const dir = await root();
  const folder = await seed(dir, 'jia', { account: { id: '55', handle: 'someone' } });
  assert.equal(await applyAlias(ACCOUNT, dir, { id: '55', alias: 'jia' }), folder);
});

test('applyAlias refuses to move onto another account, and never merges', async () => {
  const dir = await root();
  await seed(dir, '55', { account: { id: '55' } });
  await seed(dir, 'jia', { account: { id: '99' } });
  await assert.rejects(() => applyAlias(ACCOUNT, dir, { id: '55', alias: 'jia' }), /99/);
});

test('applyAlias refuses a destination it cannot identify', async () => {
  const dir = await root();
  await seed(dir, '55', { account: { id: '55' } });
  await mkdir(path.join(dir, PLATFORM, 'jia'), { recursive: true });
  await assert.rejects(() => applyAlias(ACCOUNT, dir, { id: '55', alias: 'jia' }), /jia/);
});

test('applyAlias refuses when one account has somehow ended up in two folders', async () => {
  const dir = await root();
  await seed(dir, '55', { account: { id: '55' } });
  await seed(dir, 'jia', { account: { id: '55' } });
  await assert.rejects(() => applyAlias(ACCOUNT, dir, { id: '55', alias: 'jia' }), /two folders/);
});

test('recordIdentity derives the alias from where the folder actually is', async () => {
  // Q14, as one rule rather than a reconciliation pass: account.json's alias is
  // always the folder's own name, so a hand-rename is adopted by writing.
  const dir = await root();
  const folder = await seed(dir, 'jiahai', { account: { id: '55', handle: 'someone', alias: 'jia' } });
  await writeAlias(dir, PLATFORM, '55', 'jia');

  await recordIdentity(ACCOUNT, dir, folder, { account: { id: '55', handle: 'someone' } });

  assert.equal((await readAccount(folder)).account.alias, 'jiahai');
  assert.deepEqual(await readAliases(dir, PLATFORM), { 55: 'jiahai' });
});

test('recordIdentity finds the id in the folder when the caller has none', async () => {
  // The folder already says whose it is, and a caller that passes only a url —
  // the write a finished run makes, after the move — must still be able to
  // record where the account now lives. Guarding on the *caller's* id left
  // account.json holding an alias that archiver.json had never heard of.
  const dir = await root();
  const folder = await seed(dir, 'jia', { account: { id: '55', handle: 'someone' } });

  await recordIdentity(ACCOUNT, dir, folder, { url: 'https://x.com/someone' });

  assert.equal((await readAccount(folder)).account.alias, 'jia');
  assert.deepEqual(await readAliases(dir, PLATFORM), { 55: 'jia' });
});

test('recordIdentity leaves no alias on a folder that is named for its id', async () => {
  const dir = await root();
  const folder = await seed(dir, '55', { account: { id: '55', alias: 'jia' } });
  await writeAlias(dir, PLATFORM, '55', 'jia');

  await recordIdentity(ACCOUNT, dir, folder, { account: { id: '55', handle: 'someone' } });

  assert.equal('alias' in (await readAccount(folder)).account, false);
  assert.deepEqual(await readAliases(dir, PLATFORM), {});
});

test('clearAlias puts the folder back under the id', async () => {
  const dir = await root();
  await seed(dir, 'jia', { account: { id: '55', handle: 'someone', alias: 'jia' } });
  await writeAlias(dir, PLATFORM, '55', 'jia');

  const back = await clearAlias(ACCOUNT, dir, { id: '55' });
  assert.equal(back, accountDirFor(ACCOUNT, dir, '55'));
  assert.equal((await readAccount(back)).account.id, '55');
  assert.equal('alias' in (await readAccount(back)).account, false);
  assert.deepEqual(await readAliases(dir, PLATFORM), {});
});

test('clearAlias on an account that never had one is not an error', async () => {
  const dir = await root();
  const folder = await seed(dir, '55', { account: { id: '55' } });
  assert.equal(await clearAlias(ACCOUNT, dir, { id: '55' }), folder);
});

// ---- the descriptor is the only thing that varies -------------------------

test('each platform files its accounts under its own folder', () => {
  // The collision barrier: two platforms, two folders, so a sec_uid and an X
  // user id cannot name the same directory and an alias chosen on one cannot
  // collide with one chosen on the other.
  const douyin = descriptorFor('douyin');
  assert.equal(platformDir(douyin, '/data'), path.join('/data', 'douyin'));
  assert.equal(platformDir(ACCOUNT, '/data'), path.join('/data', 'x'));
  assert.notEqual(
    accountDirFor(douyin, '/data', 'MS4wSEC'),
    accountDirFor(ACCOUNT, '/data', 'MS4wSEC'),
  );
});

test('account.json names the handle the way its own platform does', async () => {
  // 抖音号 for Douyin, @handle for X — the one field whose *name* differs, and
  // the reason the descriptor exists at all.
  const douyin = descriptorFor('douyin');
  const dir = await root();

  const folder = path.join(dir, 'douyin', 'MS4wSEC');
  await recordIdentity(douyin, dir, folder, {
    account: { id: 'MS4wSEC', douyin_id: 'abc123', nickname: '小明' },
    url: 'https://www.douyin.com/user/MS4wSEC',
  });

  const json = await readAccount(folder);
  assert.equal(json.platform, 'douyin');
  assert.equal(json.account.douyin_id, 'abc123');
  assert.ok(!('handle' in json.account), 'X\'s key must not appear on a Douyin account');
});

test('a Douyin account is found by its 抖音号, an X account by its handle', async () => {
  const douyin = descriptorFor('douyin');
  const dir = await root();
  const folder = path.join(dir, 'douyin', 'MS4wSEC');
  await recordIdentity(douyin, dir, folder, {
    account: { id: 'MS4wSEC', douyin_id: 'abc123', nickname: '小明' },
  });

  assert.equal(await findAccountDir(douyin, dir, { handle: 'abc123' }), folder);
  // The same lookup under X's descriptor reads a key that is not there.
  assert.equal(await findAccountDir(ACCOUNT, dir, { handle: 'abc123' }), null);
});
