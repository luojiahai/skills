import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  METADATA_VERSION,
  findAccountFolder,
  findFolderByUrl,
  folderNameFor,
  matchesAccount,
  mergeMetadata,
  readMetadata,
  resolveFolder,
  writeMetadata,
} from './metadata.mjs';

test('folderNameFor uses the handle by default', () => {
  assert.equal(folderNameFor({ handle: 'someone' }), 'x_someone');
});

test('folderNameFor prefers an explicit --name', () => {
  assert.equal(folderNameFor({ handle: 'someone', name: 'my archive' }), 'x_my archive');
});

test('folderNameFor drops a leading @ so the folder is not @someone', () => {
  assert.equal(folderNameFor({ handle: '@someone' }), 'x_someone');
});

test('folderNameFor prefixes --name too, so no name can collide with another site', () => {
  // The prefix is what keeps this skill's folders apart from douyin-downloader's
  // in a shared downloads root. A --name that could opt out would re-open the
  // clash in the one case the user is least likely to be thinking about it.
  assert.equal(folderNameFor({ handle: 'someone', name: 'douyin_someone' }), 'x_douyin_someone');
});

test('matchesAccount compares ids as strings, not by type', () => {
  assert.equal(matchesAccount({ account: { id: 55 } }, '55'), true);
  assert.equal(matchesAccount({ account: { id: '55' } }, 55), true);
  assert.equal(matchesAccount({ account: { id: '56' } }, '55'), false);
  assert.equal(matchesAccount(null, '55'), false);
  assert.equal(matchesAccount({}, '55'), false);
});

test('mergeMetadata keeps what an earlier run knew', () => {
  // A run that fetched one post by URL knows the account but was never told a
  // root, and must not erase the one the last run recorded.
  const merged = mergeMetadata(
    { account: { id: '55', handle: 'old', nickname: 'Old Name' }, root: '/data', url: 'https://x.com/old' },
    { account: { handle: 'new' }, updated_at: 'today' },
  );
  assert.equal(merged.account.id, '55');
  assert.equal(merged.account.handle, 'new');
  assert.equal(merged.account.nickname, 'Old Name');
  assert.equal(merged.root, '/data');
  assert.equal(merged.url, 'https://x.com/old');
  assert.equal(merged.updated_at, 'today');
  assert.equal(merged.version, METADATA_VERSION);
});

test('mergeMetadata works from nothing', () => {
  const merged = mergeMetadata(null, { account: { id: '55' } });
  assert.equal(merged.account.id, '55');
  assert.equal(merged.root, null);
  assert.equal(merged.url, null);
});

test('mergeMetadata treats a blank as silence, not as an erasure', () => {
  // An enumeration that yielded rows but never named the account falls back to
  // blanks. Written through, they would erase an id a previous run had.
  const merged = mergeMetadata(
    { account: { id: '55', handle: 'someone', nickname: 'Some One' } },
    { account: { id: '', handle: 'someone', nickname: '' } },
  );
  assert.equal(merged.account.id, '55');
  assert.equal(merged.account.nickname, 'Some One');
});

test('the account reads in the same order however it was learned', () => {
  const merged = mergeMetadata(
    { account: { nickname: 'Some One' } },
    { account: { handle: 'someone', id: '55', verified: 'ignored' } },
  );
  assert.deepEqual(Object.keys(merged.account), ['id', 'handle', 'nickname']);
});

test('mergeMetadata keeps only the fields this file is for', () => {
  // Everything here answers "which account is this folder", and nothing answers
  // "what has been downloaded" — posts/ is the only record of that. A count or
  // a newest-post id would be a second answer, stale from the moment it lands.
  const merged = mergeMetadata(
    { collected_count: 86, newest_post_id: '7000', folder: 'x_someone' },
    { account: { id: '55' }, root: '/data', url: 'https://x.com/someone', updated_at: 'today' },
  );
  assert.deepEqual(Object.keys(merged).sort(), ['account', 'root', 'updated_at', 'url', 'version']);
});

async function root() {
  return mkdtemp(path.join(os.tmpdir(), 'x-dl-root-'));
}

async function seed(dir, folder, metadata) {
  await mkdir(path.join(dir, folder), { recursive: true });
  await writeFile(
    path.join(dir, folder, 'metadata.json'),
    JSON.stringify({ version: METADATA_VERSION, ...metadata }),
  );
}

test('findAccountFolder finds an account by the identity inside its folder', async () => {
  const dir = await root();
  await seed(dir, 'oldhandle', { account: { id: '55', handle: 'oldhandle' } });
  assert.equal(await findAccountFolder(dir, '55'), 'oldhandle');
});

test('a file from a version this one cannot read is not an archive', async () => {
  // Its fields may be numbered differently, so matching an id inside it would
  // be a guess. Unmatched is the honest answer, and the same one a folder
  // nobody has archived into gives.
  const dir = await root();
  await mkdir(path.join(dir, 'x_someone'), { recursive: true });
  await writeFile(
    path.join(dir, 'x_someone', 'metadata.json'),
    JSON.stringify({ version: METADATA_VERSION + 1, account: { id: '55' }, url: 'https://x.com/someone' }),
  );
  assert.equal(await findAccountFolder(dir, '55'), null);
  assert.equal(await findFolderByUrl(dir, 'https://x.com/someone'), null);
});

test('findAccountFolder is null when the account is not here', async () => {
  assert.equal(await findAccountFolder(await root(), '55'), null);
});

test('findAccountFolder tolerates a root that does not exist yet', async () => {
  assert.equal(await findAccountFolder('/no/such/root', '55'), null);
});

test('a plan alone no longer claims a folder', async () => {
  // metadata.json is written the moment the folder is resolved, so a plan is
  // never the only file naming the account — and reading identity out of two
  // files is two answers free to disagree.
  const dir = await root();
  await mkdir(path.join(dir, 'someone'));
  await writeFile(path.join(dir, 'someone', '.plan.json'), JSON.stringify({ account: { id: '55' } }));
  assert.equal(await findAccountFolder(dir, '55'), null);
});

test('a renamed account keeps the folder it already has', async () => {
  const dir = await root();
  await seed(dir, 'x_oldhandle', { account: { id: '55', handle: 'oldhandle' } });
  const folder = await resolveFolder({ root: dir, accountId: '55', handle: 'newhandle' });
  assert.equal(folder, 'x_oldhandle');
});

test('an account nobody has archived gets a folder named for its handle', async () => {
  const dir = await root();
  assert.equal(await resolveFolder({ root: dir, accountId: '55', handle: 'newhandle' }), 'x_newhandle');
});

test('writeMetadata merges rather than overwrites', async () => {
  const dir = path.join(await root(), 'someone');
  await writeMetadata(dir, { account: { id: '55', handle: 'someone' }, root: '/data' });
  const merged = await writeMetadata(dir, { updated_at: 'second' });
  assert.equal(merged.account.id, '55');
  assert.equal(merged.root, '/data');
  assert.equal(merged.updated_at, 'second');
});

test('writeMetadata stamps the version and creates the folder', async () => {
  const dir = path.join(await root(), 'someone');
  const written = await writeMetadata(dir, { account: { id: '55' } });
  assert.equal(written.version, METADATA_VERSION);
  assert.deepEqual(await readMetadata(dir), written);
});

test('readMetadata reads nothing as null rather than failing', async () => {
  assert.equal(await readMetadata(path.join(await root(), 'nobody')), null);
});

test('findFolderByUrl finds the folder --go is looking for', async () => {
  const dir = await root();
  await seed(dir, 'x_oldhandle', { account: { id: '55' }, url: 'https://x.com/newhandle' });
  // --go enumerates nothing, so it never learns the numeric id. Without this
  // the run looks in a folder named for the new handle, finds no plan, and
  // refuses with a hint that walks straight back into the same loop.
  assert.equal(await findFolderByUrl(dir, 'https://x.com/newhandle'), 'x_oldhandle');
});

test('findFolderByUrl is null for a URL nothing here was archived from', async () => {
  assert.equal(await findFolderByUrl(await root(), 'https://x.com/nobody'), null);
  assert.equal(await findFolderByUrl(await root(), ''), null);
});
