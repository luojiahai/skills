/**
 * testing.mjs — a Douyin profile without a browser.
 *
 * The scroll loop is the one part of this platform that cannot be reached by
 * reading a payload: what it gets right is *when it stops*, which only a grid
 * that grows under it can put a question to. `collect()` takes its browser as an
 * argument for this reason, and this is what the tests hand it.
 *
 * Here rather than in one of the two test files that drive it, because both do:
 * `collect.test.mjs` asks what the loop collects, and `run.test.mjs` asks what a
 * whole run says about it, and a second copy of the fake would let those two
 * questions be answered against two different profiles.
 */

const DEFAULT_META = { douyinId: 'abc123', nickname: '小明', worksCount: 405, worksCountRounded: false };

/**
 * A browser whose profile grid is a script of scroll rounds: `rounds[n]` is what
 * the nth scroll reveals, and the grid holds every round revealed so far.
 *
 * The profile feed answers for every video the grid shows, because that is what
 * renders the cards — except the ids named in `unattributed`, which stand for a
 * recommendation rail: on the page, and never in this account's feed.
 */
export function fakeProfile({ rounds, unattributed = [], meta = {} }) {
  const stranger = new Set(unattributed.map(String));
  const state = { revealed: 0, scrolls: 0, closed: false };
  const onResponse = [];

  const shown = (key) => rounds.slice(0, state.revealed).flatMap((round) => round[key] ?? []).map(String);

  const page = {
    on: (event, handler) => { if (event === 'response') onResponse.push(handler); },
    goto: async () => { state.revealed = 1; },
    waitForTimeout: async () => {},
    evaluate: async (fn) => {
      if (fn.name === 'scrollInPage') {
        state.scrolls++;
        state.revealed = Math.min(state.revealed + 1, rounds.length);
        return undefined;
      }
      if (fn.name !== 'harvestInPage') return { ...DEFAULT_META, ...meta };

      // The requests that render the cards are what name them as this account's,
      // and they land before the cards do.
      const videos = shown('videos');
      const named = videos.filter((id) => !stranger.has(id));
      if (named.length) {
        const payload = { aweme_list: named.map((id) => ({ aweme_id: id, desc: '', create_time: 1710144139 })) };
        const response = {
          url: () => 'https://www.douyin.com/aweme/v1/web/aweme/post/?count=18',
          json: async () => payload,
        };
        for (const handler of onResponse) await handler(response);
      }
      return { videos, notes: shown('notes') };
    },
  };

  const launch = {
    launchPersistentContext: async () => ({
      pages: () => [page],
      close: async () => { state.closed = true; },
    }),
  };
  return { launch, state };
}
