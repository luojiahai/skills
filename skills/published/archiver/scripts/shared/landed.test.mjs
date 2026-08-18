import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  POSTS_DIR,
  isLanded,
  isMissing,
  onDiskIds,
  readArchive,
  shadowedFolders,
  unlistedIds,
} from './landed.mjs';
import { POST_FILE, buildPost, isComplete, writePost } from './post.mjs';

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

test('readArchive indexes post folders by post id', async () => {
  const { dir, posts } = await fixture();
  await seedPost(posts, '2024-03-11_1767', { listed: [{ num: 1, ext: 'jpg' }], files: ['1.jpg'] });

  const archive = await readArchive(dir);
  assert.equal(archive.get('1767').folder, '2024-03-11_1767');
  assert.equal(isLanded(archive.get('1767')), true);
});

test('a post whose fourth image failed reads as incomplete', async () => {
  // Why post.json lists its media: a folder holding some media is not a folder
  // holding the post, and only the list can tell the two apart.
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

test('a post whose only media never landed reads as incomplete', async () => {
  // The folder and its post.json are not the record; the files are. A record
  // that outlives the files would go on claiming a post is done without them.
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

test('isMissing is the one rule X’s plan, collection pass and fetch loop all use', async () => {
  const { dir, posts } = await fixture();
  await seedPost(posts, '2024-03-11_1767', { listed: [{ num: 1, ext: 'jpg' }], files: ['1.jpg'] });
  const archive = await readArchive(dir);

  assert.equal(isMissing({ tweetId: '1767' }, archive, 'tweetId'), false);
  assert.equal(isMissing({ tweetId: '9999' }, archive, 'tweetId'), true);

  // Parameterised rather than hardcoded, so the same rule answers for a platform
  // whose posts spell their id differently.
  assert.equal(isMissing({ id: '1767' }, archive, 'id'), false);
});

// ---- the same rules, reached the way the Douyin side reaches them ----------
// Media named outright rather than as {num, ext}, and the id-set questions the
// plan asks. One module, so one suite: a rule that held for one platform's
// call shape and not the other's would corrupt an archive both of them read.

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
  // The files are the record. Anything that outlived them — a download archive,
  // a done-marker — would go on claiming the post after the user deleted it.
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

test('one post id in two folders picks the landed one, and counts the other', () => {
  // `undated_5` from a run that could not date the post and `2024-01-01_5` from
  // a later one that could. Which one answers for the post must not depend on
  // the order readdir happened to yield, and the folder that loses is media
  // nothing is counting.
  return (async () => {
    const dir = await root();
    await post(dir, 'undated_5', []);
    await post(dir, '2024-01-01_5', ['1.mp4']);

    const archive = await readArchive(dir);
    assert.equal(archive.size, 1);
    assert.equal(archive.get('5').folder, '2024-01-01_5', 'the landed folder wins');
    assert.equal(shadowedFolders(archive), 1);
  })();
});

test('two folders that both landed pick the same one whichever order they are read', () => {
  return (async () => {
    const dir = await root();
    await post(dir, 'undated_6', ['1.mp4']);
    await post(dir, '2024-01-01_6', ['1.mp4']);

    const archive = await readArchive(dir);
    assert.equal(archive.get('6').folder, '2024-01-01_6', 'sorted, so it is the same on every machine');
    assert.equal(shadowedFolders(archive), 1);
  })();
});

test('an archive with no duplicates counts none', () => {
  return (async () => {
    const dir = await root();
    await post(dir, '2024-01-01_7', ['1.mp4']);
    assert.equal(shadowedFolders(await readArchive(dir)), 0);
  })();
});
