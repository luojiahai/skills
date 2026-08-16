import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ASSETS_DIR, saveAsset, saveProfileAssets, sniffExtension } from './assets.mjs';

const accountDir = () => mkdtemp(path.join(os.tmpdir(), 'x-assets-'));

const bytes = (...head) => new Uint8Array([...head, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

/** A fetch that answers every URL with the same bytes. */
const serving = (body, { ok = true } = {}) => async () => ({
  ok,
  arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
});

test('the file type is read from the bytes, not from the URL', () => {
  // X's banner URLs carry no extension at all, so there is nothing in the path
  // to take one from.
  assert.equal(sniffExtension(JPEG), 'jpg');
  assert.equal(sniffExtension(PNG), 'png');
  assert.equal(sniffExtension(bytes(0x47, 0x49, 0x46, 0x38)), 'gif');
  assert.equal(
    sniffExtension(new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50])),
    'webp',
  );
});

test('bytes of no recognised type are kept without claiming a format', () => {
  assert.equal(sniffExtension(bytes(1, 2, 3, 4)), 'bin');
  assert.equal(sniffExtension(new Uint8Array()), 'bin');
  assert.equal(sniffExtension(undefined), 'bin');
});

test('saveAsset writes the bytes under the sniffed extension', async () => {
  const dir = await accountDir();
  assert.equal(await saveAsset(dir, 'avatar', 'https://pbs.twimg.com/x', { fetchImpl: serving(JPEG) }), 'avatar.jpg');
  assert.deepEqual(new Uint8Array(await readFile(path.join(dir, ASSETS_DIR, 'avatar.jpg'))), JPEG);
});

test('an avatar that changed format does not leave both files behind', async () => {
  // Otherwise nothing on disk says which one the account currently uses.
  const dir = await accountDir();
  await saveAsset(dir, 'avatar', 'https://x/1', { fetchImpl: serving(PNG) });
  await saveAsset(dir, 'avatar', 'https://x/2', { fetchImpl: serving(JPEG) });
  assert.deepEqual(await readdir(path.join(dir, ASSETS_DIR)), ['avatar.jpg']);
});

test('replacing the avatar leaves the banner alone', async () => {
  const dir = await accountDir();
  await saveProfileAssets(dir, { avatar: 'https://x/a', banner: 'https://x/b' }, { fetchImpl: serving(PNG) });
  await saveAsset(dir, 'avatar', 'https://x/a2', { fetchImpl: serving(JPEG) });
  assert.deepEqual((await readdir(path.join(dir, ASSETS_DIR))).sort(), ['avatar.jpg', 'banner.png']);
});

test('a file that merely starts with the asset name is not swept up', async () => {
  const dir = await accountDir();
  await mkdir(path.join(dir, ASSETS_DIR), { recursive: true });
  await writeFile(path.join(dir, ASSETS_DIR, 'avatar.2019.jpg'), 'kept by hand');
  await saveAsset(dir, 'avatar', 'https://x/1', { fetchImpl: serving(JPEG) });
  assert.deepEqual((await readdir(path.join(dir, ASSETS_DIR))).sort(), ['avatar.2019.jpg', 'avatar.jpg']);
});

test('an account with no banner gets no banner file', async () => {
  // gallery-dl reports an empty string for an account that has never set one.
  const dir = await accountDir();
  const saved = await saveProfileAssets(dir, { avatar: 'https://x/a', banner: '' }, { fetchImpl: serving(JPEG) });
  assert.deepEqual(saved, { avatar: 'avatar.jpg', banner: null });
  assert.deepEqual(await readdir(path.join(dir, ASSETS_DIR)), ['avatar.jpg']);
});

test('a CDN failure is null, never a thrown error', async () => {
  // An avatar is decoration beside the posts. It must not end a run that is
  // fetching an account's entire history.
  const dir = await accountDir();
  assert.equal(await saveAsset(dir, 'avatar', 'https://x/1', { fetchImpl: serving(JPEG, { ok: false }) }), null);
  assert.equal(
    await saveAsset(dir, 'avatar', 'https://x/1', { fetchImpl: async () => { throw new Error('offline'); } }),
    null,
  );
});

test('an empty response is not written as an empty avatar', async () => {
  const dir = await accountDir();
  assert.equal(
    await saveAsset(dir, 'avatar', 'https://x/1', { fetchImpl: serving(new Uint8Array()) }),
    null,
  );
});
