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
import { planUnfinished } from './plan.mjs';
import { loadPlan } from './sync.mjs';

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

/**
 * Whether a re-run may stop once it has recognised enough posts, rather than
 * sweeping the whole account.
 *
 * Three conditions, and the platforms that stop early must answer them the same
 * way: a first run has nothing to recognise, `--full` was asked for the whole
 * account outright, and a plan still parked with posts missing from it is a
 * download that never finished — so the archive may have holes below its newest
 * posts, and a streak of familiar ones at the top proves nothing about what is
 * under them. `planUnfinished` is where that last one is argued.
 *
 * Douyin does not call this, because Douyin never stops early; its README says
 * why, and the rule waiting here is what a stopper there would need first.
 *
 * The plan is read last and only when the answer still hangs on it, so a first
 * run and a `--full` cost no extra read.
 */
export async function sweepIsIncremental({ accountDir, accountId, archive, full, postIdKey, root }) {
  if (archive.size === 0 || full) return false;
  return !planUnfinished(await loadPlan(accountDir), { accountId, root, archive, postIdKey });
}
