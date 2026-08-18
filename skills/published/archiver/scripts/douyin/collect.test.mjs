import assert from 'node:assert/strict';
import test from 'node:test';

import { harvestInPage, parseFeedPayload } from './collect.mjs';

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

// ---- the harvester, against a page ----------------------------------------
// `harvestInPage` runs inside the browser, so it is driven here against the
// smallest DOM that can express the thing it has to get right: which subtree a
// link is in. What it must never do is file a stranger's post under this
// account — the one mistake in this skill that running the command again cannot
// undo.

/** An element: a tag, its children, and an href if it is a link. */
function el(tag, children = [], href = null) {
  const node = { tagName: tag.toUpperCase(), href, children, parentElement: null };
  node.getAttribute = (name) => (name === 'href' ? node.href : null);
  node.closest = (selector) => {
    const want = selector.toUpperCase();
    for (let p = node; p; p = p.parentElement) if (p.tagName === want) return p;
    return null;
  };
  for (const child of children) child.parentElement = node;
  return node;
}

const link = (href) => el('a', [], href);

/** Runs the in-page harvester against `body`, the way page.evaluate would. */
function harvest(body) {
  const all = [];
  const walk = (node) => {
    if (node.tagName === 'A' && node.href !== null) all.push(node);
    for (const child of node.children) walk(child);
  };
  walk(body);

  const previous = globalThis.document;
  globalThis.document = { querySelectorAll: () => all };
  try {
    return harvestInPage();
  } finally {
    globalThis.document = previous;
  }
}

test('a video link outside the grid is not this account’s post', () => {
  // Douyin renders recommendation rails pointing at other accounts. One outside
  // <footer> and without ?source=Baiduspider is invisible to both of the older
  // filters, and collecting it files a stranger's upload under this account.
  const grid = el('div', [link('/video/1'), link('/video/2'), link('/video/3')]);
  const rail = el('div', [link('/video/999')]);
  const body = el('body', [grid, rail]);

  assert.deepEqual(harvest(body).videos, ['1', '2', '3']);
});

test('the footer and the spider links are still excluded', () => {
  const grid = el('div', [link('/video/1'), link('/video/2'), link('/video/3?source=Baiduspider')]);
  const footer = el('footer', [link('/video/900')]);
  const body = el('body', [grid, footer]);

  assert.deepEqual(harvest(body).videos, ['1', '2']);
});

test('image posts are counted separately, from inside the grid', () => {
  const grid = el('div', [
    link('/video/1'),
    link('//www.douyin.com/note/50'),
    link('/video/2'),
  ]);
  const body = el('body', [grid]);

  const { videos, notes } = harvest(body);
  assert.deepEqual(videos, ['1', '2']);
  assert.deepEqual(notes, ['50']);
});

test('a page with too few links to find a grid harvests them all', () => {
  // A first screen that has barely rendered. Nothing is scoped away, and the
  // feed cross-check in collect() is what remains between here and a stranger's
  // post.
  const body = el('body', [el('div', [link('/video/1')])]);
  assert.deepEqual(harvest(body).videos, ['1']);
});
