/**
 * Tests for metadata.mjs — run with:
 *   node --test scripts/metadata.test.mjs
 *
 * The merge rules, the folder naming and finding an account's folder are
 * covered here. The CLI wrapper around them is exercised by hand against a live
 * archive.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  METADATA_VERSION,
  findAccountFolder,
  folderNameFor,
  mergeMetadata,
  readMetadata,
  writeMetadata,
} from './metadata.mjs';

const NOW = '2026-08-14T10:00:00Z';

test('mergeMetadata prefers what this run knows', () => {
  const metadata = mergeMetadata(
    { account: { sec_uid: 'MS4wOLD', douyin_id: 'old123', nickname: '旧名' } },
    { account: { sec_uid: 'MS4wNEW', douyin_id: 'new123', nickname: '新名' } },
  );
  assert.equal(metadata.account.sec_uid, 'MS4wNEW');
  assert.equal(metadata.account.douyin_id, 'new123');
  assert.equal(metadata.account.nickname, '新名');
  assert.equal(metadata.version, METADATA_VERSION);
});

test('mergeMetadata keeps what an earlier run knew', () => {
  // A single-post download reads the 抖音号 off the post and never opens the
  // profile, so it has no nickname to offer. Silence must not erase one.
  const metadata = mergeMetadata(
    {
      account: { sec_uid: 'MS4wOLD', nickname: '旧名' },
      url: 'https://www.douyin.com/user/MS4wOLD',
      root: '/proj/archives',
    },
    { account: { douyin_id: 'abc123' }, updated_at: NOW },
  );
  assert.equal(metadata.account.sec_uid, 'MS4wOLD');
  assert.equal(metadata.account.nickname, '旧名');
  assert.equal(metadata.account.douyin_id, 'abc123');
  assert.equal(metadata.url, 'https://www.douyin.com/user/MS4wOLD');
  assert.equal(metadata.root, '/proj/archives');
  assert.equal(metadata.updated_at, NOW);
});

test('mergeMetadata treats an absent field as silence, not as an erasure', () => {
  // The collector's metadata carries every key it knows *of*, null where it
  // found nothing. Spread as-is, a null would overwrite a name a full sweep had
  // already recorded.
  const metadata = mergeMetadata(
    { account: { sec_uid: 'MS4wOLD', nickname: '旧名' } },
    { account: { sec_uid: null, douyin_id: 'abc123', nickname: '' } },
  );
  assert.equal(metadata.account.sec_uid, 'MS4wOLD');
  assert.equal(metadata.account.nickname, '旧名');
  assert.equal(metadata.account.douyin_id, 'abc123');
});

test('the account reads in the same order however it was learned', () => {
  const metadata = mergeMetadata(
    { account: { nickname: '某人' } },
    { account: { douyin_id: 'abc123', sec_uid: 'MS4wABC', gender: 'ignored' } },
  );
  assert.deepEqual(Object.keys(metadata.account), ['sec_uid', 'douyin_id', 'nickname']);
});

test('mergeMetadata starts from nothing on a first run', () => {
  const metadata = mergeMetadata(null, { account: { douyin_id: 'abc123' } });
  assert.deepEqual(metadata.account, { douyin_id: 'abc123' });
  assert.equal(metadata.url, null);
  assert.equal(metadata.root, null);
});

test('mergeMetadata keeps only the fields this file is for', () => {
  // Identity, and where it came from. What has been downloaded is answered by
  // the post folders and by nothing else, so a count or a newest-post id copied
  // forward from an older file is dropped rather than kept up to date.
  const metadata = mergeMetadata(
    { collected_count: 86, newest_post_id: '7000', folder_name: 'douyin_abc123' },
    { account: { douyin_id: 'abc123' }, root: '/data', url: 'https://x', updated_at: NOW },
  );
  assert.deepEqual(Object.keys(metadata).sort(), ['account', 'root', 'updated_at', 'url', 'version']);
});

async function root() {
  return mkdtemp(path.join(os.tmpdir(), 'douyin-dl-root-'));
}

async function seed(dir, folder, metadata) {
  await mkdir(path.join(dir, folder), { recursive: true });
  await writeFile(
    path.join(dir, folder, 'metadata.json'),
    JSON.stringify({ version: METADATA_VERSION, ...metadata }),
  );
}

test('findAccountFolder finds an account by either identifier', async () => {
  const dir = await root();
  await seed(dir, 'douyin_my archive', {
    account: { sec_uid: 'MS4wABC', douyin_id: 'abc123' },
  });
  assert.equal(await findAccountFolder(dir, { secUid: 'MS4wABC' }), 'douyin_my archive');
  assert.equal(await findAccountFolder(dir, { douyinId: 'abc123' }), 'douyin_my archive');
});

test('findAccountFolder is null for an account nothing here holds', async () => {
  const dir = await root();
  await seed(dir, 'douyin_other', { account: { sec_uid: 'MS4wOTHER', douyin_id: 'other' } });
  assert.equal(await findAccountFolder(dir, { secUid: 'MS4wABC' }), null);
  assert.equal(await findAccountFolder(dir, {}), null);
});

test('a file from a version this one cannot read is not an archive', async () => {
  // Its fields may be numbered differently, so matching an identifier inside it
  // would be a guess. Unmatched is the honest answer, and the same one a folder
  // nobody has archived into gives.
  const dir = await root();
  await seed(dir, 'douyin_abc123', {
    version: METADATA_VERSION + 1,
    account: { sec_uid: 'MS4wABC', douyin_id: 'abc123' },
  });
  assert.equal(await findAccountFolder(dir, { secUid: 'MS4wABC' }), null);
  assert.equal(await findAccountFolder(dir, { douyinId: 'abc123' }), null);
});

test('findAccountFolder tolerates a root that does not exist yet', async () => {
  assert.equal(await findAccountFolder('/no/such/root', { douyinId: 'abc123' }), null);
});

test('a plan alone no longer claims a folder', async () => {
  // metadata.json is written the moment the folder is resolved, so a plan is
  // never the only file naming the account — and reading identity out of two
  // files is two answers free to disagree.
  const dir = await root();
  await mkdir(path.join(dir, 'douyin_abc123'));
  await writeFile(
    path.join(dir, 'douyin_abc123', '.plan.json'),
    JSON.stringify({ sec_uid: 'MS4wABC', douyin_id: 'abc123' }),
  );
  assert.equal(await findAccountFolder(dir, { secUid: 'MS4wABC' }), null);
});

test('writeMetadata merges rather than overwrites, and creates the folder', async () => {
  const folder = path.join(await root(), 'douyin_abc123');
  await writeMetadata(folder, {
    account: { douyin_id: 'abc123', nickname: '某人' },
    root: '/data',
  });
  const merged = await writeMetadata(folder, { account: { sec_uid: 'MS4wABC' }, updated_at: NOW });

  assert.deepEqual(await readMetadata(folder), merged);
  assert.equal(merged.account.nickname, '某人');
  assert.equal(merged.account.sec_uid, 'MS4wABC');
  assert.equal(merged.root, '/data');
  assert.equal(merged.updated_at, NOW);
});

test('readMetadata reads nothing as null rather than failing', async () => {
  assert.equal(await readMetadata(path.join(await root(), 'nobody')), null);
});

test('folderNameFor uses the 抖音号 by default', () => {
  assert.equal(folderNameFor({ douyinId: 'abc123' }), 'douyin_abc123');
});

test('folderNameFor prefers an explicit --name', () => {
  assert.equal(folderNameFor({ douyinId: 'abc123', name: 'my archive' }), 'douyin_my archive');
});

test('folderNameFor prefixes --name too, so no name can collide with another site', () => {
  // The prefix is what keeps this skill's folders apart from x-archiver's in
  // a shared archives root — both default to <git root>/archives. A --name
  // free to drop it would re-open the clash where nobody is looking for it.
  assert.equal(folderNameFor({ douyinId: 'abc123', name: 'x_someone' }), 'douyin_x_someone');
});
