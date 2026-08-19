import assert from 'node:assert/strict';
import test from 'node:test';

import { feedUrl, parseTarget, permalink } from './target.mjs';
import { ERROR_EXITS } from '../../shared/errors.mjs';

test('a profile URL is an account', () => {
  assert.deepEqual(parseTarget('https://www.instagram.com/someone'), {
    handle: 'someone',
    url: 'https://www.instagram.com/someone',
  });
});

test('every spelling of the host is the same site', () => {
  for (const url of [
    'https://instagram.com/someone',
    'https://www.instagram.com/someone',
    'https://instagr.am/someone',
    'instagram.com/someone',
  ]) {
    assert.equal(parseTarget(url).url, 'https://www.instagram.com/someone', url);
  }
});

test('the URL is rebuilt canonically, so one account is never two archives', () => {
  assert.equal(parseTarget('https://www.instagram.com/someone/').url, 'https://www.instagram.com/someone');
  assert.equal(parseTarget('https://www.instagram.com/someone/?hl=en').url, 'https://www.instagram.com/someone');
  assert.equal(parseTarget('https://www.instagram.com/someone/#posts').url, 'https://www.instagram.com/someone');
});

test('a handle is case-folded, because Instagram treats it that way', () => {
  // instagram.com/SomeOne and instagram.com/someone are one account. Two
  // spellings reaching the archive would be two folders for one person.
  assert.equal(parseTarget('https://www.instagram.com/SomeOne').handle, 'someone');
});

test("the reels tab is part of what this archives, so it is the account", () => {
  // Posts and reels are both collected, so somebody who pasted the reels tab
  // pointed at a subset of this account rather than at something else.
  assert.equal(parseTarget('https://www.instagram.com/someone/reels').url, 'https://www.instagram.com/someone');
});

test('a single post is refused rather than read as the account that posted it', () => {
  // The handle-carrying forms are the hazard: `/someone/p/<code>` puts the
  // handle exactly where a profile URL does, so a parser that stopped reading
  // after it would answer "download this post" by archiving a whole account.
  for (const [url, handle] of [
    ['https://www.instagram.com/p/C3xY-_9Ab', null],
    ['https://www.instagram.com/reel/C3xY-_9Ab', null],
    ['https://www.instagram.com/reels/C3xY-_9Ab/', null],
    ['https://www.instagram.com/tv/C3xY-_9Ab', null],
    ['https://www.instagram.com/someone/p/C3xY-_9Ab', 'someone'],
    ['https://www.instagram.com/someone/reel/C3xY-_9Ab/', 'someone'],
  ]) {
    assert.throws(
      () => parseTarget(url),
      (error) => {
        assert.equal(error.code, 'url-single-post', url);
        assert.equal(error.details.shortcode, 'C3xY-_9Ab', url);
        assert.equal(error.details.handle ?? null, handle, url);
        return true;
      },
      url,
    );
  }
});

test('a post URL that names nobody says so rather than inventing an account', () => {
  // `/p/<code>` carries no handle at all. Naming an account here would mean
  // guessing one, so the remedy asks for the profile instead.
  const error = catchRefusal('https://www.instagram.com/p/C3xY-_9Ab');
  assert.equal(error.details.handle, null);
  assert.equal(error.remedy.run_by, 'user');
  assert.match(error.remedy.message, /profile/i);
});

test('a post URL that names its account points at that account', () => {
  const error = catchRefusal('https://www.instagram.com/someone/p/C3xY-_9Ab');
  assert.match(error.remedy.message, /https:\/\/www\.instagram\.com\/someone/);
});

test('stories are refused by name, and are not a single post', () => {
  // Stories vanish in 24 hours, so "a re-run fetches only what is new" cannot
  // hold for them. They are out of scope rather than a post this could fetch.
  const error = catchRefusal('https://www.instagram.com/stories/someone/3298');
  assert.equal(error.code, 'url-out-of-scope');
  assert.match(error.message, /stor/i);
  assert.match(error.remedy.message, /https:\/\/www\.instagram\.com\/someone/);
});

test('a profile tab this does not archive is refused by name', () => {
  for (const [url, section] of [
    ['https://www.instagram.com/someone/tagged', 'tagged'],
    ['https://www.instagram.com/someone/saved', 'saved'],
    ['https://www.instagram.com/someone/followers', 'followers'],
    ['https://www.instagram.com/someone/following', 'following'],
  ]) {
    assert.throws(
      () => parseTarget(url),
      (error) => {
        assert.equal(error.code, 'url-out-of-scope', url);
        assert.equal(error.details.section, section, url);
        return true;
      },
      url,
    );
  }
});

test("Instagram own pages are not handles", () => {
  for (const url of [
    'https://www.instagram.com/explore/tags/cats',
    'https://www.instagram.com/direct/inbox',
    'https://www.instagram.com/accounts/login',
    'https://www.instagram.com/about',
  ]) {
    assert.throws(
      () => parseTarget(url),
      (error) => {
        assert.equal(error.code, 'url-reserved-handle', url);
        return true;
      },
      url,
    );
  }
});

test('a bare instagram.com names no account', () => {
  assert.throws(() => parseTarget('https://www.instagram.com/'), (error) => {
    assert.equal(error.code, 'url-no-account');
    return true;
  });
});

test('something in the handle position that is not a username is refused', () => {
  // Instagram usernames are letters, digits, dots and underscores, up to 30.
  for (const handle of ['some one', 'some%20one', 'a'.repeat(31), 'some-one']) {
    assert.throws(
      () => parseTarget(`https://www.instagram.com/${handle}`),
      (error) => {
        assert.equal(error.code, 'url-not-profile', handle);
        return true;
      },
      handle,
    );
  }
});

test('a non-Instagram URL is refused', () => {
  assert.throws(() => parseTarget('https://example.com/someone'));
  assert.throws(() => parseTarget('https://ddinstagram.com/someone'));
  assert.throws(() => parseTarget(''));
  assert.throws(() => parseTarget(null));
});

test('every refusal names the code SKILL.md branches on, and says what was wrong', () => {
  const expected = {
    'https://example.com': ['url-not-platform', /instagram\.com/],
    'https://www.instagram.com/': ['url-no-account', /names no account/],
    'https://www.instagram.com/explore': ['url-reserved-handle', /explore/],
    'https://www.instagram.com/someone/tagged': ['url-out-of-scope', /tagged/],
  };

  for (const [url, [code, says]] of Object.entries(expected)) {
    assert.throws(
      () => parseTarget(url),
      (error) => {
        assert.equal(error.code, code, url);
        assert.match(error.message, says, url);
        assert.ok(ERROR_EXITS[error.code] !== undefined, `${error.code} has no exit`);
        return true;
      },
      url,
    );
  }
});

test('permalink is the canonical form --go re-fetches by', () => {
  // Handle-free on purpose: Instagram handles are mutable, and a permalink
  // carrying one would stop resolving the day the account is renamed — after
  // the plan was written and before it is fetched.
  assert.equal(permalink('C3xY-_9Ab'), 'https://www.instagram.com/p/C3xY-_9Ab');
});

test('each listing pass has its own URL, because each is its own extractor', () => {
  // Both name the extractor outright. The bare profile URL would reach the
  // posts feed too, but only through the dispatcher's config key — and a URL
  // that says which feed it means cannot disagree with one.
  const profile = 'https://www.instagram.com/someone';
  assert.equal(feedUrl(profile, 'posts'), 'https://www.instagram.com/someone/posts');
  assert.equal(feedUrl(profile, 'reels'), 'https://www.instagram.com/someone/reels');
});

function catchRefusal(url) {
  try {
    parseTarget(url);
  } catch (error) {
    return error;
  }
  return assert.fail(`${url} was not refused`);
}
