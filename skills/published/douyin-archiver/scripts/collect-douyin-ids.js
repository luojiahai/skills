/*
 * collect-douyin-ids.js — harvest video IDs from a Douyin profile page.
 *
 * Douyin's profile feed API (/aweme/v1/web/aweme/post/) requires an `a_bogus`
 * signature computed by obfuscated page JS; calling it from a script returns
 * HTTP 200 with an empty body. So instead of calling the API, this runs inside
 * the page and reads the IDs the page has already rendered, letting Douyin's
 * own JS do the signing.
 *
 * Usage:
 *   1. Open the profile, e.g. https://www.douyin.com/user/MS4wLjABAAAA...
 *   2. Open DevTools (Cmd+Opt+I) -> Console. Chrome may require you to type
 *      `allow pasting` once before it accepts pasted code.
 *   3. Paste this whole file, hit Enter, and leave the tab in the foreground.
 *   4. It scrolls to the end, then downloads `douyin-urls.txt`.
 *
 * Feed it to scripts/download-douyin.sh.
 */
(async () => {
  const CONFIG = {
    scrollDelayMs: 1200, // pause after each scroll, for the next page to load
    stableRounds: 6, // consecutive no-new-ID rounds before declaring the end
    maxRounds: 1000, // hard stop, so a broken page cannot spin forever
    filename: 'douyin-urls.txt',
  };

  const ids = new Set();

  // Cards link as /video/<id>; the modal overlay uses ?modal_id=<id>. Both
  // appear depending on layout, so harvest each.
  //
  // The footer carries SEO recommendation links (tagged ?source=Baiduspider)
  // pointing at *other* accounts' videos — exclude them or you collect
  // strangers' uploads. Grid class names are obfuscated and rotate, so filter
  // by structure rather than matching them.
  const harvest = () => {
    for (const a of document.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href') || '';
      if (a.closest('footer')) continue;
      if (/[?&]source=Baiduspider/.test(href)) continue;
      const m = href.match(/\/video\/(\d+)/) || href.match(/modal_id=(\d+)/);
      if (m) ids.add(m[1]);
    }
  };

  // The profile may scroll the window or an inner div. Pick whichever element
  // actually has overflow, preferring the tallest.
  const findScroller = () => {
    const doc = document.scrollingElement || document.documentElement;
    let best = doc;
    let bestOverflow = doc.scrollHeight - doc.clientHeight;
    for (const el of document.querySelectorAll('div, main, section')) {
      const overflow = el.scrollHeight - el.clientHeight;
      if (overflow <= bestOverflow) continue;
      const style = getComputedStyle(el);
      if (!/(auto|scroll)/.test(style.overflowY)) continue;
      best = el;
      bestOverflow = overflow;
    }
    return best;
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  console.log('[douyin] collecting — keep this tab in the foreground');
  let stable = 0;
  let rounds = 0;

  // Harvest on every round, before scrolling: the feed is virtualised, so
  // cards scrolled far off-screen can be removed from the DOM.
  while (stable < CONFIG.stableRounds && rounds < CONFIG.maxRounds) {
    const before = ids.size;
    harvest();

    const scroller = findScroller();
    scroller.scrollTop = scroller.scrollHeight;
    window.scrollTo(0, document.body.scrollHeight);

    await sleep(CONFIG.scrollDelayMs);
    rounds++;

    if (ids.size === before) {
      stable++;
    } else {
      stable = 0;
      console.log(`[douyin] ${ids.size} videos…`);
    }
  }
  harvest();

  if (rounds >= CONFIG.maxRounds) {
    console.warn('[douyin] hit maxRounds — the list may be incomplete');
  }

  if (ids.size === 0) {
    console.error(
      '[douyin] found 0 videos. Are you on a /user/ profile page, with the ' +
        'video grid visible? A login wall or an empty "Videos" tab both look ' +
        'like this.',
    );
    return;
  }

  const text =
    [...ids].map((id) => `https://www.douyin.com/video/${id}`).join('\n') + '\n';

  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = CONFIG.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  try {
    await navigator.clipboard.writeText(text);
    console.log('[douyin] also copied to clipboard');
  } catch {
    // Clipboard needs focus; the download already succeeded, so this is fine.
  }

  console.log(
    `[douyin] done — ${ids.size} videos in ${CONFIG.filename} (check ~/Downloads)`,
  );
})();
