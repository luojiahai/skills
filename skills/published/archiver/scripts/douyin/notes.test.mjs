/**
 * Tests for notes.mjs — the arithmetic behind each gap Douyin has to explain.
 *
 * Driven here rather than from the top because `hidden-posts` computes reported
 * minus collected minus skipped, and this is a test about *that subtraction*.
 * Reaching it through a whole run would mean constructing a collect result to
 * check it.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { notes } from './notes.mjs';

const codes = (over) => notes(over).map((note) => note.code);

test('a gap between the header count and the cards is explained', () => {
  assert.deepEqual(notes({ collected: 405, reported: 411, skipped: 0, unlisted: 0 }), [
    { code: 'hidden-posts', count: 6 },
  ]);
});

test('skipped image posts are not blamed twice', () => {
  // They *were* shown in the grid, they are simply not in the collected list.
  // Counting them as hidden as well would report the same 6 posts twice.
  assert.deepEqual(codes({ collected: 405, reported: 411, skipped: 6, unlisted: 0 }), [
    'image-posts-skipped',
  ]);
});

test('image posts are counted, and the ticket that tracks them rides along', () => {
  // Neither yt-dlp nor gallery-dl can fetch 图文, so an account's archive is
  // short by however many it has. The count is what keeps that visible — and it
  // is a number, because the rule that says it out loud keys off one.
  const [note] = notes({ collected: 405, reported: 405, skipped: 4, unlisted: 0 });
  assert.equal(note.code, 'image-posts-skipped');
  assert.equal(note.count, 4);
  assert.match(note.issue, /issues\/48/);
});

test('an account with no image posts says nothing about them', () => {
  assert.deepEqual(notes({ collected: 405, reported: 405, skipped: 0, unlisted: 0 }), []);
});

test('archived posts the profile no longer lists are counted', () => {
  assert.deepEqual(notes({ collected: 5, reported: 5, skipped: 0, unlisted: 3 }), [
    { code: 'unlisted-posts', count: 3 },
  ]);
});

test('an unknown profile count explains no gap rather than inventing one', () => {
  // Reporting a hidden-post count from a header that never rendered would be a
  // number the run made up.
  assert.deepEqual(notes({ collected: 405, reported: null, skipped: 0, unlisted: 0 }), []);
});

test('an archive larger than the listing is not reported as a negative gap', () => {
  assert.equal(codes({ collected: 410, reported: 405, skipped: 0, unlisted: 0 }).length, 0);
});

test('every note a run can carry appears in a readable order', () => {
  assert.deepEqual(codes({ collected: 400, reported: 411, skipped: 4, unlisted: 2 }), [
    'hidden-posts',
    'image-posts-skipped',
    'unlisted-posts',
  ]);
});
