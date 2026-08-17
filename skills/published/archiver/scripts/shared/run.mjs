/**
 * run.mjs — the handful of decisions every platform's run makes identically.
 *
 * Not the run itself: each platform keeps its own `main(argv)`, because listing
 * a Douyin profile and listing an X timeline have almost nothing in common. What
 * is here is what would otherwise be copied verbatim into both — and a mode rule
 * that drifted between platforms would mean `--yes` meaning two things.
 *
 * A refusal is not here: it goes through `output.mjs`, which owns the envelope
 * every command answers in.
 */
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
