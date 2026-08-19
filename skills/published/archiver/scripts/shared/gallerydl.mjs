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
import { cookieArgs } from './session.mjs';

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
