/**
 * gallerydl.mjs — the command line every gallery-dl platform builds.
 *
 * Two invocations, one listing and one fetch, and the flags that make a run
 * survivable are the same on both. What differs between platforms is data —
 * the extractor's config keys, its pauses, and the row format it is asked to
 * print — so that arrives as a descriptor and the shape stays here.
 *
 * One copy, because these two invocations are where the guarantees live. No
 * archive is passed to a listing pass, `--config-ignore` is on both, and a
 * fetch names an exact directory rather than a format string; a second copy is
 * a second place for one of those to quietly stop being true.
 *
 * Douyin does not come through here — it drives yt-dlp, which is a different
 * command line entirely.
 */
import { ensureEnv } from './env.mjs';
import { Refusal } from './errors.mjs';
import { toolPath } from './paths.mjs';
import { labelFor } from './platforms.mjs';
import { cookieArgs } from './session.mjs';
import { hatchToolMissing, onPath } from './tools.mjs';

/** Config keys as gallery-dl parses them: `-o key=<json>`. */
export function optionArgs(options) {
  return Object.entries(options).flatMap(([key, value]) => ['-o', `${key}=${JSON.stringify(value)}`]);
}

/**
 * The listing pass: enumerate, print a row per file, download nothing.
 *
 * No archive is passed. gallery-dl's own skip-and-abort machinery does not run
 * in a listing pass anyway, and a platform needs to see every post to report
 * both "found" and "on disk" honestly — a pass that only showed new posts could
 * not tell the user what fraction of the account they already have. The diff
 * and the decision to stop early belong to the platform's own `collect.mjs`.
 */
export function listArgs({ policy, throttle, printFormat }, { url, cookies }) {
  return [
    '--config-ignore',
    ...cookieArgs({ cookies }),
    ...optionArgs(policy),
    ...throttle,
    '--print',
    printFormat,
    url,
  ];
}

/**
 * One post, into a folder the archive has already named.
 *
 * `--directory` is an exact path, which is what lets `naming.mjs` own the
 * layout rather than it being re-expressed as a gallery-dl format string — the
 * naming rules are ours, they are unit-tested, and they are not re-implemented
 * in a config file.
 */
export function fetchArgs({ policy, throttle }, { url, directory, cookies }) {
  return [
    '--config-ignore',
    ...cookieArgs({ cookies }),
    ...optionArgs(policy),
    ...throttle,
    '--directory',
    directory,
    '--filename',
    '{num}.{extension}',
    url,
  ];
}

/**
 * What a failed listing pass was, as the refusal the run answers with.
 *
 * The classifier's table is the platform's, because the two extractors fail in
 * partly different ways; what to do with a classification is not.
 */
export function collectRefusal(failures, failure, stderr) {
  const known = failures[failure];
  return new Refusal(failure, known?.message ?? `the listing pass failed: ${failure}`, {
    // Carried only where nothing has classified the failure. The tail is the
    // last of gallery-dl's own words, which is all that is left to go on when
    // the classifier recognised nothing.
    details:
      failure === 'collect-failed'
        ? { stderr_tail: stderr?.trim().split('\n').slice(-8).join('\n') ?? '' }
        : null,
    remedy: known?.remedy ?? null,
  });
}

/**
 * The adapter members every gallery-dl platform answers the same way.
 *
 * Spread into a platform's own adapter, which then names what is its alone: the
 * usage prose, the listing pass, the counts, and the wording of the refusals
 * only it can phrase. A rule that drifted between two copies of these would
 * mean one platform quietly building a box the other does not, or reading a
 * session the other would have refused.
 */
export function galleryDlAdapter({ platform, failures }) {
  return {
    // What a session refusal calls this site, and what the cookie cache is
    // keyed by. Named apart from the `session` member because that one is the
    // step, and a key serving as both would be silently overwritten by whichever
    // the platform's own literal spelled last.
    site: { platform, label: labelFor(platform) },
    failures,
    // Nothing here drives a page, so nobody downloads Chromium for a gallery-dl
    // platform.
    boxes: () => ['runtime', 'tools'],
    ensureEnv,
    onPath,
    // Answers only under the escape hatch, where the machine's own gallery-dl
    // is being used and can simply not be there. Off it the box holds
    // gallery-dl, and a box that could not be built has already refused.
    preflight: (adapter) =>
      hatchToolMissing(
        toolPath('gallery-dl'),
        { install: 'uv tool install gallery-dl', docs: 'https://github.com/mikf/gallery-dl#installation' },
        adapter.onPath,
      ),
    // The whole listing result rather than its stderr: a classifier may need
    // what else the pass saw to tell two failures apart.
    collectRefusal: (failure, result) => collectRefusal(failures, failure, result?.stderr),
  };
}
