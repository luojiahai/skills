/**
 * dispatch.mjs — read the URL, pick the platform, hand over the whole command line.
 *
 * This is the only thing in the skill that knows more than one platform exists.
 * It resolves one and calls its `main(argv)` in the same process, so exit codes
 * and output need no plumbing and a platform is reached exactly as it would be
 * if it were still a skill of its own.
 *
 * It does not parse flags. Everything after the URL is the platform's own, and
 * an unknown one is the platform's usage error rather than a guess made up here —
 * which also means a platform can add a flag without this file changing.
 */
import { pathToFileURL } from 'node:url';

import { detect, supported } from './shared/platforms.mjs';
import { EXIT } from './shared/exit.mjs';

const SELF = process.env.ARCHIVE_SELF || 'archive.sh';

const USAGE = `Usage: ${SELF} <url> [--archives DIR] [--alias NAME] [--plan|--go|--yes]

The URL says which platform this is. ${supported()}.

  Common to every platform
      --plan            Report what would be fetched, and stop. Downloads nothing.
      --go              Download the posts the last --plan listed. Needs a plan
                        for this account and root, under a day old.
      --yes, -y         Plan and download in one run, without stopping.
      --archives DIR    Root the archives live in. DIR/<platform>/<account>.
      --alias NAME      Name this account's folder NAME instead of its id.
      --unalias         Put this account's folder back under its id.
  -h, --help            Show this help. With a URL, the platform's own help.

  Douyin — douyin.com/user/<sec_uid>
      --profile DIR     Browser profile holding the Douyin session.

  X — x.com/<handle>
      --browser NAME    Browser to read the X session from the first time
                        (chrome, firefox, safari, edge, brave, chromium...).
      --cookies FILE    Use this cookies.txt instead of a browser or the cache.
      --full            Enumerate the whole timeline even when a re-run could
                        stop early.`;

/**
 * `load` is injected so the dispatcher's own behaviour — what it does with a URL
 * it cannot place, and with two — is testable without a platform's dependencies
 * being installed.
 */
export async function main(argv, { load = loadPlatform } = {}) {
  let platform;
  try {
    platform = detect(argv);
  } catch (error) {
    console.error(`error: ${error.message}`);
    return EXIT.USAGE;
  }

  if (!platform) {
    // --help before the refusal: someone who ran this with no arguments is
    // asking what it does, and being told their absent URL is unsupported
    // answers a question they did not ask.
    if (argv.length === 0 || argv.includes('-h') || argv.includes('--help')) {
      console.log(USAGE);
      return argv.length === 0 ? EXIT.USAGE : EXIT.OK;
    }
    console.error('error: no URL here names a platform this skill archives');
    console.error(`  it archives ${supported()}`);
    return EXIT.USAGE;
  }

  const { main: run } = await load(platform);
  return await run(argv);
}

function loadPlatform(platform) {
  return import(`./${platform.dir}/run.mjs`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
