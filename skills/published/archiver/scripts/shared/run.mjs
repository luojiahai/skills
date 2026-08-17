/**
 * run.mjs — the handful of decisions every platform's run makes identically.
 *
 * Not the run itself: each platform keeps its own `main(argv)`, because listing
 * a Douyin profile and listing an X timeline have almost nothing in common. What
 * is here is what would otherwise be copied verbatim into both — and a mode rule
 * that drifted between platforms would mean `--yes` meaning two things.
 */
import { EXIT } from './exit.mjs';

/**
 * `--yes` outranks a `--plan` or `--go` after it on the command line.
 *
 * The skill never reaches for `--yes`; a user who typed it has pre-authorised
 * the run, and the skill appending its own mode flag afterwards must not take
 * that back. Last-one-wins would do exactly that.
 */
export function pickMode(opts) {
  if (opts.yes === true || opts.y === true) return 'yes';
  if (opts.go === true) return 'go';
  return 'plan';
}

/** A refusal, said once and in one voice, with the code that goes with it. */
export function fail(message, code = EXIT.FAILED) {
  console.error(`error: ${message}`);
  return code;
}

/** The entry point as the user can type it, for a remedy they can run. */
export function self() {
  return process.env.ARCHIVE_SELF || 'archive.sh';
}
