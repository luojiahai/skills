import assert from 'node:assert/strict';
import test from 'node:test';

import { foundDetail, headline, notes } from './blocks.mjs';

const first = (note) => (Array.isArray(note) ? note[0] : note);

test('an account is named by its nickname and its 抖音号', () => {
  // The 抖音号 always, because it is the identifier a human can read and type —
  // the sec_uid the folder is named for is not.
  assert.equal(headline({ nickname: '小明', douyin_id: 'abc123' }), '小明 (抖音号 abc123)');
});

test('an account whose nickname never rendered is still named', () => {
  assert.equal(headline({ douyin_id: 'abc123' }), '抖音号 abc123');
  assert.equal(headline({}), '抖音号 ?');
  assert.equal(headline(null), '抖音号 ?');
});

test('the profile count is shown beside what was collected, when there is one', () => {
  assert.equal(foundDetail(411), 'of 411 reported');
  assert.equal(foundDetail(null), '');
  assert.equal(foundDetail(undefined), '');
});

test('a gap between the header count and the cards is explained', () => {
  const [note] = notes({ collected: 405, reported: 411, skipped: 0, unlisted: 0 });
  assert.match(first(note), /6 post\(s\) counted but not shown/);
  assert.match(note[1], /private, deleted, or region-locked/);
});

test('skipped image posts are not blamed twice', () => {
  // They *were* shown in the grid, they are simply not in the collected list.
  // Counting them as hidden as well would report the same 4 posts twice.
  const rendered = notes({ collected: 405, reported: 411, skipped: 6, unlisted: 0 }).map(first);
  assert.equal(rendered.filter((line) => /counted but not shown/.test(line)).length, 0);
  assert.equal(rendered.filter((line) => /image posts skipped/.test(line)).length, 1);
});

test('image posts are reported with the ticket that tracks them', () => {
  // Neither yt-dlp nor gallery-dl can fetch 图文, so an account's archive is
  // short by however many it has. Saying the number is what keeps that visible
  // rather than silent.
  const [note] = notes({ collected: 405, reported: 405, skipped: 4, unlisted: 0 });
  assert.match(first(note), /4 image posts skipped — not yet supported/);
  assert.match(note[1], /issues\/48/);
});

test('one image post is not "1 image posts"', () => {
  assert.match(first(notes({ collected: 1, reported: 2, skipped: 1, unlisted: 0 })[0]), /1 image post skipped/);
});

test('an account with no image posts says nothing about them', () => {
  const rendered = notes({ collected: 405, reported: 405, skipped: 0, unlisted: 0 }).map(first);
  assert.deepEqual(rendered, []);
});

test('archived posts the profile no longer lists are reported, and pluralised', () => {
  assert.match(first(notes({ collected: 5, reported: 5, skipped: 0, unlisted: 1 })[0]), /1 archived post no longer/);
  assert.match(first(notes({ collected: 5, reported: 5, skipped: 0, unlisted: 3 })[0]), /3 archived posts no longer/);
});

test('an unknown profile count explains no gap rather than inventing one', () => {
  // Reporting a hidden-post count from a header that never rendered would be a
  // number the run made up.
  assert.deepEqual(notes({ collected: 405, reported: null, skipped: 0, unlisted: 0 }), []);
});

test('an archive larger than the listing is not reported as a negative gap', () => {
  const rendered = notes({ collected: 410, reported: 405, skipped: 0, unlisted: 0 }).map(first);
  assert.equal(rendered.filter((line) => /counted but not shown/.test(line)).length, 0);
});

test('every note a run can carry appears in a readable order', () => {
  const rendered = notes({ collected: 400, reported: 411, skipped: 4, unlisted: 2 }).map(first);
  assert.match(rendered[0], /counted but not shown/);
  assert.match(rendered[1], /image posts skipped/);
  assert.match(rendered[2], /no longer on the profile/);
});
