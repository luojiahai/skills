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
 *
 * It is also where an uncaught exception stops. A command the skill invokes must
 * never leave stdout empty: from the agent's side that is indistinguishable from
 * a command with nothing to say, and the case where it knows least is the one
 * case that must still produce a document.
 */
import { detect, platformHelp, supported, supportedPlatforms } from './shared/platforms.mjs';
import { EXIT } from './shared/exit.mjs';
import { isMainModule, missingValueRefusal, optString, parseCommandLine } from './shared/cli.mjs';
import { listArchive } from './shared/listing.mjs';
import { archivesRoot, normalizeRoot } from './shared/paths.mjs';
import { refusalFields } from './shared/errors.mjs';
import { answer, refuse } from './shared/output.mjs';

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
      --list            Report the accounts already archived under the root, and
                        stop. Takes no URL, downloads nothing, and needs no
                        downloader installed.
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
 * Its account entries are reported exactly as `listing.mjs` composes them. They
 * answer a different question from a run's counts and have no counterpart there,
 * so reshaping them to match would cost a rewrite of the largest section of
 * `SKILL.md` to buy a symmetry nothing consumes.
 *
 * Every other flag is refused rather than ignored. `--list` and `--plan` ask for
 * different things, and letting one quietly win is how somebody who asked to
 * archive an account ends up looking at a listing instead.
 */
async function runListing(argv, platform) {
  const { opts, positional, unknown, missing } = parseCommandLine(argv, {
    booleans: LIST_BOOLEANS,
    known: LIST_FLAGS,
  });

  if (platform) {
    return refuse({
      command: 'list',
      code: 'list-with-url',
      message: 'a URL asks about one account, and --list asks which accounts are archived',
    });
  }
  if (unknown.length) {
    return refuse({
      command: 'list',
      code: 'list-unknown-flag',
      message: `--list takes only --archives DIR, not ${unknown[0]}`,
      details: { flag: unknown[0] },
    });
  }
  if (positional.length) {
    return refuse({
      command: 'list',
      code: 'list-unexpected-argument',
      message: `--list takes only --archives DIR, not ${JSON.stringify(positional[0])}`,
      details: { argument: positional[0] },
    });
  }
  if (missing.length) {
    return refuse({ command: 'list', ...refusalFields(missingValueRefusal(missing[0])) });
  }

  const given = optString(opts, 'archives');
  try {
    return answer({
      command: 'list',
      result: await listArchive(given ? normalizeRoot(given) : archivesRoot()),
    });
  } catch (error) {
    // An archives root this build cannot read, and a working directory inside
    // the skill, are both answerable before anything is enumerated.
    return refuse({ command: 'list', ...refusalFields(error) });
  }
}

/**
 * `load` is injected so the dispatcher's own behaviour — what it does with a URL
 * it cannot place, and with two — is testable without a platform's dependencies
 * being installed.
 */
export async function main(argv, { load = loadPlatform } = {}) {
  try {
    return await dispatch(argv, load);
  } catch (error) {
    // Everything below is expected to answer for itself, so reaching here is a
    // bug rather than a refusal — and a bug the agent still has to be able to
    // report. The stack goes in the document because nobody can act on this
    // without it.
    return refuse({
      code: 'internal-error',
      message: `the archiver crashed: ${error?.message ?? error}`,
      details: { stack: String(error?.stack ?? error) },
    });
  }
}

async function dispatch(argv, load) {
  let platform;
  try {
    platform = detect(argv);
  } catch (error) {
    return refuse(refusalFields(error));
  }

  const wantsListing = argv.includes('--list');

  // Nothing below will answer a --help: --list never reaches a platform, and
  // without a URL there is no platform to reach. It also comes before the
  // refusals, because someone who ran this with no arguments is asking what it
  // does, and being told their absent URL is unsupported answers a question
  // they did not ask.
  //
  // The help is the one documented exception to the one-document rule: it is
  // prose, on stdout, for a person typing this by hand.
  if (wantsHelp(argv) && (wantsListing || !platform)) {
    console.log(USAGE);
    return EXIT.OK;
  }

  // Before the platform is loaded, and before the no-URL refusal below: --list
  // is the one command that wants neither.
  if (wantsListing) return await runListing(argv, platform);

  if (!platform) {
    if (argv.length === 0) {
      // The usage goes to stderr rather than stdout, because stdout carries the
      // document and nothing else. Somebody who typed nothing still gets the
      // prose; whoever is parsing this still gets one parseable stream.
      console.error(USAGE);
      return refuse({ code: 'no-arguments', message: 'no arguments given' });
    }
    return refuse({
      code: 'unsupported-platform',
      message: 'no URL here names a platform this skill archives',
      details: { supported: supportedPlatforms() },
    });
  }

  const { main: run } = await load(platform);
  return await run(argv);
}

/**
 * Where a platform's entry module is, composed in this one place.
 *
 * The registry names a bare folder and nothing more; the path it sits at is
 * known here alone. Exported so that the test asserting every registered
 * platform is reachable resolves it through the call the dispatcher makes — a
 * test composing the path itself would be a second copy of the one rule that
 * keeps this file the only thing that knows the layout.
 */
export function loadPlatform(platform) {
  return import(`./${platform.dir}/run.mjs`);
}

if (isMainModule(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
