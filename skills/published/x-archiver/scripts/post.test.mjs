import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  POST_VERSION,
  buildPost,
  isComplete,
  mediaEntry,
  mediaNames,
  readPost,
  toTimestamp,
  writePost,
} from './post.mjs';

test('toTimestamp turns gallery-dl’s date into ISO 8601', () => {
  assert.equal(toTimestamp('2024-03-11 07:22:19'), '2024-03-11T07:22:19Z');
  assert.equal(toTimestamp('2024-03-11T07:22:19'), '2024-03-11T07:22:19Z');
});

test('toTimestamp widens a bare day rather than inventing a time', () => {
  assert.equal(toTimestamp('2024-03-11'), '2024-03-11T00:00:00Z');
});

test('toTimestamp is null for anything that is not a date', () => {
  // `undated` is a real answer for a post, and half a timestamp is worse than
  // none of one.
  assert.equal(toTimestamp('undated'), null);
  assert.equal(toTimestamp(''), null);
  assert.equal(toTimestamp(undefined), null);
});

test('a media entry names the file exactly as gallery-dl writes it', () => {
  // This list is compared against a directory listing. A name built by a
  // different rule than the one that wrote the file reports every post as
  // incomplete, forever.
  assert.deepEqual(mediaEntry({ num: 1, ext: 'jpg' }), { file: '1.jpg' });
  assert.deepEqual(mediaEntry({ num: 2, ext: 'mp4' }).file, '2.mp4');
});

test('a media entry carries its source and identity when they are known', () => {
  assert.deepEqual(
    mediaEntry({ num: 1, ext: 'jpg', url: 'https://pbs.twimg.com/media/ABC.jpg', type: 'photo', id: 'ABC' }),
    { file: '1.jpg', url: 'https://pbs.twimg.com/media/ABC.jpg', type: 'photo', id: 'ABC' },
  );
});

test('an unidentifiable media entry omits the keys rather than nulling them', () => {
  // A video has no stable per-item id exposed, so it is left out instead of
  // recorded as if it were one.
  assert.deepEqual(Object.keys(mediaEntry({ num: 1, ext: 'mp4', type: 'video' })), ['file', 'type']);
});

test('buildPost holds the post in a fixed order and nothing else', () => {
  const post = buildPost({
    id: '1767',
    permalink: 'https://x.com/someone/status/1767',
    timestamp: '2024-03-11T07:22:19Z',
    text: 'hello',
    media: [{ num: 1, ext: 'jpg' }],
  });
  assert.deepEqual(Object.keys(post), ['version', 'id', 'permalink', 'timestamp', 'text', 'reply_to', 'media']);
  assert.equal(post.version, POST_VERSION);
  assert.equal(post.reply_to, null);
});

test('buildPost keeps a post’s words whole', () => {
  // This is now the only place they are kept: the folder name carries none of
  // them and text.txt is gone.
  const text = 'line one\nline two\ttabbed — 中文 🎉';
  assert.equal(buildPost({ id: '1', text }).text, text);
});

test('buildPost writes an empty text rather than omitting it', () => {
  // A missing field would be ambiguous between "this post had no words" and
  // "the run died before writing it".
  assert.equal(buildPost({ id: '1' }).text, '');
});

test('mediaNames lists the files the post says it carries', () => {
  const post = buildPost({ id: '1', media: [{ num: 1, ext: 'jpg' }, { num: 2, ext: 'mp4' }] });
  assert.deepEqual(mediaNames(post), ['1.jpg', '2.mp4']);
});

test('a post is complete when every file it lists is present', () => {
  const post = buildPost({ id: '1', media: [{ num: 1, ext: 'jpg' }, { num: 2, ext: 'jpg' }] });
  assert.equal(isComplete(post, ['1.jpg', '2.jpg', 'post.json']), true);
});

test('a post missing one of its files is incomplete', () => {
  const post = buildPost({ id: '1', media: [{ num: 1, ext: 'jpg' }, { num: 2, ext: 'jpg' }] });
  assert.equal(isComplete(post, ['1.jpg', 'post.json']), false);
});

test('a half-downloaded file does not count as the file', () => {
  const post = buildPost({ id: '1', media: [{ num: 1, ext: 'mp4' }] });
  assert.equal(isComplete(post, ['1.mp4.part', 'post.json']), false);
});

test('a folder with no post.json is never complete', () => {
  // post.json is written before the first byte of media, so its absence means
  // the run died before this post was started at all.
  assert.equal(isComplete(null, ['1.jpg', '2.jpg']), false);
});

test('a post.json from another version is not read as a post', () => {
  assert.equal(isComplete({ version: POST_VERSION + 1, media: [] }, []), false);
  assert.equal(isComplete({ version: POST_VERSION, media: 'not a list' }, []), false);
});

test('a post that carries no media is complete once it is described', () => {
  // It cannot arise from a listing pass, which only yields posts with files —
  // and treating it as incomplete would retry it forever.
  assert.equal(isComplete(buildPost({ id: '1', media: [] }), []), true);
});

test('writePost and readPost round-trip, creating the folder', async () => {
  const dir = path.join(await mkdtemp(path.join(os.tmpdir(), 'x-post-')), 'posts', '2024-03-11_1767');
  const post = buildPost({ id: '1767', text: 'hi', media: [{ num: 1, ext: 'jpg' }] });
  await writePost(dir, post);
  assert.deepEqual(await readPost(dir), post);
});

test('readPost of a folder with no post.json is null, not an error', async () => {
  assert.equal(await readPost(await mkdtemp(path.join(os.tmpdir(), 'x-post-'))), null);
});
