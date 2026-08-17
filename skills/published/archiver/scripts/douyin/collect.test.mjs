import assert from 'node:assert/strict';
import test from 'node:test';

import { parseFeedPayload } from './collect.mjs';

test('a feed response yields a post per entry', () => {
  const posts = parseFeedPayload({
    aweme_list: [
      { aweme_id: '7412', desc: '早安', create_time: 1710144139 },
      { aweme_id: '7413', desc: '', create_time: 1710244139 },
    ],
  });
  assert.deepEqual(posts, [
    { id: '7412', text: '早安', createTime: 1710144139 },
    { id: '7413', text: '', createTime: 1710244139 },
  ]);
});

test('the list is found however the payload wraps it', () => {
  const entry = { aweme_id: '7412', desc: 'x', create_time: 1 };
  for (const payload of [{ aweme_list: [entry] }, { data: { aweme_list: [entry] } }, { data: [entry] }]) {
    assert.equal(parseFeedPayload(payload).length, 1, JSON.stringify(payload));
  }
});

test('an empty caption is a caption, not a missing one', () => {
  // A post can genuinely have no words. Reading that as "unknown" would send
  // fetch.mjs off to ask yt-dlp for a caption that is correctly empty.
  const [post] = parseFeedPayload({ aweme_list: [{ aweme_id: '7412', desc: '', create_time: 1 }] });
  assert.equal(post.text, '');
});

test('a missing caption is unknown, and says so', () => {
  const [post] = parseFeedPayload({ aweme_list: [{ aweme_id: '7412', create_time: 1 }] });
  assert.equal(post.text, null);
});

test('a missing or unusable create_time is unknown rather than zero', () => {
  for (const entry of [
    { aweme_id: '7412' },
    { aweme_id: '7412', create_time: null },
    { aweme_id: '7412', create_time: 'yesterday' },
  ]) {
    assert.equal(parseFeedPayload({ aweme_list: [entry] })[0].createTime, null, JSON.stringify(entry));
  }
});

test('an entry with no usable id is skipped, not guessed at', () => {
  const posts = parseFeedPayload({
    aweme_list: [{ desc: 'no id' }, { aweme_id: '', desc: '' }, { aweme_id: 'not-a-number' }, { aweme_id: '7412' }],
  });
  assert.deepEqual(posts.map((p) => p.id), ['7412']);
});

test('a payload that is not a feed yields nothing rather than throwing', () => {
  // This parses something nobody promised us, read opportunistically off a
  // page. Yielding nothing is survivable: the DOM has already said the post
  // exists and yt-dlp can still be asked what it is.
  for (const junk of [null, undefined, {}, [], 'text', 42, { aweme_list: 'no' }, { data: null }]) {
    assert.deepEqual(parseFeedPayload(junk), [], JSON.stringify(junk));
  }
});

test('a numeric id is carried as a string', () => {
  // Post ids exceed Number.MAX_SAFE_INTEGER, so they are only ever compared and
  // stored as text — one that had been through a Number would name a folder
  // that is off by a digit.
  const [post] = parseFeedPayload({ aweme_list: [{ aweme_id: 7412345678901234567n.toString() }] });
  assert.equal(post.id, '7412345678901234567');
  assert.equal(typeof post.id, 'string');
});
