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
import { execFile } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { doGo, main } from './run.mjs';
import { postDir } from './fetch.mjs';
import { EXIT } from '../shared/exit.mjs';
import { Refusal } from '../shared/errors.mjs';
import { buildPlan } from '../shared/plan.mjs';
import { savePlan } from '../shared/sync.mjs';
import { archiveCounts } from '../shared/output.mjs';
import { emitted, validate } from '../testing.mjs';

const exec = promisify(execFile);
const ARCHIVE_SH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'archive.sh');

// Realpath'd, because normalizeRoot does: on macOS /var is a symlink to
// /private/var, and a plan made one way would be refused the other.
const archivesRoot = async () => realpathSync(await mkdtemp(path.join(os.tmpdir(), 'x-run-')));

/** One gallery-dl row per file, which is what the listing pass emits. */
const row = (tweetId, over = {}) => ({
  tweetId,
  num: 1,
  count: 1,
  ext: 'jpg',
  mediaId: `m${tweetId}`,
  type: 'photo',
  url: `https://pbs.twimg.com/${tweetId}.jpg`,
  date: '2024-03-11T09:22:19Z',
  user: { id: '55', name: 'jack', nick: 'Jack', avatar: '', banner: '' },
  replyId: '',
  content: '',
  ...over,
});

const collected = (over = {}) => ({
  rows: [row('1'), row('2')],
  account: { id: '55', handle: 'jack', nickname: 'Jack', avatar: '', banner: '' },
  stoppedEarly: false,
  failure: null,
  stderr: '',
  code: 0,
  ...over,
});

function deps(over = {}) {
  const listing = over.collectImpl ?? (async () => collected());
  return {
    fetchImpl: async ({ posts }) => ({
      fetched: { posts: posts.length, files: posts.length },
      failed: 0,
      stopped: null,
    }),
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

// ---- the envelope -----------------------------------------------------------

test('a plan answers in one document, naming the command and the platform', async () => {
  const dir = await archivesRoot();
  const { document, stdout } = await run(['https://x.com/jack', '--archives', dir, '--plan']);

  assert.equal(document.schema, 1);
  assert.equal(document.ok, true);
  assert.equal(document.command, 'plan');
  assert.equal(document.platform, 'x');
  assert.deepEqual(JSON.parse(stdout), document, 'stdout holds the document and nothing else');
});

test('the account arrives as fields, with X’s own readable handle', async () => {
  const dir = await archivesRoot();
  const { document } = await run(['https://x.com/jack', '--archives', dir, '--plan']);

  assert.deepEqual(document.result.account, {
    id: '55',
    handle: 'jack',
    nickname: 'Jack',
    url: 'https://x.com/jack',
  });
});

test('X’s own numbers nest inside the counts', async () => {
  const dir = await archivesRoot();
  const { document } = await run(['https://x.com/jack', '--archives', dir, '--plan']);

  assert.equal(document.result.counts.found, 2);
  assert.equal(document.result.counts.to_fetch, 2);
  assert.deepEqual(document.result.counts.platform, {
    found_files: 2,
    fetch_files: 2,
    images: 2,
    videos: 0,
  });
});

test('the sweep is a note with its mode and threshold, not a sentence', async () => {
  // Without it, `to_fetch: 0` cannot be told apart from "gave up before reaching
  // anything new".
  const dir = await archivesRoot();
  const { document } = await run(['https://x.com/jack', '--archives', dir, '--plan']);

  assert.deepEqual(noteWith(document, 'sweep'), {
    code: 'sweep',
    mode: 'full',
    stopped_early: false,
    threshold: null,
  });
});

test('a plan with work to do hands over the exact next command', async () => {
  const dir = await archivesRoot();
  const { document } = await run(['https://x.com/jack', '--archives', dir, '--full', '--plan']);

  assert.equal(document.result.next.run_by, 'agent');
  assert.match(document.result.next.command, /--go$/);
  assert.ok(document.result.next.command.includes('--full'), 'the user’s own flags survive');
  assert.ok(document.result.next.command.includes(dir));
});

test('--yes emits exactly one document', async () => {
  const dir = await archivesRoot();
  const { document, stdout } = await run(['https://x.com/jack', '--archives', dir, '--yes']);

  assert.equal(document.command, 'yes');
  assert.deepEqual(JSON.parse(stdout), document);
  assert.equal(document.result.run.downloaded, 2);
  assert.equal(document.result.run.total, 2);
  assert.ok(document.result.plan, '--yes carries the plan window too');
});

test('--yes still says a rename is happening', async () => {
  // The user is past being asked, not past being told: a preview that announced
  // a move and a run that performed it silently are the same surprise.
  const dir = await archivesRoot();
  await run(['https://x.com/jack', '--archives', dir, '--plan']);

  const { document } = await run(['https://x.com/jack', '--archives', dir, '--alias', 'jia', '--yes']);
  assert.equal(noteWith(document, 'moving-to').dir, path.join(dir, 'x', 'jia'));
});

test('--go carries no plan window, because it is acting on a list already approved', async () => {
  const dir = await archivesRoot();
  await run(['https://x.com/jack', '--archives', dir, '--plan']);

  const { document } = await run(['https://x.com/jack', '--archives', dir, '--go']);
  assert.equal(document.result.plan, undefined);
});

// ---- what the site said -----------------------------------------------------

test('a rate limit and a rejected session are distinct codes', async () => {
  // One says wait, the other says sign in again.
  const dir = await archivesRoot();
  for (const [failure, exit] of [['rate-limited', EXIT.FAILED], ['session-rejected', EXIT.UNAUTHORIZED]]) {
    const { document } = await run(['https://x.com/jack', '--archives', dir, '--plan'], {
      collectImpl: async () => collected({ failure, rows: [], account: null }),
    });
    assert.equal(document.error.code, failure);
    assert.equal(document.exit, exit);
  }
});

test('protected, suspended and no-such-account are three codes, and none is "up to date"', async () => {
  const dir = await archivesRoot();
  for (const failure of ['protected', 'suspended', 'no-such-account']) {
    const { document } = await run(['https://x.com/jack', '--archives', dir, '--plan'], {
      collectImpl: async () => collected({ failure, rows: [], account: null }),
    });
    assert.equal(document.error.code, failure);
    assert.equal(document.ok, false);
  }
});

test('an unrecognised listing failure keeps gallery-dl’s last words', async () => {
  const dir = await archivesRoot();
  const { document } = await run(['https://x.com/jack', '--archives', dir, '--plan'], {
    collectImpl: async () =>
      collected({ failure: 'collect-failed', rows: [], account: null, stderr: 'something went wrong\n' }),
  });

  assert.equal(document.error.code, 'collect-failed');
  assert.match(document.error.details.stderr_tail, /something went wrong/);
});

test('an account with no media is EMPTY, never "up to date"', async () => {
  // An account you are not allowed to read produces exactly the same silence.
  const dir = await archivesRoot();
  const { document } = await run(['https://x.com/jack', '--archives', dir, '--plan'], {
    collectImpl: async () => collected({ rows: [] }),
  });

  assert.equal(document.error.code, 'empty');
  assert.equal(document.exit, EXIT.EMPTY);
});

test('a timeline that never named the account has its own code', async () => {
  const dir = await archivesRoot();
  const { document } = await run(['https://x.com/jack', '--archives', dir, '--plan'], {
    collectImpl: async () => collected({ account: null }),
  });

  assert.equal(document.error.code, 'unidentified-account');
});

test('an account id this skill will not use as a folder name is refused, and quoted back', async () => {
  const dir = await archivesRoot();
  const { document } = await run(['https://x.com/jack', '--archives', dir, '--plan'], {
    collectImpl: async () => collected({ account: { id: '../etc', handle: 'jack' } }),
  });

  assert.equal(document.error.code, 'bad-account-id');
  assert.equal(document.error.details.id, '../etc');
});

test('a run that stopped partway carries both what landed and why it stopped', async () => {
  // Neither reported as finished, nor thrown away.
  const dir = await archivesRoot();
  const { document } = await run(['https://x.com/jack', '--archives', dir, '--yes'], {
    fetchImpl: async () => ({ fetched: { posts: 1, files: 1 }, failed: 0, stopped: 'rate-limited' }),
  });

  assert.equal(document.ok, false);
  assert.equal(document.error.code, 'rate-limited');
  assert.equal(document.error.remedy.run_by, 'agent');
  assert.equal(document.result.run.downloaded, 1, 'the posts it fetched are still reported');
  assert.equal(document.result.run.remaining, 2);
});

// ---- the session ------------------------------------------------------------

test('no session and no browser to read one from names the browsers it accepts', async () => {
  const dir = await archivesRoot();
  const { document } = await run(['https://x.com/jack', '--archives', dir, '--plan'], {
    cookiesImpl: async () => {
      throw new Refusal('no-session-source', 'no saved X session yet', {
        details: { browsers: ['chrome', 'firefox'] },
      });
    },
  });

  assert.equal(document.error.code, 'no-session-source');
  assert.deepEqual(document.error.details.browsers, ['chrome', 'firefox']);
});

// ---- the command line -------------------------------------------------------

test('--downloads is refused by name rather than as a generic unknown flag', async () => {
  // Dropping the flag from KNOWN_FLAGS alone would report it as an unknown
  // option — true, but it sends the user to --help to work out what happened.
  // The whole risk of this rename is a stale command still in someone's shell
  // history, so the refusal names its replacement.
  const { document } = await run(['https://x.com/someone', '--downloads', '/data']);

  assert.equal(document.exit, EXIT.USAGE);
  assert.equal(document.error.code, 'downloads-renamed');
});

test('archive.sh refuses --downloads before any platform preflights its tools', async () => {
  // A platform refuses it too, but only past its own tool preflight — so on a
  // machine without gallery-dl a stale command would report the missing tool
  // instead of the rename that actually broke it. Exiting before dispatch is
  // also what makes this test independent of what is installed here. It happens
  // before node exists to compose a document, so the shell writes one by hand.
  const failed = await exec(ARCHIVE_SH, ['https://x.com/someone', '--downloads', '/data']).then(
    () => null,
    (error) => error,
  );

  assert.ok(failed, 'expected a non-zero exit');
  assert.equal(failed.code, 2);
  const document = validate(JSON.parse(failed.stdout));
  assert.equal(document.error.code, 'downloads-renamed');
  assert.equal(document.exit, 2);
});

test('a post URL is refused before anything is fetched', async () => {
  // A /status/ URL carries the handle in exactly the position a profile URL
  // does, so what this prevents is a request for one post being answered by
  // archiving the entire account. --yes is passed because the pre-authorised
  // path must refuse it too.
  const dir = await archivesRoot();
  const { document } = await run([
    'https://x.com/someone/status/1767', '--yes', '--archives', dir,
  ]);

  assert.equal(document.exit, EXIT.USAGE);
  assert.equal(document.error.code, 'url-out-of-scope');
  assert.equal(document.error.details.section, 'status');
  // An empty root means no folder was resolved, no schema stamped, nothing
  // fetched.
  assert.ok(!existsSync(path.join(dir, 'x')));
});

test('every flag the usage text offers is declared, and the ones taking a value consume it', async () => {
  // Asked of main() rather than of the parser, because the parser is only ever
  // as right as the sets it is handed and this is where they are handed to it.
  //
  // A post URL is used so the run refuses for a reason of its own, and the value
  // flags lead so their arguments have somewhere wrong to go: a flag that takes
  // a value must be declared as one, or its value lands in the positional list
  // the URL is read from. Each way of getting this wrong refuses under its own
  // code — an undeclared flag is `unknown-flag`, and a value read as the URL is
  // refused as a URL rather than as a post.
  const { document } = await run([
    '--browser', 'chrome', '--cookies', '/tmp/c.txt', '--full',
    'https://x.com/someone/status/1767',
  ]);

  assert.equal(document.error.code, 'url-out-of-scope');
});

test('an actually unknown flag still reports as unknown', async () => {
  // The targeted refusal above must not swallow the general case it sits in
  // front of.
  const { document } = await run(['https://x.com/someone', '--nonsense']);

  assert.equal(document.exit, EXIT.USAGE);
  assert.equal(document.error.code, 'unknown-flag');
  assert.equal(document.error.details.flag, '--nonsense');
});

test('the environment is built before the session is read out of a browser', async () => {
  // Reading a browser profile prompts for Keychain access and wants the browser
  // closed. Paying that for a run that cannot proceed is the wrong order.
  let readCookies = false;
  const { document } = await run(['https://x.com/jack', '--plan'], {
    ensureEnvImpl: async () => {
      throw new Refusal('env-build-failed', 'no network', {
        details: { boxes: ['tools'], dir: '/cache', output: '' },
        remedy: { message: 'try again', run_by: 'user' },
      });
    },
    cookiesImpl: async () => {
      readCookies = true;
      return '/tmp/cookies.txt';
    },
  });

  assert.equal(document.exit, EXIT.FAILED);
  assert.equal(document.error.code, 'env-build-failed');
  assert.equal(readCookies, false);
});

test('the first run asks before downloading anything', async () => {
  const { document } = await run(['https://x.com/jack', '--plan'], {
    ensureEnvImpl: async (boxes, { platform }) => {
      assert.deepEqual(boxes, ['runtime', 'tools'], 'X never downloads a browser');
      assert.equal(platform, 'x');
      throw new Refusal('env-consent', 'nothing built yet', {
        details: { boxes, download_mb: 150, dir: '/cache' },
        remedy: { message: 'ask first', command: '/skill/setup.sh x', run_by: 'agent' },
      });
    },
  });

  assert.equal(document.exit, EXIT.REFUSED);
  assert.equal(document.error.code, 'env-consent');
  assert.equal(document.error.details.download_mb, 150);
  assert.equal(document.error.remedy.run_by, 'agent');
});

test('under the escape hatch a missing downloader still names itself', async () => {
  // The hatch is the one way back to PATH, and the machine it leads to can never
  // be reproduced from here — so the refusal is the entire diagnostic and stays.
  process.env.ARCHIVER_SYSTEM_TOOLS = '1';
  try {
    const { document } = await run(['https://x.com/jack', '--plan'], { onPathImpl: async () => false });

    assert.equal(document.exit, EXIT.FAILED);
    assert.equal(document.error.code, 'tool-missing');
    assert.equal(document.error.details.tool, 'gallery-dl');
    assert.equal(document.error.remedy.run_by, 'user');
  } finally {
    delete process.env.ARCHIVER_SYSTEM_TOOLS;
  }
});

// ---- what --go downloads ----------------------------------------------------

const tweet = (tweetId) => ({ tweetId, date: '2024-03-11T09:22:19Z', content: '', files: [] });

/**
 * The download half against a parked plan, with a downloader that succeeds and
 * writes nothing. fetchPosts makes each post's folder before it spawns anything,
 * so the folders that appear are the posts it was handed.
 */
async function go(root, { collected: seen, pending }) {
  const accountDir = path.join(root, 'x', '55');
  await mkdir(accountDir, { recursive: true });

  await savePlan(
    accountDir,
    buildPlan({
      account: { id: '55', handle: 'jack' },
      root,
      collected: seen,
      pending,
      counts: archiveCounts({ found: seen.length, onDisk: seen.length - pending.length, toFetch: pending.length }),
      now: new Date(),
    }),
  );

  const result = await doGo({
    root,
    dir: accountDir,
    url: 'https://x.com/jack',
    handle: 'jack',
    planCommand: 'archive.sh https://x.com/jack --plan',
    bin: '/usr/bin/true',
  });

  return { accountDir, result };
}

test('--go fetches what the plan counted, not everything the listing saw', async () => {
  // The listing saw three posts and one was counted as new, the other two being
  // on disk. One of those two is missing by the time --go runs. It is not
  // fetched: it was never part of the number the user said yes to, and the next
  // --plan is what offers it.
  const root = await archivesRoot();
  const [gone, held, fresh] = [tweet('1'), tweet('2'), tweet('3')];

  const { accountDir } = await go(root, { collected: [gone, held, fresh], pending: [fresh] });

  assert.ok(existsSync(postDir(accountDir, fresh)), 'the approved post is fetched');
  assert.ok(!existsSync(postDir(accountDir, gone)), 'a post the plan never counted is left alone');
  assert.ok(!existsSync(postDir(accountDir, held)));
});

test('a plan is retired once every post in it has landed', async () => {
  const root = await archivesRoot();
  const fresh = tweet('3');

  const { accountDir, result } = await go(root, { collected: [tweet('1'), fresh], pending: [fresh] });

  assert.equal(result.remaining, 0);
  const sync = JSON.parse(await readFile(path.join(accountDir, 'sync.json'), 'utf8'));
  assert.equal(sync.plan ?? null, null);
});

test('--go without an archive under this root is refused, and says how to make one', async () => {
  const root = await archivesRoot();
  const { document } = await run(['https://x.com/jack', '--archives', root, '--go']);

  assert.equal(document.exit, EXIT.REFUSED);
  assert.equal(document.error.code, 'no-archive');
  assert.equal(document.error.details.root, root);
  assert.match(document.error.remedy.command, /--plan$/);
  assert.equal(document.error.remedy.run_by, 'agent');
});
