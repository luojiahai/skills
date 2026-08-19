/**
 * Tests for run.mjs — the decisions every platform's run makes identically.
 *
 * The stopping rule is here rather than in a platform's suite because there is
 * one of it: a streak that counted differently on two platforms would retire
 * one sweep early and leave the other enumerating forever. What stays with each
 * platform is its own threshold, which is a claim about that platform's
 * reordering and is defended beside it.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPost } from './post.mjs';
import { makeStopper, sweepNote } from './run.mjs';

/**
 * An archive whose posts each list `listed` files and hold `present` of them —
 * the shape landed.mjs returns.
 */
function archiveOf(ids, { listed = ['1.jpg'], present = listed } = {}) {
  return new Map(ids.map((id) => [
    String(id),
    {
      folder: `2024-03-11_${id}`,
      names: [...present, 'post.json'],
      post: buildPost({
        id: String(id),
        media: listed.map((name) => {
          const [num, ext] = name.split('.');
          return { num, ext };
        }),
      }),
    },
  ]));
}

test('the stopper does nothing on a first run', () => {
  const stop = makeStopper({ archive: archiveOf([1, 2, 3]), threshold: 2, enabled: false });
  assert.equal(stop('1'), false);
  assert.equal(stop('2'), false);
  assert.equal(stop('3'), false);
});

test('the stopper fires after N consecutive posts already on disk', () => {
  const stop = makeStopper({ archive: archiveOf([1, 2, 3]), threshold: 3, enabled: true });
  assert.equal(stop('1'), false);
  assert.equal(stop('2'), false);
  assert.equal(stop('3'), true);
});

test('one unseen post resets the run of known ones', () => {
  const stop = makeStopper({ archive: archiveOf([1, 2, 4, 5]), threshold: 3, enabled: true });
  stop('1');
  stop('2');
  assert.equal(stop('3'), false); // not on disk — resets
  assert.equal(stop('4'), false);
  assert.equal(stop('5'), false);
});

test('a post on disk but incomplete does not count as known', () => {
  // Otherwise a sweep retires early over posts it would then have to fetch.
  const archive = archiveOf([1, 2], { listed: ['1.jpg', '2.jpg'], present: ['1.jpg'] });
  const stop = makeStopper({ archive, threshold: 2, enabled: true });
  assert.equal(stop('1'), false);
  assert.equal(stop('2'), false);
});

test('a post whose folder has no post.json does not count as known', () => {
  const archive = new Map([['1', { folder: '2024-03-11_1', names: ['1.jpg'], post: null }]]);
  const stop = makeStopper({ archive, threshold: 1, enabled: true });
  assert.equal(stop('1'), false);
});

test('a full sweep never reports having stopped early', () => {
  // There is nothing for a full sweep to stop early against, and saying it
  // stopped would cast doubt on a listing that is complete.
  assert.deepEqual(sweepNote({ incremental: false, stoppedEarly: true, threshold: 20 }), {
    code: 'sweep',
    mode: 'full',
    stopped_early: false,
    threshold: null,
  });
});

test('an incremental sweep carries the threshold it stopped against', () => {
  assert.deepEqual(sweepNote({ incremental: true, stoppedEarly: true, threshold: 20 }), {
    code: 'sweep',
    mode: 'incremental',
    stopped_early: true,
    threshold: 20,
  });
});

test('a platform sweeping one feed names no category at all', () => {
  // The schema documents the field as absent there, so an explicit null would
  // be a value nothing accepts.
  assert.equal('category' in sweepNote({ incremental: true, stoppedEarly: false, threshold: 20 }), false);
  assert.equal(
    sweepNote({ incremental: true, stoppedEarly: false, threshold: 20, category: 'reels' }).category,
    'reels',
  );
});
