import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { isLanded, isMissing, readArchive } from './landed.mjs';
import { buildPost, writePost } from './post.mjs';

async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'x-landed-'));
  const posts = path.join(dir, 'posts');
  await mkdir(posts, { recursive: true });
  return { dir, posts };
}

/** A post folder holding `files`, described as carrying `listed`. */
async function seedPost(posts, folder, { listed, files, describe = true }) {
  const dir = path.join(posts, folder);
  await mkdir(dir, { recursive: true });
  for (const file of files) await writeFile(path.join(dir, file), 'x');
  if (describe) {
    await writePost(dir, buildPost({ id: folder.split('_')[1], media: listed }));
  }
  return dir;
}

test('readArchive indexes post folders by tweet id', async () => {
  const { dir, posts } = await fixture();
  await seedPost(posts, '2024-03-11_1767', { listed: [{ num: 1, ext: 'jpg' }], files: ['1.jpg'] });

  const archive = await readArchive(dir);
  assert.equal(archive.get('1767').folder, '2024-03-11_1767');
  assert.equal(isLanded(archive.get('1767')), true);
});

test('a post whose fourth image failed reads as incomplete', async () => {
  // The whole point of post.json listing its media: before it, this folder held
  // media and so counted as done.
  const { dir, posts } = await fixture();
  await seedPost(posts, '2024-03-11_900', {
    listed: [1, 2, 3, 4].map((num) => ({ num, ext: 'jpg' })),
    files: ['1.jpg', '2.jpg', '3.jpg'],
  });

  const archive = await readArchive(dir);
  assert.equal(isLanded(archive.get('900')), false);
});

test('a folder whose post.json never landed is not a downloaded post', async () => {
  // post.json is written before the first byte of media, so its absence means
  // the run died before this post was started.
  const { dir, posts } = await fixture();
  await seedPost(posts, '2024-03-11_901', { listed: [], files: ['1.jpg'], describe: false });

  assert.equal(isLanded((await readArchive(dir)).get('901')), false);
});

test('deleting a post’s media brings it back, even though post.json remains', async () => {
  // The rule the removed --download-archive got wrong: a record that outlives
  // the files goes on claiming a post is done after the user deleted it.
  const { dir, posts } = await fixture();
  await seedPost(posts, '2024-03-11_902', { listed: [{ num: 1, ext: 'mp4' }], files: [] });

  assert.equal(isLanded((await readArchive(dir)).get('902')), false);
});

test('readArchive of an account nobody has downloaded is empty, not an error', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'x-landed-'));
  assert.equal((await readArchive(dir)).size, 0);
});

test('readArchive ignores folders that carry no id', async () => {
  const { dir, posts } = await fixture();
  await mkdir(path.join(posts, 'scratch'));
  assert.equal((await readArchive(dir)).size, 0);
});

test('readArchive does not mistake a stray folder ending in _digits for a post', async () => {
  const { dir, posts } = await fixture();
  await mkdir(path.join(posts, 'drafts_2'));
  await mkdir(path.join(posts, '2024-03-11_1767 copy'));
  assert.equal((await readArchive(dir)).size, 0);
});

test('isMissing is the one rule the plan, the sweep and the fetch loop all use', async () => {
  const { dir, posts } = await fixture();
  await seedPost(posts, '2024-03-11_1767', { listed: [{ num: 1, ext: 'jpg' }], files: ['1.jpg'] });
  const archive = await readArchive(dir);

  assert.equal(isMissing({ tweetId: '1767' }, archive), false);
  assert.equal(isMissing({ tweetId: '9999' }, archive), true);
});
