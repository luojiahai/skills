/**
 * Tests for landed.mjs — the rules that decide what is already downloaded.
 *
 * These walk the real filesystem rather than a mock, because the whole point of
 * the module is that the files *are* the record: a fake that answered from
 * memory would be testing the thing this design deliberately does not have.
 *
 * Run: node --test scripts/*.test.mjs
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { POSTS_DIR, isLanded, onDiskIds, postIdFromFolder, readArchive, unlistedIds } from './landed.mjs';
import { POST_FILE, POST_VERSION, buildPost, isComplete, writePost } from './post.mjs';

const root = () => mkdtemp(path.join(os.tmpdir(), 'douyin-archive-'));

/**
 * Builds <account>/posts/<folder>/ holding `files`, described as carrying
 * `listed`. `describe: false` is the folder of a post whose run died before it
 * wrote anything.
 */
async function post(accountDir, folder, files, { listed = files, describe = true } = {}) {
  const dir = path.join(accountDir, POSTS_DIR, folder);
  await mkdir(dir, { recursive: true });
  for (const name of files) await writeFile(path.join(dir, name), 'x');
  if (describe) {
    await writePost(dir, buildPost({ id: folder.split('_')[1], media: listed.map((file) => ({ file, type: 'video' })) }));
  }
  return dir;
}

test('postIdFromFolder reads the id back out', () => {
  assert.equal(postIdFromFolder('2024-03-11_7412345678901234567'), '7412345678901234567');
  assert.equal(postIdFromFolder('undated_55'), '55');
});

test('postIdFromFolder ignores anything that is not a post folder', () => {
  // Other things live under the account dir, and a stray name must not be read
  // as an archived post — that would report a post as downloaded that is not.
  assert.equal(postIdFromFolder('account.json'), null);
  assert.equal(postIdFromFolder('videos'), null);
  assert.equal(postIdFromFolder('2024-3-11_55'), null);
  assert.equal(postIdFromFolder('2024-03-11_'), null);
  assert.equal(postIdFromFolder('_55'), null);
  assert.equal(postIdFromFolder('notadate_55'), null);
});

test('a post is landed when every file it lists is on disk', async () => {
  const dir = await root();
  await post(dir, '2024-03-11_111', ['1.mp4']);
  assert.equal(isLanded((await readArchive(dir)).get('111')), true);
});

test('a post whose media failed is not landed', async () => {
  // Its folder exists and holds post.json — written before the download — and
  // that has to read as still-missing, or a rate-limited run reports itself done.
  const dir = await root();
  await post(dir, '2024-03-12_222', [], { listed: ['1.mp4'] });
  assert.equal(isLanded((await readArchive(dir)).get('222')), false);
});

test('everything yt-dlp leaves behind mid-download fails by construction', () => {
  // .part is a transfer that stopped and .ytdl its resume state. The awkward
  // case is f-prefixed streams: video and audio fetched separately and never
  // merged are whole files, so a folder holding them would read as finished
  // while the post is not playable. Against a named list of expected files,
  // none of them is `1.mp4`.
  const described = buildPost({ id: '1', media: [{ file: '1.mp4', type: 'video' }] });
  assert.equal(isComplete(described, ['1.mp4.part']), false);
  assert.equal(isComplete(described, ['1.mp4.part', '1.mp4.ytdl']), false);
  assert.equal(isComplete(described, ['1.f137.mp4', '1.f140.m4a']), false);
  assert.equal(isComplete(described, ['1.f137.mp4', '1.f140.m4a', '1.mp4']), true);
});

test('a folder with media but no post.json is not a downloaded post', async () => {
  // post.json is written before the first byte, so its absence means the run
  // died before this post was started — or that these files are not ours.
  const dir = await root();
  await post(dir, '2024-03-11_333', ['1.mp4'], { describe: false });
  assert.equal(isLanded((await readArchive(dir)).get('333')), false);
});

test('deleting a post’s media brings it back, even though post.json remains', async () => {
  // The rule the removed --download-archive got wrong: a record that outlives
  // the files goes on claiming a post is done after the user deleted it.
  const dir = await root();
  const folder = await post(dir, '2024-03-11_444', ['1.mp4']);
  await writeFile(path.join(folder, '1.mp4'), 'x');
  assert.equal(isLanded((await readArchive(dir)).get('444')), true);

  const { rm } = await import('node:fs/promises');
  await rm(path.join(folder, '1.mp4'));
  assert.equal(isLanded((await readArchive(dir)).get('444')), false);
});

test('readArchive maps each post id to what is on disk', async () => {
  const dir = await root();
  await post(dir, '2024-03-11_111', ['1.mp4']);
  await post(dir, '2024-03-12_222', [], { listed: ['1.mp4'] });

  const archive = await readArchive(dir);
  assert.equal(archive.get('111').folder, '2024-03-11_111');
  assert.deepEqual(archive.get('111').names.sort(), ['1.mp4', POST_FILE]);
  assert.equal(archive.size, 2);
});

test('readArchive treats a missing posts folder as an empty archive', async () => {
  // A first run has no posts/ yet, and that is not an error.
  assert.equal((await readArchive(await root())).size, 0);
  assert.equal((await readArchive('/no/such/account')).size, 0);
});

test('readArchive ignores files and non-post directories under posts/', async () => {
  const dir = await root();
  await mkdir(path.join(dir, POSTS_DIR), { recursive: true });
  await writeFile(path.join(dir, POSTS_DIR, 'stray.txt'), 'x');
  await mkdir(path.join(dir, POSTS_DIR, 'notes'));
  await post(dir, '2024-03-11_111', ['1.mp4']);

  assert.deepEqual([...(await readArchive(dir)).keys()], ['111']);
});

test('onDiskIds counts only posts that actually hold their media', async () => {
  const dir = await root();
  await post(dir, '2024-03-11_111', ['1.mp4']);
  await post(dir, '2024-03-12_222', [], { listed: ['1.mp4'] });

  assert.deepEqual([...(await onDiskIds(dir))], ['111']);
});

test('unlistedIds finds what is on disk but no longer on the profile', () => {
  const listed = new Set(['111', '222']);
  assert.deepEqual(unlistedIds(listed, new Set(['111', '333'])), ['333']);
  assert.deepEqual(unlistedIds(listed, new Set(['111', '222'])), []);
  assert.deepEqual(unlistedIds(new Set(), new Set(['111'])), ['111']);
});
