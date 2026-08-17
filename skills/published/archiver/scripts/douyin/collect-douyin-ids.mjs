#!/usr/bin/env node
/**
 * collect-douyin-ids.mjs — collect every downloadable post ID from a Douyin
 * profile.
 *
 * Douyin's profile feed API (/aweme/v1/web/aweme/post/) requires an `a_bogus`
 * signature computed by obfuscated page JS, and returns HTTP 200 with an empty
 * body without it. So rather than calling the API, this drives a real browser:
 * the page signs its own requests, and we read the IDs it renders.
 *
 * The browser runs in a dedicated profile directory (not your everyday Chrome,
 * which Chrome 136+ refuses to expose to automation). The profile persists, so
 * the douyin session you establish on the first run is reused afterwards.
 *
 * Usage:
 *   node scripts/collect-douyin-ids.mjs <profile-url> [options]
 *
 * Options:
 *   -o, --output FILE   Where to write URLs (default: urls.txt)
 *       --headless      Run without a visible window (only once the profile
 *                       has a working session; see --login)
 *       --login         Open the browser and wait for you to press Enter,
 *                       so you can visit douyin.com / clear a check
 *       --limit N       Stop after collecting N posts
 *       --profile DIR   Browser profile directory
 *                       (default: ${XDG_STATE_HOME:-~/.local/state}/archiver/douyin/profile)
 *       --meta FILE     Also write profile metadata (sec_uid, 抖音号, nickname,
 *                       counts) as JSON — how archive.sh identifies the account
 *   -h, --help
 */
import { writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { loadPlaywright, PROFILE_DIR } from './paths.mjs';

const SCROLL_DELAY_MS = 1200;
const STABLE_ROUNDS = 6; // consecutive no-new-ID rounds before we call it done
const MAX_ROUNDS = 1000; // hard stop, so a broken page cannot spin forever
const HEADER_POLL_MS = 1000; // between re-reads of a header that has not rendered
const HEADER_POLL_TRIES = 12; // giving a slow header ~12s beyond the initial settle

function parseArgs(argv) {
  const opts = {
    url: '',
    output: 'urls.txt',
    headless: false,
    login: false,
    limit: Infinity,
    profileDir: PROFILE_DIR,
    meta: '',
  };
  const rest = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '-o':
      case '--output':
        opts.output = argv[++i];
        break;
      case '--headless':
        opts.headless = true;
        break;
      case '--login':
        opts.login = true;
        break;
      case '--limit':
        opts.limit = Number(argv[++i]);
        break;
      case '--profile':
        opts.profileDir = argv[++i];
        break;
      case '--meta':
        opts.meta = argv[++i];
        break;
      case '-h':
      case '--help':
        return { help: true, ...opts };
      default:
        if (arg.startsWith('-')) {
          throw new Error(`unknown option '${arg}' (try --help)`);
        }
        rest.push(arg);
    }
  }

  opts.url = rest[0] ?? '';
  return opts;
}

function usage() {
  console.log(`Usage: node scripts/collect-douyin-ids.mjs <profile-url> [options]

Collects every downloadable post ID from a Douyin user profile and writes them
as https://www.douyin.com/video/<id> URLs, one per line. Image posts (图文) are
counted and reported, but not written: nothing downloads them yet, see
https://github.com/luojiahai/skills/issues/39

Options:
  -o, --output FILE   Where to write URLs (default: urls.txt)
      --headless      Run without a visible window (only once the profile has
                      a working session; establish one with --login first)
      --login         Open the browser and wait, so you can visit douyin.com
                      or clear a verification check, then press Enter
      --limit N       Stop after collecting N posts
      --profile DIR   Browser profile directory
                      (default: \${XDG_STATE_HOME:-~/.local/state}/archiver/douyin/profile)
      --meta FILE     Also write profile metadata (sec_uid, 抖音号, nickname,
                      counts) as JSON — how archive.sh identifies the account
  -h, --help          Show this help

Examples:
  # first time: establish a session in the dedicated profile
  node scripts/collect-douyin-ids.mjs --login "https://www.douyin.com/user/MS4w..."

  # afterwards
  node scripts/collect-douyin-ids.mjs "https://www.douyin.com/user/MS4w..." -o urls.txt`);
}

/**
 * Runs in the page. Cards link as /video/<id>; the modal overlay uses
 * ?modal_id=<id>. Both appear depending on layout, so harvest each.
 *
 * Image posts (图文) link as /note/<id> and are returned separately: nothing
 * here can download them yet (issue #39). Returned separately rather than left
 * to fall through the /video/ match, where they would vanish without trace and
 * leave an archive quietly short. Counting them is what makes that gap visible.
 *
 * A post opened through ?modal_id= cannot be told apart this way — that form
 * carries no type — so an image post reached only by its modal link still
 * counts as a video and fails to download. It is the rarer layout, and the
 * /note/ cards are what the grid actually renders.
 *
 * The page footer carries SEO recommendation links (tagged
 * `?source=Baiduspider`) pointing at *other* accounts' videos — those must be
 * excluded or you collect strangers' uploads. Grid class names are obfuscated
 * and rotate, so filter by structure rather than matching them.
 */
function harvestInPage() {
  const videos = [];
  const notes = [];
  for (const a of document.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href') || '';
    if (a.closest('footer')) continue;
    if (/[?&]source=Baiduspider/.test(href)) continue;
    // Checked first, and note that these links are protocol-relative
    // (//www.douyin.com/note/<id>) where video links are relative.
    const note = href.match(/\/note\/(\d+)/);
    if (note) {
      notes.push(note[1]);
      continue;
    }
    const m = href.match(/\/video\/(\d+)/) || href.match(/modal_id=(\d+)/);
    if (m) videos.push(m[1]);
  }
  return { videos, notes };
}

/**
 * Reads the profile header, which carries everything needed to identify the
 * account before a single card is scrolled: 抖音号 (the stable public handle),
 * the nickname, and 作品 <n> (the video count).
 *
 * The count is what distinguishes "collected everything" from "stopped early" —
 * a stalled feed and a finished one look identical from inside the scroll loop.
 */
function readProfileMetaInPage() {
  const text = document.body.innerText;

  const countMatch = text.match(/作品\s*([\d.]+)\s*(万|亿)?/);
  let worksCount = null;
  if (countMatch) {
    let n = parseFloat(countMatch[1]);
    if (countMatch[2] === '万') n *= 1e4;
    if (countMatch[2] === '亿') n *= 1e8;
    worksCount = Math.round(n);
  }

  return {
    douyinId: (text.match(/抖音号[:：]\s*([A-Za-z0-9_.-]+)/) || [])[1] ?? null,
    nickname: document.querySelector('h1')?.innerText?.trim() ?? null,
    worksCount,
  };
}

/** The profile may scroll the window or an inner div; drive whichever has overflow. */
function scrollInPage() {
  const doc = document.scrollingElement || document.documentElement;
  let best = doc;
  let bestOverflow = doc.scrollHeight - doc.clientHeight;
  for (const el of document.querySelectorAll('div, main, section')) {
    const overflow = el.scrollHeight - el.clientHeight;
    if (overflow <= bestOverflow) continue;
    if (!/(auto|scroll)/.test(getComputedStyle(el).overflowY)) continue;
    best = el;
    bestOverflow = overflow;
  }
  best.scrollTop = best.scrollHeight;
  window.scrollTo(0, document.body.scrollHeight);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) {
    usage();
    return 0;
  }
  if (!opts.url) {
    usage();
    console.error('\nerror: no profile URL given');
    return 2;
  }
  if (!/^https?:\/\/(www\.)?douyin\.com\/user\//.test(opts.url)) {
    console.error(`error: not a Douyin profile URL: ${opts.url}`);
    console.error('Expected https://www.douyin.com/user/MS4wLjABAAAA...');
    return 2;
  }
  if (!Number.isFinite(opts.limit) && opts.limit !== Infinity) {
    console.error('error: --limit must be a number');
    return 2;
  }

  const { chromium } = await loadPlaywright();
  const profileDir = opts.profileDir;
  console.log(`[douyin] profile: ${profileDir}`);

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: opts.headless && !opts.login,
    viewport: { width: 1280, height: 900 },
    locale: 'zh-CN',
  });

  try {
    const page = context.pages()[0] ?? (await context.newPage());

    console.log('[douyin] opening profile…');
    await page.goto(opts.url, { waitUntil: 'domcontentloaded', timeout: 60000 });

    if (opts.login) {
      console.log(
        '\n[douyin] Browser is open. Visit douyin.com, log in or clear any\n' +
          '         verification, then come back here and press Enter.\n',
      );
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      await rl.question('Press Enter when ready… ');
      rl.close();
      await page.goto(opts.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    }

    // Give the feed a chance to render before deciding it is empty.
    await page.waitForTimeout(3000);

    // The header renders on its own schedule, and archive.sh discards the
    // whole collection when the 抖音号 is missing from the metadata — so poll
    // rather than trusting one read after a fixed pause. The grid's own
    // rendering time is covered by the stability rule in the scroll loop.
    let meta = await page.evaluate(readProfileMetaInPage);
    for (let tries = 0; meta.douyinId === null && tries < HEADER_POLL_TRIES; tries++) {
      await page.waitForTimeout(HEADER_POLL_MS);
      meta = await page.evaluate(readProfileMetaInPage);
    }
    const expected = meta.worksCount;
    const secUid = (opts.url.match(/\/user\/([^/?#]+)/) || [])[1] ?? null;

    if (meta.douyinId) {
      console.log(
        `[douyin] ${meta.nickname ?? '?'} (抖音号 ${meta.douyinId})` +
          (expected !== null ? ` — ${expected} post(s)` : ''),
      );
    }

    const ids = new Set();
    // Counted, never collected: nothing downloads these yet (issue #39).
    const noteIds = new Set();
    let stable = 0;
    let rounds = 0;

    const harvest = async () => {
      const { videos, notes } = await page.evaluate(harvestInPage);
      for (const id of notes) noteIds.add(id);
      for (const id of videos) {
        if (ids.size >= opts.limit) break;
        ids.add(id);
      }
    };

    // Harvest before each scroll: the feed is virtualised, so cards scrolled
    // far off-screen get removed from the DOM.
    while (stable < STABLE_ROUNDS && rounds < MAX_ROUNDS && ids.size < opts.limit) {
      // Image posts count towards progress as well: a stretch of the grid
      // holding nothing but 图文 is still the scroll advancing, and treating it
      // as stalled would stop the collection short of the account's oldest
      // posts.
      const before = ids.size + noteIds.size;

      await harvest();

      await page.evaluate(scrollInPage);
      await page.waitForTimeout(SCROLL_DELAY_MS);
      rounds++;

      if (ids.size + noteIds.size === before) {
        stable++;
      } else {
        stable = 0;
        process.stdout.write(`\r[douyin] ${ids.size} posts…`);
      }
    }
    await harvest();
    process.stdout.write('\n');

    if (rounds >= MAX_ROUNDS) {
      console.warn('[douyin] hit the round limit — the list may be incomplete');
    }

    // Notes found but no videos is not a login wall — it is an account whose
    // posts are all 图文. The grid rendered; there is simply nothing here that
    // can be downloaded yet.
    if (ids.size === 0 && noteIds.size === 0) {
      console.error(
        '[douyin] found 0 posts in the profile grid.\n' +
          (expected
            ? `  The profile reports ${expected} post(s), so the grid exists but did\n` +
              '  not render — almost certainly a login wall.\n'
            : '') +
          '  Re-run with --login, sign in to Douyin in the window that opens,\n' +
          '  then press Enter. The session persists for later runs.',
      );
      return 1;
    }

    if (noteIds.size) {
      console.log(
        `[douyin] note: ${noteIds.size} image post(s) skipped — not yet supported\n` +
          '  (see https://github.com/luojiahai/skills/issues/39)',
      );
    }

    // A gap here is usually structural, not a failure: posts that are private,
    // deleted, or region-locked are counted in 作品 but never render as cards.
    // Measured on a 284-video account, this reports 282 every run.
    const seen = ids.size + noteIds.size;
    if (expected !== null && seen < expected) {
      console.log(
        `[douyin] note: ${seen} of ${expected} — ${expected - seen} post(s) ` +
          'counted but not shown (private, deleted, or region-locked)',
      );
    }

    const text =
      [...ids].map((id) => `https://www.douyin.com/video/${id}`).join('\n') + '\n';
    await writeFile(opts.output, text, 'utf8');
    console.log(`[douyin] wrote ${ids.size} post URLs to ${opts.output}`);

    if (opts.meta) {
      await writeFile(
        opts.meta,
        JSON.stringify(
          {
            sec_uid: secUid,
            douyin_id: meta.douyinId,
            nickname: meta.nickname,
            collected_count: ids.size,
            reported_works_count: expected,
            // Seen in the grid, deliberately absent from the URL list above.
            skipped_image_posts: noteIds.size,
            // Deliberately no "newest" field: grid order puts pinned posts
            // first, so position 0 is not reliably the newest upload — and
            // nothing needs one, since what has been archived is answered by
            // the post folders on disk.
          },
          null,
          2,
        ) + '\n',
        'utf8',
      );
    }
    return 0;
  } finally {
    await context.close();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`error: ${err.message}`);
    process.exit(1);
  });
