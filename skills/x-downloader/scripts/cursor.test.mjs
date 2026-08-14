import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  CURSOR_VERSION,
  findAccountFolder,
  findFolderByUrl,
  folderNameFor,
  matchesAccount,
  mergeCursor,
  resolveFolder,
  writeCursor,
} from './cursor.mjs';

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

test('mergeCursor keeps what an earlier run knew', () => {
  const merged = mergeCursor(
    { account: { id: '55', handle: 'old' }, lastFullSweep: 'yesterday' },
    { account: { handle: 'new' }, lastRun: 'today' },
  );
  assert.equal(merged.account.id, '55');
  assert.equal(merged.account.handle, 'new');
  assert.equal(merged.lastFullSweep, 'yesterday');
  assert.equal(merged.lastRun, 'today');
  assert.equal(merged.version, CURSOR_VERSION);
});

test('mergeCursor works from nothing', () => {
  const merged = mergeCursor(null, { account: { id: '55' } });
  assert.equal(merged.account.id, '55');
});

async function root() {
  return mkdtemp(path.join(os.tmpdir(), 'x-dl-root-'));
}

test('findAccountFolder finds an account by the identity inside its folder', async () => {
  const dir = await root();
  await mkdir(path.join(dir, 'oldhandle'));
  await writeFile(
    path.join(dir, 'oldhandle', 'cursor.json'),
    JSON.stringify({ account: { id: '55', handle: 'oldhandle' } }),
  );
  assert.equal(await findAccountFolder(dir, '55'), 'oldhandle');
});

test('findAccountFolder finds an account planned but never downloaded', async () => {
  const dir = await root();
  await mkdir(path.join(dir, 'someone'));
  await writeFile(
    path.join(dir, 'someone', '.plan.json'),
    JSON.stringify({ account: { id: '55' } }),
  );
  assert.equal(await findAccountFolder(dir, '55'), 'someone');
});

test('findAccountFolder is null when the account is not here', async () => {
  assert.equal(await findAccountFolder(await root(), '55'), null);
});

test('findAccountFolder tolerates a root that does not exist yet', async () => {
  assert.equal(await findAccountFolder('/no/such/root', '55'), null);
});

test('a renamed account keeps the folder it already has', async () => {
  const dir = await root();
  await mkdir(path.join(dir, 'x_oldhandle'));
  await writeFile(
    path.join(dir, 'x_oldhandle', 'cursor.json'),
    JSON.stringify({ account: { id: '55', handle: 'oldhandle' } }),
  );
  const folder = await resolveFolder({ root: dir, accountId: '55', handle: 'newhandle' });
  assert.equal(folder, 'x_oldhandle');
});

test('an account nobody has archived gets a folder named for its handle', async () => {
  const dir = await root();
  assert.equal(await resolveFolder({ root: dir, accountId: '55', handle: 'newhandle' }), 'x_newhandle');
});

test('writeCursor merges rather than overwrites', async () => {
  const dir = path.join(await root(), 'someone');
  await writeCursor(dir, { account: { id: '55', handle: 'someone' }, lastRun: 'first' });
  const merged = await writeCursor(dir, { lastRun: 'second' });
  assert.equal(merged.account.id, '55');
  assert.equal(merged.lastRun, 'second');
});

test('findFolderByUrl finds the plan --go is looking for', async () => {
  const dir = await root();
  await mkdir(path.join(dir, 'oldhandle'));
  await writeFile(
    path.join(dir, 'oldhandle', '.plan.json'),
    JSON.stringify({ account: { id: '55' }, url: 'https://x.com/newhandle' }),
  );
  // --go enumerates nothing, so it never learns the numeric id. Without this
  // the run looks in a folder named for the new handle, finds no plan, and
  // refuses with a hint that walks straight back into the same loop.
  assert.equal(await findFolderByUrl(dir, 'https://x.com/newhandle'), 'oldhandle');
});

test('findFolderByUrl falls back to a cursor when no plan is pending', async () => {
  const dir = await root();
  await mkdir(path.join(dir, 'oldhandle'));
  await writeFile(
    path.join(dir, 'oldhandle', 'cursor.json'),
    JSON.stringify({ account: { id: '55' }, url: 'https://x.com/newhandle' }),
  );
  assert.equal(await findFolderByUrl(dir, 'https://x.com/newhandle'), 'oldhandle');
});

test('findFolderByUrl is null for a URL nothing here was archived from', async () => {
  assert.equal(await findFolderByUrl(await root(), 'https://x.com/nobody'), null);
  assert.equal(await findFolderByUrl(await root(), ''), null);
});
