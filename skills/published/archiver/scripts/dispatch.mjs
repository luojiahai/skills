/**
 * dispatch.mjs — read the URL, pick the platform, hand over the whole command line.
 *
 * This is the only thing in the skill that knows more than one platform exists.
 * It resolves one and calls its `main(argv)` in the same process, so exit codes
 * and output need no plumbing and a platform owns its whole command line.
 *
 * **Anything bound for a platform passes through untouched.** When a URL names
 * one, not a single argument is read here: an unknown flag is that platform's
 * usage error rather than a guess made up in this file, which is what lets a
 * platform add a flag without this file changing.
 *
 * What is parsed here is only what no platform will ever see — `--list` and the
 * `--archives` it takes, and `--help` when there is no platform to answer it.
 * `--list` is the one command that belongs to no platform, because "which
 * accounts are archived" is a question about the root that both of them share.
 */
import { detect, platformHelp, supported } from './shared/platforms.mjs';
import { EXIT } from './shared/exit.mjs';
import { isMainModule, optString, parseCommandLine } from './shared/cli.mjs';
import { listArchive } from './shared/listing.mjs';
import { archivesRoot, normalizeRoot } from './shared/paths.mjs';
import { fail } from './shared/run.mjs';

const SELF = process.env.ARCHIVE_SELF || 'archive.sh';

const USAGE = `Usage: ${SELF} <url> [--archives DIR] [--alias NAME] [--plan|--go|--yes]
       ${SELF} --list [--archives DIR]

The URL says which platform this is. ${supported()}.

  Common to every platform
      --plan            Report what would be fetched, and stop. Downloads nothing.
      --go              Download the posts the last --plan listed. Needs a plan
                        for this account and root, under a day old.
      --yes, -y         Plan and download in one run, without stopping.
      --archives DIR    Root the archives live in. DIR/<platform>/<account>.
      --alias NAME      Name this account's folder NAME instead of its id.
      --unalias         Put this account's folder back under its id.
      --list            Report the accounts already archived under the root as
                        JSON, and stop. Takes no URL, downloads nothing, and
                        needs no downloader installed.
  -h, --help            Show this help. With a URL, the platform's own help.

${platformHelp()}`;

/** `--list` answers about the root, so the only other flag it can mean is --archives. */
const LIST_BOOLEANS = new Set(['list']);
const LIST_FLAGS = new Set(['list', 'archives']);

/** Asking what a command does is answerable whatever else is on the line. */
const wantsHelp = (argv) => argv.includes('-h') || argv.includes('--help');

/**
 * The accounts already archived under one root.
 *
 * Answered here rather than by a platform because it is about the root the
 * platforms share, and answered *before* one is loaded so it still works on a
 * machine with no yt-dlp, no gallery-dl and no session. Reading the tree is not
 * archiving.
 *
 * Every other flag is refused rather than ignored. `--list` and `--plan` ask for
 * different things, and letting one quietly win is how somebody who asked to
 * archive an account ends up looking at a listing instead.
 */
async function runListing(argv, platform) {
  const { opts, positional, unknown } = parseCommandLine(argv, {
    booleans: LIST_BOOLEANS,
    known: LIST_FLAGS,
  });

  if (platform) {
    return fail('a URL asks about one account, and --list asks which accounts are archived', EXIT.USAGE);
  }
  if (unknown.length) return fail(`--list takes only --archives DIR, not ${unknown[0]}`, EXIT.USAGE);
  if (positional.length) {
    return fail(`--list takes only --archives DIR, not ${JSON.stringify(positional[0])}`, EXIT.USAGE);
  }

  const given = optString(opts, 'archives');
  try {
    // JSON, because its reader is the skill rather than a person.
    console.log(JSON.stringify(await listArchive(given ? normalizeRoot(given) : archivesRoot()), null, 2));
    return EXIT.OK;
  } catch (error) {
    // An archives root this build cannot read, and a working directory inside
    // the skill, are both answerable before anything is enumerated — which is
    // what EXIT.USAGE means.
    return fail(error.message, EXIT.USAGE);
  }
}

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

  const wantsListing = argv.includes('--list');

  // Nothing below will answer a --help: --list never reaches a platform, and
  // without a URL there is no platform to reach. It also comes before the
  // refusals, because someone who ran this with no arguments is asking what it
  // does, and being told their absent URL is unsupported answers a question
  // they did not ask.
  if (wantsHelp(argv) && (wantsListing || !platform)) {
    console.log(USAGE);
    return EXIT.OK;
  }

  // Before the platform is loaded, and before the no-URL refusal below: --list
  // is the one command that wants neither.
  if (wantsListing) return await runListing(argv, platform);

  if (!platform) {
    // Asked for, the usage is output and goes to stdout; arrived at by typing
    // nothing, it is a usage error and goes to stderr. Printing a usage error to
    // stdout would put it in the pipe of anything reading this command.
    if (argv.length === 0) {
      console.error(USAGE);
      return EXIT.USAGE;
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

if (isMainModule(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
