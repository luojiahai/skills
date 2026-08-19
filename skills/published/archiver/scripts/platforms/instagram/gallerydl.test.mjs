import assert from 'node:assert/strict';
import test from 'node:test';

import { cookieArgs } from '../../shared/session.mjs';
import { fetchArgs as sharedFetchArgs, listArgs as sharedListArgs } from '../../shared/gallerydl.mjs';
import {
  FAILURES,
  PRINT_FORMAT,
  ROW_MARKER,
  THROTTLE,
  classifyFailure,
  parseRow,
  TOOL,
} from './gallerydl.mjs';
import { ERROR_EXITS } from '../../shared/errors.mjs';

test('the print format carries an explicit event prefix', () => {
  // gallery-dl partitions the --print value on its first colon to find an event
  // name. Without "prepare:", the colon inside {date:%Y-%m-%d} would be read as
  // the separator and "{date" as the event.
  assert.ok(PRINT_FORMAT.startsWith('prepare:'));
  assert.ok(PRINT_FORMAT.slice('prepare:'.length).startsWith(`${ROW_MARKER}\t`));
});

test('free-text fields are JSON-encoded in the print format', () => {
  // A caption containing a newline or a tab would otherwise be several rows.
  assert.ok(PRINT_FORMAT.includes('{description!j}'));
  assert.ok(PRINT_FORMAT.includes('{fullname!j}'));
});

test('the media URL is asked for by the keys the extractor actually sets', () => {
  // There is no bare `url` key: the URL gallery-dl downloads from is passed
  // beside the metadata rather than inside it. A video carries video_url, an
  // image only display_url.
  assert.ok(PRINT_FORMAT.includes("{video_url|display_url|''}"));
});

test('every optional extractor field carries a fallback', () => {
  // gallery-dl renders a key it cannot find as the literal string None, which
  // is indistinguishable from a value and would land in post.json as a URL.
  for (const field of ['{media_id', '{typename', '{video_url']) {
    const at = PRINT_FORMAT.indexOf(field);
    assert.ok(at >= 0, `${field} missing from the format`);
    assert.ok(PRINT_FORMAT.slice(at, PRINT_FORMAT.indexOf('}', at)).includes("|''"), `${field} has no fallback`);
  }
});

test('the listing pass downloads nothing and asks for rows', () => {
  const args = listArgs({ url: 'https://www.instagram.com/someone', cookies: '/tmp/c.txt' });
  assert.ok(args.includes('--print'));
  assert.ok(args.includes(PRINT_FORMAT));
  assert.equal(args.at(-1), 'https://www.instagram.com/someone');
});

test('every invocation ignores the user own gallery-dl config', () => {
  // A user's ~/.config/gallery-dl/config.json is loaded first otherwise, and it
  // can quietly change what this skill archives.
  assert.ok(listArgs({ url: 'u' }).includes('--config-ignore'));
  assert.ok(fetchArgs({ url: 'u', directory: '/d' }).includes('--config-ignore'));
});

test('the policy pins the defaults this skill depends on', () => {
  const args = listArgs({ url: 'u' });
  assert.ok(args.includes('extractor.instagram.videos=true'));
  assert.ok(args.includes('extractor.instagram.metadata=false'));
  // Instagram pins up to three posts to the top of a profile. A run that
  // dropped them would be short by the posts the account most wanted seen.
  assert.ok(args.includes('extractor.instagram.pinned=true'));
});

test('which feed is read is the URL, never a config key', () => {
  // `include` is what the profile URL's dispatcher reads to choose between
  // posts, reels and stories. This never hands gallery-dl that URL — each pass
  // names its own extractor — so a config key agreeing with the URL is one more
  // thing that could disagree with it.
  assert.ok(!listArgs({ url: 'u' }).some((arg) => String(arg).includes('include')));
});

test('the pauses are slower than X, because the limiter escalates differently', () => {
  // Instagram answers a client going too fast by challenging the account, not
  // by returning a clean 429. Being slow is the cheap side of that trade.
  const at = THROTTLE.indexOf('--sleep-request');
  assert.ok(at >= 0);
  const [low] = String(THROTTLE[at + 1]).split('-').map(Number);
  assert.ok(low >= 6, `--sleep-request starts at ${low}, which is X's pace`);
});

test('both invocations carry the same throttling', () => {
  const list = listArgs({ url: 'u' });
  const fetch = fetchArgs({ url: 'u', directory: '/d' });
  for (const flag of ['--sleep-request', '--sleep', '--retries']) {
    assert.ok(list.includes(flag), `listArgs missing ${flag}`);
    assert.ok(fetch.includes(flag), `fetchArgs missing ${flag}`);
  }
});

test('a fetch names the exact directory and a numbered filename', () => {
  // The archives root can carry spaces even though a post folder cannot, so the
  // path must still reach gallery-dl as one argument.
  const args = fetchArgs({ url: 'u', directory: '/d/my posts/2024-01-01_C3x' });
  assert.ok(args.includes('--directory'));
  assert.ok(args.includes('/d/my posts/2024-01-01_C3x'));
  assert.ok(args.includes('{num}.{extension}'));
});

test('a run always reads its session from a file, never the live browser', () => {
  assert.deepEqual(cookieArgs({ cookies: '/c.txt' }), ['--cookies', '/c.txt']);
  for (const args of [
    listArgs({ url: 'u', cookies: '/c.txt' }),
    fetchArgs({ url: 'u', directory: '/d', cookies: '/c.txt' }),
  ]) {
    assert.ok(args.includes('--cookies'));
    assert.ok(!args.includes('--cookies-from-browser'));
  }
});

const row = (over = {}) => {
  const fields = {
    shortcode: 'C3xY-_9Ab',
    num: '1',
    ext: 'jpg',
    mediaId: '3298471',
    typename: 'GraphImage',
    url: 'https://scontent.cdninstagram.com/v/a.jpg',
    date: '2024-03-11 07:22:19',
    ownerId: '55',
    username: 'someone',
    fullname: '"Some One"',
    description: '"hello"',
    ...over,
  };
  return [ROW_MARKER, ...Object.values(fields)].join('\t');
};

test('parseRow reads a printed row', () => {
  const parsed = parseRow(row());
  assert.equal(parsed.shortcode, 'C3xY-_9Ab');
  assert.equal(parsed.num, 1);
  assert.equal(parsed.ext, 'jpg');
  assert.equal(parsed.mediaId, '3298471');
  assert.equal(parsed.content, 'hello');
  // Which feed a row came from is stamped by the pass that ran, never read back
  // out of the extractor — the pass is the one thing that cannot be wrong.
  assert.equal(parsed.category, undefined);
  assert.deepEqual(parsed.user, { id: '55', name: 'someone', nick: 'Some One' });
});

test('a caption with a newline survives, because it is JSON on the wire', () => {
  assert.equal(parseRow(row({ description: JSON.stringify('two\nlines\there') })).content, 'two\nlines\there');
});

test('an absent caption reads as no words, never as the four letters null', () => {
  // gallery-dl renders a missing key through !j as the JSON literal null. Left
  // alone that becomes the string "null" and lands in post.json as the caption.
  assert.equal(parseRow(row({ description: 'null' })).content, '');
  assert.equal(parseRow(row({ fullname: 'null' })).user.nick, '');
});

test("gallery-dl's own chatter is never parsed as a row", () => {
  assert.equal(parseRow('[instagram][info] Fetching posts'), null);
  assert.equal(parseRow(''), null);
  assert.equal(parseRow(`${ROW_MARKER}\ttoo\tfew`), null);
});

test('a row whose shortcode could name another directory is dropped', () => {
  // The shortcode becomes half a folder name. A separator here is not a badly
  // named folder, it is a tree somewhere else entirely — so it never gets that
  // far.
  for (const shortcode of ['../../evil', 'a/b', '', 'a.b']) {
    assert.equal(parseRow(row({ shortcode })), null, JSON.stringify(shortcode));
  }
});

test('a row whose owner is not an id is dropped', () => {
  // The owner id becomes the account folder name and the plan's identity check.
  assert.equal(parseRow(row({ ownerId: 'None' })), null);
  assert.equal(parseRow(row({ ownerId: '' })), null);
});

test('failures are told apart, because zero posts is never up to date', () => {
  // Every string here is one gallery-dl's Instagram extractor actually
  // produces, taken from the version this skill pins rather than guessed at.
  const cases = {
    'checkpoint-required': ['HTTP redirect to challenge page (https://www.instagram.com/challenge/)'],
    'rate-limited': ['429 Too Many Requests', 'Please wait a few minutes before you try again.'],
    'session-rejected': [
      'HTTP redirect to login page (https://www.instagram.com/accounts/login/)',
      'authenticated cookies needed to access this resource',
      "HttpError: '401 Unauthorized' for 'https://www.instagram.com/api/v1/'",
    ],
    protected: ["someone's posts are private"],
    'no-such-account': ['NotFoundError: Requested user could not be found'],
  };

  for (const [code, lines] of Object.entries(cases)) {
    for (const line of lines) assert.equal(classifyFailure(line), code, line);
  }
});

test('a Cloudflare challenge is not an account checkpoint', () => {
  // gallery-dl's shared request path says "Cloudflare challenge" for bot
  // protection, which says nothing about this account. Reading it as a
  // checkpoint would send the user into the Instagram app looking for a prompt
  // that is not there.
  assert.equal(classifyFailure('Cloudflare challenge'), null);
});

test('a redirect to the challenge page outranks one that mentions logging in', () => {
  // The challenge page is reached through the same redirect machinery as the
  // login page. Reading it as a dead cookie would throw away a working session
  // and send the user round a circle that cannot close.
  assert.equal(
    classifyFailure('HTTP redirect to challenge page (https://www.instagram.com/challenge/action/)'),
    'checkpoint-required',
  );
});

test('a downloaded filename is not a status code', () => {
  // gallery-dl writes paths and byte counts to the same stream an error goes to.
  assert.equal(classifyFailure('/archives/instagram/55/posts/2024-01-01_C401abc/1.jpg'), null);
  assert.equal(classifyFailure('1401 bytes'), null);
  assert.equal(classifyFailure(''), null);
});

test('every failure this can classify has a sentence and a known exit', () => {
  for (const code of Object.keys(FAILURES)) {
    assert.ok(FAILURES[code].message, `${code} has no message`);
    assert.ok(ERROR_EXITS[code] !== undefined, `${code} has no exit`);
  }
});

test('a checkpoint tells the user to clear it, and never to sign in again', () => {
  // The cookies are fine; the account is held. "Sign in again" is the one
  // instruction that cannot fix it.
  const remedy = FAILURES['checkpoint-required'].remedy;
  assert.equal(remedy.run_by, 'user');
  assert.doesNotMatch(remedy.message, /sign in again/i);
});

/** Bound to this platform's descriptor, which is the only thing it supplies. */
function listArgs(options) {
  return sharedListArgs(TOOL, options);
}

function fetchArgs(options) {
  return sharedFetchArgs(TOOL, options);
}
