import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { countMedia, isPostComplete, readArchive } from './archive.mjs';

test('countMedia counts media and nothing else', () => {
  assert.equal(countMedia(['1.jpg', '2.jpg', 'text.txt']), 2);
});

test('countMedia ignores dotfiles and part files', () => {
  assert.equal(countMedia(['1.jpg', '.DS_Store', '2.mp4.part']), 1);
});

test('countMedia of an empty folder is zero', () => {
  assert.equal(countMedia([]), 0);
});

test('isPostComplete needs every file the post carries', () => {
  assert.equal(isPostComplete(4, 4), true);
  assert.equal(isPostComplete(2, 4), false);
});

test('isPostComplete treats a text-only folder as incomplete', () => {
  assert.equal(isPostComplete(0, 3), false);
  assert.equal(isPostComplete(0, undefined), false);
});

test('isPostComplete without an expected count claims only "has files"', () => {
  assert.equal(isPostComplete(1, undefined), true);
  assert.equal(isPostComplete(1, 0), true);
});

async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'x-dl-'));
  const posts = path.join(dir, 'posts');
  await mkdir(posts, { recursive: true });
  return { dir, posts };
}

test('readArchive indexes post folders by tweet id', async () => {
  const { dir, posts } = await fixture();
  const folder = path.join(posts, '2024-03-11 - a trip [1767]');
  await mkdir(folder);
  await writeFile(path.join(folder, '1.jpg'), 'x');
  await writeFile(path.join(folder, 'text.txt'), 'x');

  const archive = await readArchive(dir);
  assert.deepEqual(archive.get('1767'), {
    folder: '2024-03-11 - a trip [1767]',
    mediaCount: 1,
  });
});

test('readArchive of an account nobody has downloaded is empty, not an error', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'x-dl-'));
  const archive = await readArchive(dir);
  assert.equal(archive.size, 0);
});

test('readArchive ignores folders that carry no id', async () => {
  const { dir, posts } = await fixture();
  await mkdir(path.join(posts, 'scratch'));
  const archive = await readArchive(dir);
  assert.equal(archive.size, 0);
});

test('readArchive reports a half-finished post as incomplete', async () => {
  const { dir, posts } = await fixture();
  const folder = path.join(posts, '2024-03-11 [900]');
  await mkdir(folder);
  await writeFile(path.join(folder, '1.jpg'), 'x');
  await writeFile(path.join(folder, 'text.txt'), 'x');

  const archive = await readArchive(dir);
  assert.equal(isPostComplete(archive.get('900').mediaCount, 4), false);
});
