import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  ACCOUNT_VERSION,
  PLATFORM,
  accountDirFor,
  findAccountDir,
  isSafeId,
  mergeAccount,
  platformDir,
  readAccount,
  writeAccount,
} from './account.mjs';

const root = () => mkdtemp(path.join(os.tmpdir(), 'x-account-'));

async function seed(dir, accountId, json) {
  const folder = path.join(dir, PLATFORM, accountId);
  await mkdir(folder, { recursive: true });
  await writeFile(
    path.join(folder, 'account.json'),
    JSON.stringify({ version: ACCOUNT_VERSION, platform: PLATFORM, ...json }),
  );
  return folder;
}

test('an account folder is the id, under the platform folder', () => {
  assert.equal(accountDirFor('/data', '55'), path.join('/data', 'x', '55'));
  assert.equal(platformDir('/data'), path.join('/data', 'x'));
});

test('an id that would escape the archives root is refused, not sanitised', () => {
  // The id arrives from a subprocess's stdout and lands in a path. A separator
  // here does not make a badly named folder, it makes a tree somewhere else.
  for (const bad of ['..', '.', '', 'a/b', '../../etc', 'a\0b', 'x'.repeat(129)]) {
    assert.equal(isSafeId(bad), false, `expected ${JSON.stringify(bad)} to be refused`);
    assert.throws(() => accountDirFor('/data', bad));
  }
});

test('a real X id is accepted', () => {
  assert.equal(isSafeId('1458023001234567890'), true);
});

test('mergeAccount keeps what an earlier run knew', () => {
  const merged = mergeAccount(
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
  const merged = mergeAccount(
    { account: { id: '55', handle: 'someone', nickname: 'Some One' } },
    { account: { id: '', handle: 'someone', nickname: '' } },
  );
  assert.equal(merged.account.id, '55');
  assert.equal(merged.account.nickname, 'Some One');
});

test('the account reads in the same order however it was learned', () => {
  const merged = mergeAccount(
    { account: { nickname: 'Some One' } },
    { account: { name: 'work', handle: 'someone', id: '55', verified: 'ignored' } },
  );
  assert.deepEqual(Object.keys(merged.account), ['id', 'handle', 'nickname', 'name']);
});

test('account.json holds identity and provenance, and nothing about progress', () => {
  // `root` and `updated_at` used to live here and now belong to sync.json's
  // last_run. Writing the shape out rather than spreading the old file is what
  // stops them surviving in an archive by being copied forward run after run.
  const merged = mergeAccount(
    { root: '/data', updated_at: 'yesterday', collected_count: 86 },
    { account: { id: '55' }, url: 'https://x.com/someone' },
  );
  assert.deepEqual(Object.keys(merged).sort(), ['account', 'platform', 'url', 'version']);
});

test('writeAccount merges rather than overwrites, and creates the folder', async () => {
  const dir = accountDirFor(await root(), '55');
  await writeAccount(dir, { account: { id: '55', handle: 'someone' }, url: 'https://x.com/someone' });
  const merged = await writeAccount(dir, { account: { nickname: 'Some One' } });
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
  assert.equal(await findAccountDir(dir, { url: 'https://x.com/newhandle' }), folder);
});

test('findAccountDir falls back to --name, then to the handle', async () => {
  const dir = await root();
  const byName = await seed(dir, '55', { account: { id: '55', handle: 'someone', name: 'work' } });
  const byHandle = await seed(dir, '66', { account: { id: '66', handle: 'other' } });

  assert.equal(await findAccountDir(dir, { name: 'work' }), byName);
  assert.equal(await findAccountDir(dir, { handle: 'other' }), byHandle);
});

test('--name outranks a handle that happens to match another account', async () => {
  // The name is the user's own word for this archive; the handle is what the
  // platform calls it today. Theirs wins.
  const dir = await root();
  await seed(dir, '66', { account: { id: '66', handle: 'work' } });
  const named = await seed(dir, '55', { account: { id: '55', handle: 'someone', name: 'work' } });
  assert.equal(await findAccountDir(dir, { name: 'work', handle: 'work' }), named);
});

test('a file from a version this build cannot read is not an archive', async () => {
  const dir = await root();
  const folder = path.join(dir, PLATFORM, '55');
  await mkdir(folder, { recursive: true });
  await writeFile(
    path.join(folder, 'account.json'),
    JSON.stringify({ version: ACCOUNT_VERSION + 1, account: { id: '55', handle: 'someone' } }),
  );
  assert.equal(await findAccountDir(dir, { handle: 'someone' }), null);
});

test('findAccountDir is null for a root nothing has been archived into', async () => {
  assert.equal(await findAccountDir(await root(), { handle: 'someone' }), null);
  assert.equal(await findAccountDir('/no/such/root', { handle: 'someone' }), null);
});

test('findAccountDir with nothing to go on matches nothing', async () => {
  const dir = await root();
  await seed(dir, '55', { account: { id: '55', handle: 'someone' } });
  assert.equal(await findAccountDir(dir, {}), null);
});
