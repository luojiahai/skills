/**
 * Tests for archive.mjs — the rules that decide what is already downloaded.
 *
 * These walk the real filesystem rather than a mock, because the whole point of
 * the module is that the files *are* the record: a fake that answered from
 * memory would be testing the thing this design deliberately does not have.
 *
 * Run: node --test scripts/*.test.mjs
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  POSTS_DIR,
  TEXT_FILE,
  countMedia,
  isPostComplete,
  onDiskIds,
  postIdFromFolder,
  readArchive,
  unlistedIds,
} from './archive.mjs';

const root = () => mkdtemp(path.join(os.tmpdir(), 'douyin-archive-'));

/** Builds <account>/posts/<folder>/ holding the given file names. */
async function post(accountDir, folder, files) {
  const dir = path.join(accountDir, POSTS_DIR, folder);
  await mkdir(dir, { recursive: true });
  for (const name of files) await writeFile(path.join(dir, name), 'x');
  return dir;
}

test('postIdFromFolder reads the id back out', () => {
  assert.equal(postIdFromFolder('2024-03-11_7412345678901234567'), '7412345678901234567');
  assert.equal(postIdFromFolder('undated_55'), '55');
});

test('postIdFromFolder ignores anything that is not a post folder', () => {
  // Other things live under the account dir, and a stray name must not be read
  // as an archived post — that would report a post as downloaded that is not.
  assert.equal(postIdFromFolder('metadata.json'), null);
  assert.equal(postIdFromFolder('videos'), null);
  assert.equal(postIdFromFolder('2024-3-11_55'), null);
  assert.equal(postIdFromFolder('2024-03-11_'), null);
  assert.equal(postIdFromFolder('_55'), null);
  assert.equal(postIdFromFolder('notadate_55'), null);
});

test('countMedia counts finished media and nothing else', () => {
  // text.txt is ours and dotfiles are noise; counting either would call an
  // empty post complete.
  assert.equal(countMedia(['1.mp4']), 1);
  assert.equal(countMedia(['1.jpg', '2.jpg', TEXT_FILE]), 2);
  assert.equal(countMedia([TEXT_FILE]), 0);
  assert.equal(countMedia(['.DS_Store', TEXT_FILE]), 0);
});

test('countMedia ignores everything yt-dlp leaves behind mid-download', () => {
  // .part is a transfer that stopped and .ytdl its resume state — but the one
  // that matters is f-prefixed streams: video and audio fetched separately and
  // never merged are whole files, so a folder holding them looks finished while
  // the post is not playable. Counting them retires a post that never landed.
  assert.equal(countMedia(['1.mp4.part']), 0);
  assert.equal(countMedia(['1.mp4.part', '1.mp4.ytdl']), 0);
  assert.equal(countMedia(['1.f137.mp4', '1.f140.m4a']), 0);
  // …and the merged result, once it exists, counts as the one file it is.
  assert.equal(countMedia(['1.f137.mp4', '1.f140.m4a', '1.mp4']), 1);
});

test('isPostComplete needs at least one media file', () => {
  // Douyin's collector yields ids and nothing else, so how many files a post
  // *should* hold is unknowable until it is fetched. One file is the most that
  // can be checked, and it is what distinguishes a fetched post from a folder
  // holding only the text of a download that failed.
  assert.equal(isPostComplete(0), false);
  assert.equal(isPostComplete(1), true);
  assert.equal(isPostComplete(3), true);
});

test('readArchive maps each post id to what is on disk', async () => {
  const dir = await root();
  await post(dir, '2024-03-11_111', ['1.mp4', TEXT_FILE]);
  await post(dir, '2024-03-12_222', [TEXT_FILE]);

  const archive = await readArchive(dir);
  assert.deepEqual(archive.get('111'), { folder: '2024-03-11_111', mediaCount: 1 });
  assert.deepEqual(archive.get('222'), { folder: '2024-03-12_222', mediaCount: 0 });
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

  const archive = await readArchive(dir);
  assert.deepEqual([...archive.keys()], ['111']);
});

test('onDiskIds counts only posts that actually hold media', async () => {
  // The folder of a post whose media failed exists and holds its text.txt. It
  // must read as still-missing, or a rate-limited run would report itself done.
  const dir = await root();
  await post(dir, '2024-03-11_111', ['1.mp4', TEXT_FILE]);
  await post(dir, '2024-03-12_222', [TEXT_FILE]);

  const ids = await onDiskIds(dir);
  assert.deepEqual([...ids], ['111']);
});

test('unlistedIds finds what is on disk but no longer on the profile', () => {
  const listed = new Set(['111', '222']);
  assert.deepEqual(unlistedIds(listed, new Set(['111', '333'])), ['333']);
  assert.deepEqual(unlistedIds(listed, new Set(['111', '222'])), []);
  assert.deepEqual(unlistedIds(new Set(), new Set(['111'])), ['111']);
});

test('the yt-dlp template in download-douyin.sh still produces folder names this module reads', async () => {
  // Nothing here builds a folder name — yt-dlp's output template does, in
  // shell, and this regex has to keep agreeing with it. Two spellings of one
  // rule in two languages is exactly the drift that goes unnoticed until an
  // account silently re-downloads in full, so the live one is pinned here.
  const sh = await readFile(new URL('./download-douyin.sh', import.meta.url), 'utf8');
  const found = /^POST_DIR="\$\{OUTDIR\}\/(.+)"$/m.exec(sh);
  assert.ok(found, 'POST_DIR template not found in download-douyin.sh');

  const template = found[1];
  assert.ok(
    template.includes('|undated)s'),
    'the template lost its undated default — a dateless post would land in a folder named NA',
  );

  // Rendered the way yt-dlp would. A template changed to anything else leaves
  // its %(…)s markers behind, and postIdFromFolder then rejects the result.
  const dated = template
    .replace('%(upload_date>%Y-%m-%d|undated)s', '2024-03-11')
    .replace('%(id)s', '7412345678901234567');
  assert.equal(postIdFromFolder(dated), '7412345678901234567');

  const undated = template
    .replace('%(upload_date>%Y-%m-%d|undated)s', 'undated')
    .replace('%(id)s', '7412345678901234567');
  assert.equal(postIdFromFolder(undated), '7412345678901234567');
});
