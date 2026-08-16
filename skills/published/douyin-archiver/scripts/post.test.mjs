import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { POST_VERSION, buildPost, isComplete, mediaNames, readPost, writePost } from './post.mjs';

test('buildPost holds the post in a fixed order and nothing else', () => {
  const post = buildPost({
    id: '7111',
    permalink: 'https://www.douyin.com/video/7111',
    timestamp: '2024-03-11T07:22:19Z',
    text: '你好',
    media: [{ file: '1.mp4', type: 'video' }],
  });
  assert.deepEqual(Object.keys(post), ['version', 'id', 'permalink', 'timestamp', 'text', 'reply_to', 'media']);
  assert.equal(post.version, POST_VERSION);
});

test('reply_to is written even though Douyin has nothing to put in it', () => {
  // Always null here. The key exists so both platforms' post.json have one
  // shape, which is the whole reason the platform folders were introduced.
  assert.equal(buildPost({ id: '1' }).reply_to, null);
});

test('buildPost keeps a caption whole', () => {
  const text = '第一行\n第二行\ttabbed — 🎉';
  assert.equal(buildPost({ id: '1', text }).text, text);
});

test('buildPost writes an empty text rather than omitting it', () => {
  // A missing field would be ambiguous between "this post had no caption" and
  // "the run died before writing it".
  assert.equal(buildPost({ id: '1' }).text, '');
});

test('a media entry omits what is not known rather than nulling it', () => {
  // yt-dlp exposes no per-item id for Douyin at all, so there is nothing to
  // record — and a null would look like a value that had been looked up.
  assert.deepEqual(buildPost({ id: '1', media: [{ file: '1.mp4', type: 'video' }] }).media, [
    { file: '1.mp4', type: 'video' },
  ]);
});

test('mediaNames lists the files the post says it carries', () => {
  assert.deepEqual(mediaNames(buildPost({ id: '1', media: [{ file: '1.mp4' }] })), ['1.mp4']);
});

test('a post is complete when every file it lists is present', () => {
  const post = buildPost({ id: '1', media: [{ file: '1.mp4', type: 'video' }] });
  assert.equal(isComplete(post, ['1.mp4', 'post.json']), true);
  assert.equal(isComplete(post, ['post.json']), false);
});

test('a folder with no post.json is never complete', () => {
  assert.equal(isComplete(null, ['1.mp4']), false);
});

test('a post.json from another version is not read as a post', () => {
  assert.equal(isComplete({ version: POST_VERSION + 1, media: [] }, []), false);
  assert.equal(isComplete({ version: POST_VERSION, media: 'not a list' }, []), false);
});

test('writePost and readPost round-trip, creating the folder', async () => {
  const dir = path.join(await mkdtemp(path.join(os.tmpdir(), 'douyin-post-')), 'posts', '2024-03-11_7111');
  const post = buildPost({ id: '7111', text: '你好', media: [{ file: '1.mp4', type: 'video' }] });
  await writePost(dir, post);
  assert.deepEqual(await readPost(dir), post);
});

test('readPost of a folder with no post.json is null, not an error', async () => {
  assert.equal(await readPost(await mkdtemp(path.join(os.tmpdir(), 'douyin-post-'))), null);
});
