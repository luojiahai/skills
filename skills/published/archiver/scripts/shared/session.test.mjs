import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { BROWSERS, cookieArgs, cookieExportArgs, discardCookies, ensureCookies } from './session.mjs';
import { cookieFile, stateDir } from './paths.mjs';

const DESCRIPTOR = { platform: 'x', label: 'X, formerly Twitter' };

/**
 * A state root of this test's own, because the module writes a real file. Set
 * on the environment rather than injected: `paths.mjs` reads it per call, which
 * is the seam the whole skill already uses to keep state out of the skill dir.
 */
async function isolated(run) {
  const previous = process.env.XDG_STATE_HOME;
  process.env.XDG_STATE_HOME = await mkdtemp(path.join(os.tmpdir(), 'session-'));
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = previous;
  }
}

/** A gallery-dl that exits with `code`, writing `wrote` to the export path. */
function fakeExport(code, wrote = 'cookie data') {
  return (_bin, args) => {
    const child = new EventEmitter();
    const target = args[args.indexOf('--cookies-export') + 1];
    queueMicrotask(async () => {
      if (wrote !== null) await writeFile(target, wrote);
      child.emit('close', code);
    });
    return child;
  };
}

test('a run always reads its session from a file, never the live browser', () => {
  assert.deepEqual(cookieArgs({ cookies: '/c.txt' }), ['--cookies', '/c.txt']);
  assert.deepEqual(cookieArgs({}), []);
});

test('the export reads the browser once and writes what it found', () => {
  const args = cookieExportArgs({ browser: 'chrome', cookies: '/c.txt', url: 'https://x.com/jack' });
  assert.ok(args.includes('--config-ignore'));
  assert.deepEqual(args.slice(args.indexOf('--cookies-from-browser'), args.indexOf('--cookies-from-browser') + 2), [
    '--cookies-from-browser',
    'chrome',
  ]);
  assert.ok(args.includes('--cookies-export'));
  assert.ok(args.includes('/c.txt'));
  // It must download nothing: this invocation exists to mint a session.
  assert.ok(args.includes('--simulate'));
  assert.equal(args.at(-1), 'https://x.com/jack');
});

test('an explicit cookies file is used as given and nothing is minted', async () => {
  await isolated(async () => {
    const spawnImpl = () => assert.fail('the browser must not be read when a file was named');
    assert.equal(
      await ensureCookies(DESCRIPTOR, { cookies: '/given.txt', url: 'https://x.com/jack', spawnImpl }),
      '/given.txt',
    );
  });
});

test('a cached session is preferred to reading the browser again', async () => {
  await isolated(async () => {
    const file = cookieFile('x');
    await mkdir(stateDir('x'), { recursive: true });
    await writeFile(file, 'cached');

    const spawnImpl = () => assert.fail('a cached session must not prompt for Keychain access again');
    assert.equal(await ensureCookies(DESCRIPTOR, { url: 'https://x.com/jack', spawnImpl }), file);
  });
});

test('with no cache and no browser named, the refusal is the user to act on', async () => {
  await isolated(async () => {
    await assert.rejects(
      () => ensureCookies(DESCRIPTOR, { url: 'https://x.com/jack', spawnImpl: () => assert.fail('no spawn') }),
      (error) => {
        assert.equal(error.code, 'no-session-source');
        // The label rather than a hardcoded platform: one module, two platforms.
        assert.match(error.message, /X, formerly Twitter/);
        assert.deepEqual(error.details.browsers, BROWSERS);
        assert.equal(error.remedy.run_by, 'user');
        return true;
      },
    );
  });
});

test('a browser that could not be read is refused, naming the browser', async () => {
  await isolated(async () => {
    await assert.rejects(
      () =>
        ensureCookies(DESCRIPTOR, {
          browser: 'chrome',
          url: 'https://x.com/jack',
          spawnImpl: fakeExport(1, null),
        }),
      (error) => {
        assert.equal(error.code, 'session-unreadable');
        assert.equal(error.details.browser, 'chrome');
        assert.match(error.remedy.message, /chrome/);
        return true;
      },
    );
  });
});

test('a minted session is readable by nobody else on the machine', async () => {
  await isolated(async () => {
    const file = await ensureCookies(DESCRIPTOR, {
      browser: 'chrome',
      url: 'https://x.com/jack',
      spawnImpl: fakeExport(0),
    });

    assert.equal(file, cookieFile('x'));
    assert.equal(await readFile(file, 'utf8'), 'cookie data');
    // A live session token in a world-readable file is the thing this prevents.
    assert.equal((await stat(file)).mode & 0o077, 0);
    assert.equal((await stat(stateDir('x'))).mode & 0o077, 0);
  });
});

test('each platform caches its session under its own name', async () => {
  await isolated(async () => {
    await ensureCookies(
      { platform: 'instagram', label: 'Instagram' },
      { browser: 'chrome', url: 'https://www.instagram.com/someone', spawnImpl: fakeExport(0) },
    );

    assert.equal(await readFile(cookieFile('instagram'), 'utf8'), 'cookie data');
    // X's session is somewhere else entirely, so one platform rejecting a
    // session can never discard the other's.
    await assert.rejects(() => readFile(cookieFile('x'), 'utf8'));
  });
});

test('discarding one platform session leaves the other alone', async () => {
  await isolated(async () => {
    for (const platform of ['x', 'instagram']) {
      await ensureCookies(
        { platform, label: platform },
        { browser: 'chrome', url: 'https://example.com', spawnImpl: fakeExport(0) },
      );
    }

    await discardCookies('x');
    await assert.rejects(() => readFile(cookieFile('x'), 'utf8'));
    assert.equal(await readFile(cookieFile('instagram'), 'utf8'), 'cookie data');
  });
});

test('discarding a session that is not there is not a failure', async () => {
  await isolated(async () => {
    await discardCookies('x');
  });
});
