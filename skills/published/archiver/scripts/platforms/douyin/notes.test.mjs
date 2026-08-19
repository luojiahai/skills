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
  assert.deepEqual(
    codes({
      collected: 400,
      reported: 411,
      skipped: 4,
      unlisted: 2,
      truncated: true,
      unattributed: 3,
      undated: 5,
      duplicates: 1,
    }),
    [
      'listing-truncated',
      'hidden-posts',
      'image-posts-skipped',
      'unlisted-posts',
      'unattributed-posts',
      'undated-posts',
      'duplicate-posts',
    ],
  );
});

test('a rounded header explains no gap, because the subtraction would be wrong', () => {
  // `作品 1.2万` is anywhere between 11,500 and 12,499. An account with 12,345
  // posts, every one collected, would be reported as hiding −345 of them — and
  // collecting 11,800 of 12,345 would report 200, wrong by 545.
  assert.deepEqual(codes({ collected: 11800, reported: 12000, reportedRounded: true, skipped: 0, unlisted: 0 }), []);

  // An exact header still does.
  assert.deepEqual(codes({ collected: 11800, reported: 12345, reportedRounded: false, skipped: 0, unlisted: 0 }), [
    'hidden-posts',
  ]);
});

test('a listing cut off at the round limit says so', () => {
  // It stops after a fixed number of rounds, and a listing cut off there is
  // short by an unknown amount — which makes every count beside it a comparison
  // against a partial list.
  assert.deepEqual(codes({ collected: 5, reported: 5, skipped: 0, unlisted: 0, truncated: true }), [
    'listing-truncated',
  ]);
});

test('cards nothing could attribute to this account are counted', () => {
  assert.deepEqual(notes({ collected: 5, reported: null, skipped: 0, unlisted: 0, unattributed: 2 }), [
    { code: 'unattributed-posts', count: 2 },
  ]);
});

test('posts nothing could date, and ids in two folders, each say so', () => {
  assert.deepEqual(notes({ collected: 5, reported: null, skipped: 0, unlisted: 0, undated: 3, duplicates: 1 }), [
    { code: 'undated-posts', count: 3 },
    { code: 'duplicate-posts', count: 1 },
  ]);
});

test('a listing that stopped early withholds every count computed against its length', () => {
  // A deliberately short listing makes both of these lie: the header gap reads
  // as posts the profile is hiding, and every archived post below the cut reads
  // as one the profile no longer lists.
  assert.deepEqual(
    codes({ collected: 20, reported: 405, skipped: 0, unlisted: 385, stoppedEarly: true }),
    [],
  );

  // The same numbers from a sweep that reached the end still explain both.
  assert.deepEqual(codes({ collected: 20, reported: 405, skipped: 0, unlisted: 385 }), [
    'hidden-posts',
    'unlisted-posts',
  ]);
});

test('a listing that stopped early still says what it saw on the way', () => {
  // Skipped image posts, unattributed cards and duplicate folders are counts of
  // what the pass actually met, not of how far it went, so a short pass
  // undercounts them rather than getting them wrong.
  assert.deepEqual(
    codes({
      collected: 20,
      reported: 405,
      skipped: 4,
      unlisted: 385,
      unattributed: 2,
      duplicates: 1,
      stoppedEarly: true,
    }),
    ['image-posts-skipped', 'unattributed-posts', 'duplicate-posts'],
  );
});
