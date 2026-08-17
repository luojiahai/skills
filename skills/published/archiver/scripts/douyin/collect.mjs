/**
 * collect.mjs — the listing pass: every post an account has, and what each is.
 *
 * Douyin's profile feed API requires an `a_bogus` signature computed by
 * obfuscated page JS, and returns HTTP 200 with an empty body without it. So
 * rather than calling the API, this drives a real browser: the page signs its
 * own requests, and we read what it renders.
 *
 * Two sources, and their roles are not interchangeable.
 *
 * **The DOM is authoritative for which posts exist.** Ids are harvested from the
 * rendered cards, exactly as they always have been. Nothing else may add a post
 * to the list, so no change here can make a collection find fewer posts than the
 * grid shows.
 *
 * **The feed responses supply what each post *is*.** The same requests the page
 * makes to render those cards carry the caption and the timestamp, so they are
 * read in passing and kept against the id. This is what lets `post.json` be
 * written from the account listing rather than reconstructed from the
 * downloader, and what lets a post's folder be named before yt-dlp is invoked.
 *
 * A post the DOM found but no response covered is still collected — with no
 * metadata. fetch.mjs asks yt-dlp for that post's own, one post at a time, so a
 * gap here costs a little and loses nothing.
 *
 * The browser runs in a dedicated profile directory (not your everyday Chrome,
 * which Chrome 136+ refuses to expose to automation). The profile persists, so
 * the session established at sign-in is reused afterwards.
 */
import { loadPlaywright } from './playwright.mjs';

const SCROLL_DELAY_MS = 1200;
const STABLE_ROUNDS = 6; // consecutive no-new-ID rounds before we call it done
const MAX_ROUNDS = 1000; // hard stop, so a broken page cannot spin forever
const HEADER_POLL_MS = 1000; // between re-reads of a header that has not rendered
const HEADER_POLL_TRIES = 12; // giving a slow header ~12s beyond the initial settle

/** The profile feed. Its responses are what carry captions and timestamps. */
const FEED_URL = /\/aweme\/v1\/web\/aweme\/post\//;

/**
 * The posts one feed response describes.
 *
 * Total and defensive on purpose: this parses a payload nobody promised us,
 * read opportunistically off a page. Anything unrecognised yields nothing, and
 * yielding nothing is survivable — the DOM has already said the post exists, and
 * the downloader can still be asked what it is.
 */
export function parseFeedPayload(payload) {
  const list = payload?.aweme_list ?? payload?.data?.aweme_list ?? payload?.data;
  if (!Array.isArray(list)) return [];

  const posts = [];
  for (const entry of list) {
    const id = entry?.aweme_id ?? entry?.awemeId;
    if (id === undefined || id === null) continue;
    if (!/^\d+$/.test(String(id))) continue;
    posts.push({
      id: String(id),
      // `desc` is the caption. An absent one is an empty caption, which is a
      // real state — a post can genuinely have none.
      text: typeof entry?.desc === 'string' ? entry.desc : null,
      createTime: Number.isFinite(entry?.create_time) ? entry.create_time : null,
    });
  }
  return posts;
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

/**
 * Everything the account listing knows.
 *
 * Returns `{ posts, account, reported, skippedImagePosts, hitRoundLimit }`, or
 * `{ failure }` for a grid that rendered nothing — which on this site means a
 * login wall far more often than it means an empty account.
 */
export async function collect({
  url,
  secUid,
  profileDir,
  headless = true,
  limit = Infinity,
  log = () => {},
  launch,
}) {
  const chromium = launch ?? (await loadPlaywright()).chromium;

  const context = await chromium.launchPersistentContext(profileDir, {
    headless,
    viewport: { width: 1280, height: 900 },
    locale: 'zh-CN',
  });

  try {
    const page = context.pages()[0] ?? (await context.newPage());

    // Attached before the first navigation, so the response that renders the
    // first screen of cards is not missed.
    const metadata = new Map();
    page.on('response', async (response) => {
      if (!FEED_URL.test(response.url())) return;
      try {
        for (const post of parseFeedPayload(await response.json())) {
          // First writer wins: the same post can appear in more than one
          // response, and the earliest is the one whose request the page made
          // to render the card we harvested.
          if (!metadata.has(post.id)) metadata.set(post.id, post);
        }
      } catch {
        // An unparseable or already-consumed body is a metadata gap, not a
        // failed collection. fetch.mjs asks yt-dlp for what is missing.
      }
    });

    log('[douyin] opening profile…');
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Give the feed a chance to render before deciding it is empty.
    await page.waitForTimeout(3000);

    // The header renders on its own schedule, and the run is refused when the
    // 抖音号 is missing — so poll rather than trusting one read after a fixed
    // pause. The grid's own rendering time is covered by the stability rule in
    // the scroll loop.
    let meta = await page.evaluate(readProfileMetaInPage);
    for (let tries = 0; meta.douyinId === null && tries < HEADER_POLL_TRIES; tries++) {
      await page.waitForTimeout(HEADER_POLL_MS);
      meta = await page.evaluate(readProfileMetaInPage);
    }
    const reported = meta.worksCount;

    if (meta.douyinId) {
      log(
        `[douyin] ${meta.nickname ?? '?'} (抖音号 ${meta.douyinId})` +
          (reported !== null ? ` — ${reported} post(s)` : ''),
      );
    }

    // Insertion-ordered, so the download phase runs in feed order.
    const ids = new Set();
    // Counted, never collected: nothing downloads these yet (issue #39).
    const noteIds = new Set();
    let stable = 0;
    let rounds = 0;

    const harvest = async () => {
      const { videos, notes } = await page.evaluate(harvestInPage);
      for (const id of notes) noteIds.add(id);
      for (const id of videos) {
        if (ids.size >= limit) break;
        ids.add(id);
      }
    };

    // Harvest before each scroll: the feed is virtualised, so cards scrolled
    // far off-screen get removed from the DOM.
    while (stable < STABLE_ROUNDS && rounds < MAX_ROUNDS && ids.size < limit) {
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
        log(`[douyin] ${ids.size} posts…`, { progress: true });
      }
    }
    await harvest();

    // Notes found but no videos is not a login wall — it is an account whose
    // posts are all 图文. The grid rendered; there is simply nothing here that
    // can be downloaded yet.
    if (ids.size === 0 && noteIds.size === 0) {
      return { failure: 'empty-grid', reported, account: null };
    }

    return {
      posts: [...ids].map((id) => mergeMetadata(id, metadata.get(id))),
      account: {
        id: secUid ?? null,
        douyin_id: meta.douyinId,
        nickname: meta.nickname,
      },
      reported,
      skippedImagePosts: noteIds.size,
      hitRoundLimit: rounds >= MAX_ROUNDS,
      // How many of the collected posts the feed responses actually described,
      // so a run can say when it is about to pay for the difference.
      described: [...ids].filter((id) => metadata.has(id)).length,
    };
  } finally {
    await context.close();
  }
}

function mergeMetadata(id, found) {
  return {
    id,
    text: found?.text ?? null,
    createTime: found?.createTime ?? null,
  };
}
