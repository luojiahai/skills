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

const root = () => mkdtemp(path.join(os.tmpdir(), 'douyin-account-'));

async function seed(dir, secUid, json) {
  const folder = path.join(dir, PLATFORM, secUid);
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

test('mergeAccount keeps what an earlier run knew', () => {
  // A single-post download knows only the 抖音号 and must not erase the
  // nickname a full sweep recorded.
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

test('the account reads in the same order however it was learned', () => {
  const merged = mergeAccount(
    { account: { nickname: '小明' } },
    { account: { name: 'work', douyin_id: 'abc', id: 'MS4wSEC', verified: 'ignored' } },
  );
  assert.deepEqual(Object.keys(merged.account), ['id', 'douyin_id', 'nickname', 'name']);
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

test('a single post finds its account by the 抖音号 it learned', async () => {
  const dir = await root();
  const folder = await seed(dir, 'MS4wSEC', { account: { id: 'MS4wSEC', douyin_id: 'abc123' } });
  assert.equal(await findAccountDir(dir, { douyinId: 'abc123' }), folder);
});

test('--name outranks a 抖音号 that happens to match another account', async () => {
  // The name is the user's own word for this archive; the 抖音号 is what the
  // platform calls it today, and the user can change it.
  const dir = await root();
  await seed(dir, 'MS4wOTHER', { account: { id: 'MS4wOTHER', douyin_id: 'work' } });
  const named = await seed(dir, 'MS4wSEC', { account: { id: 'MS4wSEC', douyin_id: 'abc123', name: 'work' } });
  assert.equal(await findAccountDir(dir, { name: 'work', douyinId: 'work' }), named);
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
