import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';

import { login } from './login.mjs';

/** A browser whose cookie jar is whatever the script says on each poll. */
function fakeBrowser(jars) {
  let poll = 0;
  const state = { closed: false, headless: null, visited: null };
  const launchPersistentContext = async (dir, opts) => {
    state.headless = opts.headless;
    return {
      pages: () => [
        { goto: async (url) => { state.visited = url; } },
      ],
      cookies: async () => jars[Math.min(poll++, jars.length - 1)],
      close: async () => { state.closed = true; },
    };
  };
  return { launch: { launchPersistentContext }, state };
}

const SESSION = [{ domain: '.douyin.com', name: 'sessionid', value: 'abc' }];
const ANONYMOUS = [{ domain: '.douyin.com', name: 'ttwid', value: 'xyz' }];

const silent = () => {};
const noKeys = () => Readable.from([]);

test('the session appearing is what ends the wait', async () => {
  // Not a keypress. The whole point of decoupling is that the skill observes
  // the session rather than trusting somebody to assert it.
  const { launch, state } = fakeBrowser([ANONYMOUS, ANONYMOUS, SESSION]);
  const result = await login({
    url: 'https://www.douyin.com/user/MS4w',
    profileDir: '/tmp/profile',
    launch,
    log: silent,
    pollMs: 1,
    input: noKeys(),
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(state.visited, 'https://www.douyin.com/user/MS4w');
  assert.equal(state.closed, true, 'the browser is closed either way');
});

test('the browser is visible, because a human has to use it', async () => {
  const { launch, state } = fakeBrowser([SESSION]);
  await login({ url: 'u', profileDir: '/p', launch, log: silent, pollMs: 1, input: noKeys() });
  assert.equal(state.headless, false);
});

test('giving up is reported as not signed in, not as success', async () => {
  // Enter ends the wait; it does not decide the outcome. A run that reported
  // success here would send the user straight into a collection that finds zero
  // posts and blames an expired session.
  const { launch } = fakeBrowser([ANONYMOUS]);
  const result = await login({
    url: 'u',
    profileDir: '/p',
    launch,
    log: silent,
    pollMs: 1,
    input: Readable.from(['\n']),
  });

  assert.equal(result.ok, false);
  assert.match(result.reason, /no Douyin session/);
});

test('a sign-in that never comes times out rather than waiting forever', async () => {
  const { launch, state } = fakeBrowser([ANONYMOUS]);
  const result = await login({
    url: 'u',
    profileDir: '/p',
    launch,
    log: silent,
    pollMs: 1,
    timeoutMs: 5,
    input: noKeys(),
  });

  assert.equal(result.ok, false);
  assert.match(result.reason, /gave up waiting/);
  assert.equal(state.closed, true);
});

test('an already-signed-in profile finishes immediately', async () => {
  const { launch } = fakeBrowser([SESSION]);
  assert.deepEqual(
    await login({ url: 'u', profileDir: '/p', launch, log: silent, pollMs: 1000, input: noKeys() }),
    { ok: true },
  );
});
