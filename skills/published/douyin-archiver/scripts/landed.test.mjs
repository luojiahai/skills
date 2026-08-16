/**
 * Tests for landed.mjs — the rules that decide what is already downloaded.
 *
 * These walk the real filesystem rather than a mock, because the whole point of
 * the module is that the files *are* the record: a fake that answered from
 * memory would be testing the thing this design deliberately does not have.
 *
 * Run: node --test scripts/*.test.mjs
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { POSTS_DIR, isLanded, onDiskIds, postIdFromFolder, readArchive, unlistedIds } from './landed.mjs';
import { POST_FILE, POST_VERSION, buildPost, isComplete, writePost } from './post.mjs';

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

test('postIdFromFolder reads the id back out', () => {
  assert.equal(postIdFromFolder('2024-03-11_7412345678901234567'), '7412345678901234567');
  assert.equal(postIdFromFolder('undated_55'), '55');
});

test('postIdFromFolder ignores anything that is not a post folder', () => {
  // Other things live under the account dir, and a stray name must not be read
  // as an archived post — that would report a post as downloaded that is not.
  assert.equal(postIdFromFolder('account.json'), null);
  assert.equal(postIdFromFolder('videos'), null);
  assert.equal(postIdFromFolder('2024-3-11_55'), null);
  assert.equal(postIdFromFolder('2024-03-11_'), null);
  assert.equal(postIdFromFolder('_55'), null);
  assert.equal(postIdFromFolder('notadate_55'), null);
});

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
  // .part is a transfer that stopped and .ytdl its resume state — but the one
  // that used to need a rule of its own is f-prefixed streams: video and audio
  // fetched separately and never merged are whole files, so a folder holding
  // them looked finished while the post was not playable. Against a named list
  // of expected files, none of them is `1.mp4`.
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
  // The rule the removed --download-archive got wrong: a record that outlives
  // the files goes on claiming a post is done after the user deleted it.
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

// ---- the two yt-dlp templates, pinned -------------------------------------
//
// Nothing in Node builds either a folder name or a post.json here — yt-dlp's
// templates do, in shell — and these regexes and shapes have to keep agreeing
// with them. Two spellings of one rule in two languages is exactly the drift
// that goes unnoticed until an account silently re-downloads in full.

const downloader = () => readFile(new URL('./download-douyin.sh', import.meta.url), 'utf8');

test('the folder template still produces names this module reads', async () => {
  const found = /^POST_DIR="\$\{OUTDIR\}\/(.+)"$/m.exec(await downloader());
  assert.ok(found, 'POST_DIR template not found in download-douyin.sh');

  const template = found[1];
  assert.ok(
    template.includes('|undated)s'),
    'the template lost its undated default — a dateless post would land in a folder named NA',
  );

  // Rendered the way yt-dlp would. A template changed to anything else leaves
  // its %(…)s markers behind, and postIdFromFolder then rejects the result.
  for (const date of ['2024-03-11', 'undated']) {
    const rendered = template
      .replace('%(upload_date>%Y-%m-%d|undated)s', date)
      .replace('%(id)s', '7412345678901234567');
    assert.equal(postIdFromFolder(rendered), '7412345678901234567');
  }
});

test('the post.json template writes the shape post.mjs reads back', async () => {
  const found = /^POST_TEMPLATE='(.+)'$/m.exec(await downloader());
  assert.ok(found, 'POST_TEMPLATE not found in download-douyin.sh');
  const template = found[1];

  // Rendered as yt-dlp renders it: `j` fields become JSON values, `s` fields
  // become bare text. Verified against yt-dlp's own evaluate_outtmpl when this
  // template was written.
  const rendered = template
    .replace('%(id)j', '"7412345678901234567"')
    .replace('%(id)s', '7412345678901234567')
    .replace('%(timestamp>%Y-%m-%dT%H:%M:%SZ|null)j', '"2024-03-11T07:22:19Z"')
    .replace('%(description,title|"")j', JSON.stringify('a "quoted" cap\ntion\ttab 中文 🎉'))
    .replace('%(playlist_index|1)s', '1')
    .replace('%(ext)s', 'mp4');

  const post = JSON.parse(rendered);
  assert.equal(post.version, POST_VERSION, 'the template must stamp the version post.mjs accepts');
  assert.deepEqual(Object.keys(post), ['version', 'id', 'permalink', 'timestamp', 'text', 'reply_to', 'media']);
  assert.equal(post.permalink, 'https://www.douyin.com/video/7412345678901234567');
  assert.equal(post.text, 'a "quoted" cap\ntion\ttab 中文 🎉');
  assert.equal(isComplete(post, ['1.mp4']), true);
  assert.equal(isComplete(post, []), false);
});

test('an absent field in the template renders as valid JSON, not as nothing', async () => {
  // yt-dlp drops an absent field with an empty default entirely — `"timestamp":,`
  // — and renders one with no default as the bare word NA. Both make the file
  // unparseable, so the defaults have to be the literal JSON they need to be.
  const template = /^POST_TEMPLATE='(.+)'$/m.exec(await downloader())[1];
  assert.ok(template.includes('|null)j'), 'timestamp needs a literal null default');
  assert.ok(template.includes('|"")j'), 'text needs a literal empty-string default');

  const rendered = template
    .replace('%(id)j', '"7"')
    .replace('%(id)s', '7')
    .replace('%(timestamp>%Y-%m-%dT%H:%M:%SZ|null)j', 'null')
    .replace('%(description,title|"")j', '""')
    .replace('%(playlist_index|1)s', '1')
    .replace('%(ext)s', 'mp4');

  const post = JSON.parse(rendered);
  assert.equal(post.timestamp, null);
  assert.equal(post.text, '');
});

test('every field carrying user text goes through the JSON conversion', async () => {
  // A caption interpolated with `s` produces a file that parses until the first
  // person writes a quotation mark.
  const template = /^POST_TEMPLATE='(.+)'$/m.exec(await downloader())[1];
  assert.ok(!/%\(description[^)]*\)s/.test(template), 'the caption must not be interpolated with %(...)s');
  assert.ok(!/%\(title[^)]*\)s/.test(template), 'the title must not be interpolated with %(...)s');
});

/**
 * The template, rendered by the real yt-dlp rather than by a hand-substitution.
 *
 * The tests above pin the template's *shape*; this one proves what it actually
 * produces. It matters because the rules are not obvious: `%(field)j` JSON-encodes
 * a value, but a `|` default is emitted verbatim and never passed through the
 * conversion — so the defaults have to be written as the literal JSON they need
 * to be, and a reviewer reading the source can reasonably conclude the opposite.
 *
 * `--load-info-json` feeds yt-dlp a saved info dict, so this needs no network and
 * touches nothing on Douyin. Skipped where yt-dlp is not installed, since the
 * rest of the suite has no dependencies beyond Node.
 */
const ytdlp = (() => {
  try {
    execFileSync('yt-dlp', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

async function render(info) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'douyin-tmpl-'));
  const infoFile = path.join(dir, 'info.json');
  const out = path.join(dir, 'post.json');
  await writeFile(infoFile, JSON.stringify({
    _type: 'video',
    ext: 'mp4',
    extractor: 'Douyin',
    extractor_key: 'Douyin',
    webpage_url: `https://www.douyin.com/video/${info.id}`,
    url: 'https://example.invalid/v.mp4',
    formats: [{ format_id: '0', url: 'https://example.invalid/v.mp4', ext: 'mp4' }],
    ...info,
  }));

  const template = /^POST_TEMPLATE='(.+)'$/m.exec(await downloader())[1];
  execFileSync('yt-dlp', ['--load-info-json', infoFile, '--skip-download', '--print-to-file', template, out], {
    stdio: 'ignore',
  });
  return JSON.parse(await readFile(out, 'utf8'));
}

test('yt-dlp renders the template into the post.json post.mjs reads', { skip: !ytdlp && 'yt-dlp not installed' }, async () => {
  const text = 'cap "quoted"\nline\ttab \\ 中文 🎉';
  const post = await render({ id: '7118726305914326302', title: 't', timestamp: 1657000000, description: text });

  assert.equal(post.version, POST_VERSION);
  assert.deepEqual(Object.keys(post), ['version', 'id', 'permalink', 'timestamp', 'text', 'reply_to', 'media']);
  assert.equal(post.id, '7118726305914326302');
  assert.equal(post.permalink, 'https://www.douyin.com/video/7118726305914326302');
  assert.equal(post.timestamp, '2022-07-05T05:46:40Z');
  // Quotes, newlines, tabs, a backslash, CJK and an astral-plane emoji all
  // survive being dropped into the middle of a JSON document.
  assert.equal(post.text, text);
  assert.equal(isComplete(post, ['1.mp4']), true);
});

test('yt-dlp renders an absent timestamp as JSON null, not the string "null"', { skip: !ytdlp && 'yt-dlp not installed' }, async () => {
  // The `|` defaults are the subtle part of the template, and the source reads
  // as though they go through `j` — which would give the *string* `"null"`. They
  // do not. Written instead as an empty default they would give `"timestamp":,`,
  // which is not JSON at all. This pins the behaviour rather than the reading.
  const post = await render({ id: '7', title: 'a title' });
  assert.equal(post.timestamp, null);
  assert.equal(typeof post.text, 'string');
});

test('yt-dlp falls back from the caption to the title', { skip: !ytdlp && 'yt-dlp not installed' }, async () => {
  // `%(description,title|"")j` — a post with no caption still gets whatever the
  // extractor called it, rather than an empty record.
  const post = await render({ id: '8', title: 'from the title', timestamp: 1657000000 });
  assert.equal(post.text, 'from the title');
});

test('post.json names the media file the output template writes', async () => {
  // Both come from the same %(ext)s, so the name recorded and the name written
  // cannot disagree.
  const sh = await downloader();
  const media = /^MEDIA_TEMPLATE="\$\{POST_DIR\}\/(.+)"$/m.exec(sh);
  assert.ok(media, 'MEDIA_TEMPLATE not found in download-douyin.sh');
  assert.ok(media[1].endsWith('.%(ext)s'), 'the media file is named by %(ext)s');

  const template = /^POST_TEMPLATE='(.+)'$/m.exec(sh)[1];
  assert.ok(
    template.includes(`"file":"${media[1]}"`),
    'post.json must spell the media name exactly as the output template does',
  );
});
