/**
 * Tests for cursor.mjs — run with:
 *   node --test scripts/cursor.test.mjs
 *
 * The merge rules and the newest-upload derivation are covered; folder
 * resolution walks the real filesystem against real state files and is
 * exercised by hand against a live archive.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { mergeCursor, newestFrom } from './cursor.mjs';

const NOW = new Date('2026-08-14T10:00:00Z');

test('mergeCursor prefers fresh metadata over the previous cursor', () => {
  const cursor = mergeCursor({
    meta: { sec_uid: 'MS4wNEW', douyin_id: 'new123', nickname: '新名' },
    previous: { sec_uid: 'MS4wOLD', douyin_id: 'old123', nickname: '旧名' },
    newest: { id: null, date: null },
    folder: '/data/abc123',
    downloads: '/data',
    now: NOW,
  });
  assert.equal(cursor.sec_uid, 'MS4wNEW');
  assert.equal(cursor.douyin_id, 'new123');
  assert.equal(cursor.nickname, '新名');
});

test('mergeCursor keeps what the previous cursor knew when the meta is silent', () => {
  // --go runs no collection pass, so its "meta" is a plan that may predate
  // fields the cursor already carries. Silence must not erase them.
  const cursor = mergeCursor({
    meta: {},
    previous: {
      sec_uid: 'MS4wOLD',
      nickname: '旧名',
      collected_count: 86,
      reported_works_count: 86,
    },
    newest: { id: null, date: null },
    folder: '/data/abc123',
    downloads: '',
    now: NOW,
  });
  assert.equal(cursor.sec_uid, 'MS4wOLD');
  assert.equal(cursor.nickname, '旧名');
  assert.equal(cursor.collected_count, 86);
  assert.equal(cursor.reported_works_count, 86);
});

test('mergeCursor starts from nothing on a first run', () => {
  const cursor = mergeCursor({
    meta: {},
    previous: {},
    newest: { id: null, date: null },
    folder: '/data/abc123',
    downloads: '',
    now: NOW,
  });
  assert.equal(cursor.sec_uid, null);
  assert.equal(cursor.douyin_id, null);
  assert.equal(cursor.newest_video_id, null);
  assert.equal(cursor.last_run_at, NOW.toISOString());
});

test('mergeCursor names the folder and records the root it ran against', () => {
  const cursor = mergeCursor({
    meta: {},
    previous: {},
    newest: { id: null, date: null },
    folder: '/data/abc123',
    downloads: '/data',
    now: NOW,
  });
  assert.equal(cursor.folder_name, 'abc123');
  assert.equal(cursor.downloads_root, '/data');
});

test('mergeCursor falls back to the previous root, then to the folder parent', () => {
  const previous = mergeCursor({
    meta: {},
    previous: { downloads_root: '/proj/downloads' },
    newest: { id: null, date: null },
    folder: '/data/abc123',
    downloads: '',
    now: NOW,
  });
  assert.equal(previous.downloads_root, '/proj/downloads');

  const derived = mergeCursor({
    meta: {},
    previous: {},
    newest: { id: null, date: null },
    folder: '/data/abc123',
    downloads: '',
    now: NOW,
  });
  assert.equal(derived.downloads_root, '/data');
});

test('mergeCursor takes the newest upload from disk over the previous cursor', () => {
  const cursor = mergeCursor({
    meta: {},
    previous: { newest_video_id: '7000', newest_upload_date: '20250101' },
    newest: { id: '7222', date: '20260813' },
    folder: '/data/abc123',
    downloads: '',
    now: NOW,
  });
  assert.equal(cursor.newest_video_id, '7222');
  assert.equal(cursor.newest_upload_date, '20260813');
});

test('newestFrom picks the latest upload date out of the filenames', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'douyin-cursor-'));
  const videos = path.join(dir, 'videos');
  mkdirSync(videos);
  writeFileSync(path.join(videos, '20260101 - 早的 [7111].mp4'), '');
  writeFileSync(path.join(videos, '20260813 - 新的 [7222].mp4'), '');
  writeFileSync(path.join(videos, 'not-a-video.txt'), '');

  assert.deepEqual(await newestFrom(videos), { date: '20260813', id: '7222' });
});

test('newestFrom answers nulls for a folder with nothing readable', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'douyin-cursor-'));
  assert.deepEqual(await newestFrom(path.join(dir, 'missing')), { id: null, date: null });

  const videos = path.join(dir, 'videos');
  mkdirSync(videos);
  writeFileSync(path.join(videos, 'junk.mp4'), '');
  assert.deepEqual(await newestFrom(videos), { id: null, date: null });
});
