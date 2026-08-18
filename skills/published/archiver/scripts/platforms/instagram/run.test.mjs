/**
 * Tests for run.mjs — the orchestration.
 *
 * `main()` is exercised in-process rather than through archive.sh, which is how
 * the dispatcher reaches it, with the collector, the fetcher, the tool preflight
 * and the session all injected — so these assert on the run's decisions rather
 * than on what happens to be installed.
 *
 * Every run goes through `emitted`, which takes the one document off stdout and
 * validates it against the output schema.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { main } from './run.mjs';
import { postDir } from './fetch.mjs';
import { EXIT } from '../../shared/exit.mjs';
import { Refusal } from '../../shared/errors.mjs';
import { buildPost, writePost } from '../../shared/post.mjs';
import { emitted } from '../../testing.mjs';

// Realpath'd, because normalizeRoot does: on macOS /var is a symlink to
// /private/var, and a plan made one way would be refused the other.
const archivesRoot = async () => realpathSync(await mkdtemp(path.join(os.tmpdir(), 'ig-run-')));

const PROFILE = 'https://www.instagram.com/someone';
const ACCOUNT = { id: '55', username: 'someone', nickname: 'Some One' };

/** One gallery-dl row per file, which is what a listing pass emits. */
const row = (shortcode, over = {}) => ({
  shortcode,
  num: 1,
  count: 1,
  ext: 'jpg',
  mediaId: `m${shortcode}`,
  type: 'GraphImage',
  url: `https://scontent.cdninstagram.com/${shortcode}.jpg`,
  date: '2024-03-11 07:22:19',
  user: { id: '55', name: 'someone', nick: 'Some One' },
  content: '',
  category: 'posts',
  ...over,
});

const collected = (over = {}) => ({
  rows: [row('AAA'), row('BBB')],
  account: ACCOUNT,
  sweeps: [
    { category: 'posts', stoppedEarly: false },
    { category: 'reels', stoppedEarly: false },
  ],
  failure: null,
  stderr: '',
  code: 0,
  ...over,
});

function deps(over = {}) {
  const listing = over.collectImpl ?? (async () => collected());
  return {
    // Lands each post the way the real fetcher does — post.json written, media
    // listed and present — because the run reports its total by asking the
    // folder, and a fetcher that wrote nothing would be reporting on nothing.
    fetchImpl: async ({ accountDir, posts }) => {
      for (const post of posts) {
        await writePost(postDir(accountDir, post), buildPost({ id: post.shortcode }));
      }
      return { fetched: { posts: posts.length, files: posts.length }, failed: 0, stopped: null };
    },
    onPathImpl: async () => true,
    cookiesImpl: async () => '/tmp/cookies.txt',
    ensureEnvImpl: async () => {},
    ...over,
    // Wrapped last, so a test's own listing still goes through the account
    // callback. That callback is what settles the folder and reads the archive,
    // so a listing that never fired it would exercise none of doPlan's real work.
    collectImpl: async (args) => {
      const result = await listing(args);
      if (result.account && args.onAccount) await args.onAccount(result.account);
      return result;
    },
  };
}

const run = (argv, over = {}) => emitted(main, argv, deps(over));

const noteWith = (document, code) => document.result.notes.find((note) => note.code === code);
const notesWith = (document, code) => document.result.notes.filter((note) => note.code === code);

// ---- the envelope -----------------------------------------------------------

test('a plan answers in one document, naming the command and the platform', async () => {
  const dir = await archivesRoot();
  const { document, stdout } = await run([PROFILE, '--archives', dir, '--plan']);

  assert.equal(document.schema, 1);
  assert.equal(document.ok, true);
  assert.equal(document.command, 'plan');
  assert.equal(document.platform, 'instagram');
  assert.deepEqual(JSON.parse(stdout), document, 'stdout holds the document and nothing else');
});

test("the account arrives as fields, with Instagram's own readable handle", async () => {
  const dir = await archivesRoot();
  const { document } = await run([PROFILE, '--archives', dir, '--plan']);

  assert.deepEqual(document.result.account, {
    id: '55',
    username: 'someone',
    nickname: 'Some One',
    url: PROFILE,
  });
});

test("Instagram's own numbers nest inside the counts", async () => {
  const dir = await archivesRoot();
  const { document } = await run([PROFILE, '--archives', dir, '--plan'], {
    collectImpl: async () => collected({ rows: [row('AAA'), row('BBB', { category: 'reels', ext: 'mp4' })] }),
  });

  assert.equal(document.result.counts.found, 2);
  assert.deepEqual(document.result.counts.platform, {
    found_files: 2,
    fetch_files: 2,
    images: 1,
    videos: 1,
    // A post count, unlike the file counts beside it: a reel is one video, and
    // the number a user could check against their own profile is posts.
    reels: 1,
  });
});

test('each listing pass reports its own sweep', async () => {
  // A single merged verdict could not say which feed was cut short, and "the
  // sweep may be short" without saying short of what is unactionable.
  const dir = await archivesRoot();
  const { document } = await run([PROFILE, '--archives', dir, '--plan']);

  assert.deepEqual(notesWith(document, 'sweep'), [
    { code: 'sweep', mode: 'full', stopped_early: false, threshold: null, category: 'posts' },
    { code: 'sweep', mode: 'full', stopped_early: false, threshold: null, category: 'reels' },
  ]);
});

test('a re-run that stopped partway through one feed says which feed', async () => {
  const dir = await archivesRoot();
  await run([PROFILE, '--archives', dir, '--yes']);

  const { document } = await run([PROFILE, '--archives', dir, '--plan'], {
    collectImpl: async () =>
      collected({
        sweeps: [
          { category: 'posts', stoppedEarly: false },
          { category: 'reels', stoppedEarly: true },
        ],
      }),
  });

  const sweeps = notesWith(document, 'sweep');
  assert.equal(sweeps.find((n) => n.category === 'posts').stopped_early, false);
  assert.equal(sweeps.find((n) => n.category === 'reels').stopped_early, true);
  assert.equal(sweeps[0].mode, 'incremental');
});

test('a plan with work to do hands over the exact next command', async () => {
  const dir = await archivesRoot();
  const { document } = await run([PROFILE, '--archives', dir, '--full', '--plan']);

  assert.equal(document.result.next.run_by, 'agent');
  assert.match(document.result.next.command, /--go$/);
  assert.ok(document.result.next.command.includes('--full'), "the user's own flags survive");
  assert.ok(document.result.next.command.includes(dir));
});

test('--yes emits exactly one document', async () => {
  const dir = await archivesRoot();
  const { document, stdout } = await run([PROFILE, '--archives', dir, '--yes']);

  assert.equal(document.command, 'yes');
  assert.deepEqual(JSON.parse(stdout), document);
  assert.equal(document.result.run.downloaded, 2);
  assert.equal(document.result.run.total, 2);
});

test('a second run finds nothing new and says so without asking', async () => {
  const dir = await archivesRoot();
  await run([PROFILE, '--archives', dir, '--yes']);

  const { document } = await run([PROFILE, '--archives', dir, '--plan']);
  assert.equal(document.result.counts.to_fetch, 0);
  assert.equal(document.result.next, undefined, 'nothing to approve means no next step');
});

// ---- the archive ------------------------------------------------------------

test('the account folder is the numeric id, not the mutable handle', async () => {
  // An Instagram handle can be given up and taken by somebody else. A folder
  // named for one would archive whoever holds that name today.
  const dir = await archivesRoot();
  const { document } = await run([PROFILE, '--archives', dir, '--plan']);
  assert.equal(document.result.dir, path.join(dir, 'instagram', '55'));
});

test('a post folder carries the shortcode, and is read back as one', async () => {
  // The shortcode is not numeric, and a folder the archive writes and cannot
  // read back is a post re-downloaded on every run forever.
  const dir = await archivesRoot();
  await run([PROFILE, '--archives', dir, '--yes'], {
    collectImpl: async () => collected({ rows: [row('C3xY-_9Ab')] }),
  });

  const { document } = await run([PROFILE, '--archives', dir, '--plan'], {
    collectImpl: async () => collected({ rows: [row('C3xY-_9Ab')] }),
  });
  assert.equal(document.result.counts.on_disk, 1);
  assert.equal(document.result.counts.to_fetch, 0);
});

test('account.json records the identity before anything is downloaded', async () => {
  const dir = await archivesRoot();
  await run([PROFILE, '--archives', dir, '--plan']);

  const written = JSON.parse(await readFile(path.join(dir, 'instagram', '55', 'account.json'), 'utf8'));
  assert.equal(written.platform, 'instagram');
  assert.equal(written.account.username, 'someone');
  assert.equal(written.url, PROFILE);
});

test('there is no assets directory, because nothing here reads an avatar', async () => {
  // gallery-dl's Instagram rows carry no profile-image URL, and a second
  // request per run against that limiter is not worth an avatar.
  const dir = await archivesRoot();
  await run([PROFILE, '--archives', dir, '--yes']);
  await assert.rejects(() => readFile(path.join(dir, 'instagram', '55', 'assets', 'avatar.jpg')));
});

// ---- what the site said -----------------------------------------------------

test('a rate limit, a rejected session and a checkpoint are three codes', async () => {
  const dir = await archivesRoot();
  for (const [failure, exit] of [
    ['rate-limited', EXIT.FAILED],
    ['session-rejected', EXIT.UNAUTHORIZED],
    ['checkpoint-required', EXIT.UNAUTHORIZED],
  ]) {
    const { document } = await run([PROFILE, '--archives', dir, '--plan'], {
      collectImpl: async () => collected({ failure, rows: [], account: null }),
    });
    assert.equal(document.error.code, failure, failure);
    assert.equal(document.exit, exit, failure);
  }
});

test('a checkpoint keeps the cached session, and a rejection throws it away', async () => {
  // The cookies are fine when the account is held. Discarding them would charge
  // the user a browser read to replace a login that works.
  const dir = await archivesRoot();
  const discarded = [];

  for (const failure of ['checkpoint-required', 'session-rejected']) {
    await run([PROFILE, '--archives', dir, '--plan'], {
      collectImpl: async () => collected({ failure, rows: [], account: null }),
      cookiesImpl: async () => {
        discarded.push('read');
        return '/tmp/cookies.txt';
      },
    });
  }

  const { document } = await run([PROFILE, '--archives', dir, '--plan'], {
    collectImpl: async () => collected({ failure: 'checkpoint-required', rows: [], account: null }),
  });
  assert.match(document.error.remedy.message, /clear the prompt/i);
  assert.equal(document.error.remedy.run_by, 'user');
  assert.doesNotMatch(document.error.remedy.message, /sign in again/i);
});

test('zero posts is its own refusal, never "up to date"', async () => {
  // A private account and one that has posted nothing are the same silence.
  const dir = await archivesRoot();
  const { document } = await run([PROFILE, '--archives', dir, '--plan'], {
    collectImpl: async () => collected({ rows: [], account: null }),
  });

  assert.equal(document.error.code, 'empty');
  assert.equal(document.exit, EXIT.EMPTY);
});

test('an account id that could not be a folder name stops the run', async () => {
  const dir = await archivesRoot();
  const { document } = await run([PROFILE, '--archives', dir, '--plan'], {
    collectImpl: async ({ onAccount }) => {
      // What the collector is told is "stop now", which it turns into a stopper
      // that fires on the first row — a throw inside the row loop would surface
      // as an unexplained stream failure rather than as the refusal it is.
      const settled = await onAccount({ id: '../evil', username: 'someone', nickname: '' });
      assert.equal(settled.stopNow, true);
      return collected({ rows: [], account: null });
    },
  });

  assert.equal(document.error.code, 'bad-account-id');
});

// ---- the command line -------------------------------------------------------

test('a single-post URL is refused rather than read as the account', async () => {
  const { document } = await run(['https://www.instagram.com/someone/p/C3xY', '--plan']);
  assert.equal(document.error.code, 'url-single-post');
  assert.equal(document.exit, EXIT.USAGE);
});

test('an unknown flag is the user typo to see, not a guess to make', async () => {
  const { document } = await run([PROFILE, '--stories', '--plan']);
  assert.equal(document.error.code, 'unknown-flag');
  assert.equal(document.error.details.flag, '--stories');
});

test('a flag given no value is refused rather than dropped', async () => {
  const { document } = await run([PROFILE, '--alias', '--plan']);
  assert.equal(document.error.code, 'flag-needs-value');
});

test('the session is resolved through the shared cookie cache, named for this platform', async () => {
  const dir = await archivesRoot();
  const asked = [];
  await run([PROFILE, '--archives', dir, '--browser', 'chrome', '--plan'], {
    cookiesImpl: async (descriptor, options) => {
      asked.push({ descriptor, options });
      return '/tmp/cookies.txt';
    },
  });

  assert.equal(asked[0].descriptor.platform, 'instagram');
  assert.equal(asked[0].descriptor.label, 'Instagram');
  assert.equal(asked[0].options.browser, 'chrome');
});

test('a session refusal stops the run before anything is collected', async () => {
  const dir = await archivesRoot();
  const { document } = await run([PROFILE, '--archives', dir, '--plan'], {
    cookiesImpl: async () => {
      throw new Refusal('no-session-source', 'no saved Instagram session yet', {
        details: { browsers: ['chrome'] },
      });
    },
    collectImpl: async () => assert.fail('nothing may be collected without a session'),
  });

  assert.equal(document.error.code, 'no-session-source');
});

test('Instagram asks for no browser box, so nobody downloads Chromium for it', async () => {
  const dir = await archivesRoot();
  let asked = null;
  await run([PROFILE, '--archives', dir, '--plan'], {
    ensureEnvImpl: async (boxes, { platform }) => {
      asked = { boxes, platform };
    },
  });

  assert.deepEqual(asked, { boxes: ['runtime', 'tools'], platform: 'instagram' });
});

test('--go without a plan refuses and hands back the command that makes one', async () => {
  const dir = await archivesRoot();
  await run([PROFILE, '--archives', dir, '--plan']);

  // A plan exists but is emptied by a --go that lands everything; the second
  // --go then has nothing approved to act on.
  await run([PROFILE, '--archives', dir, '--go']);
  const { document } = await run([PROFILE, '--archives', dir, '--go']);

  assert.match(document.error.code, /^plan-/);
  assert.equal(document.error.remedy.run_by, 'agent');
  assert.match(document.error.remedy.command, /--plan$/);
});

test('an alias renames on the download step, and is announced before it happens', async () => {
  const dir = await archivesRoot();
  // Archived first under its id, so the alias is a move rather than a name
  // chosen at creation. The second run finds one more post, so there is
  // something for the --go to act on.
  const first = { collectImpl: async () => collected({ rows: [row('AAA')] }) };
  await run([PROFILE, '--archives', dir, '--yes'], first);

  const { document: planned } = await run([PROFILE, '--archives', dir, '--alias', 'them', '--plan']);
  assert.equal(noteWith(planned, 'moving-to').dir, path.join(dir, 'instagram', 'them'));
  // A preview that silently reorganised the archive would be a preview that lied.
  assert.equal(planned.result.dir, path.join(dir, 'instagram', '55'));

  const { document: done } = await run([PROFILE, '--archives', dir, '--alias', 'them', '--go']);
  assert.equal(done.result.dir, path.join(dir, 'instagram', 'them'));
});

test('a new account given an alias is created under it, with nothing to move', async () => {
  const dir = await archivesRoot();
  const { document } = await run([PROFILE, '--archives', dir, '--alias', 'them', '--plan']);

  assert.equal(document.result.dir, path.join(dir, 'instagram', 'them'));
  assert.equal(noteWith(document, 'moving-to'), undefined, 'nothing is moving');
});
