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
import { isLanded } from './landed.mjs';
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
 * The plan is read last and only when the answer still hangs on it, so a first
 * run and a `--full` cost no extra read.
 */
export async function sweepIsIncremental({ accountDir, accountId, archive, full, postIdKey, root }) {
  if (archive.size === 0 || full) return false;
  return !planUnfinished(await loadPlan(accountDir), { accountId, root, archive, postIdKey });
}

/**
 * The stopping rule: N consecutive posts, in enumeration order, already complete.
 *
 * "Complete" is landed.mjs's one definition, so a post whose media is half here
 * breaks the streak rather than counting toward it — which is what stops a sweep
 * retiring early over posts it would then have had to fetch anyway.
 *
 * Takes a post id, because that is the one thing the three platforms' listing
 * passes hold in common: each spells it differently on its own rows, and each
 * reads its own key on the way in. The threshold is the platform's, defended by
 * its own test against its own reordering.
 */
export function makeStopper({ archive, threshold, enabled }) {
  let consecutive = 0;
  return (postId) => {
    if (!enabled) return false;
    if (isLanded(archive.get(postId))) {
      consecutive += 1;
      return consecutive >= threshold;
    }
    consecutive = 0;
    return false;
  };
}

/**
 * How a run says which of the two it did, so `to_fetch: 0` can be told apart
 * from "gave up before reaching anything new".
 *
 * `stopped_early` is only ever true of an incremental sweep: a full one has
 * nothing to stop early against, and reporting one as having stopped would cast
 * doubt on a listing that is complete.
 *
 * `category` names which listing pass the note is about, and is left off where a
 * platform sweeps a single feed.
 */
export function sweepNote({ incremental, stoppedEarly, threshold, category }) {
  return {
    code: 'sweep',
    mode: incremental ? 'incremental' : 'full',
    stopped_early: Boolean(incremental && stoppedEarly),
    threshold: incremental ? threshold : null,
    ...(category === undefined ? {} : { category }),
  };
}

/** Whether the sweep behind a parked plan stopped early, read back off its notes. */
export function sweepStoppedEarly(notes) {
  return (notes ?? []).some((note) => note.code === 'sweep' && note.stopped_early);
}

/**
 * A platform's adapter with a caller's substitutions laid over it.
 *
 * A member left `undefined` is absent rather than overridden. A test bench
 * builds one bag of fakes for every case in a file and names the member it
 * wants back off; a plain spread would hand the run an `undefined` and fail it
 * somewhere far from the line that asked for the real one.
 *
 * Nothing here knows which members carry behaviour, so a threshold is
 * substituted through the same door as a listing pass.
 */
export function adapterFor(adapter, overrides = {}) {
  const merged = { ...adapter };
  for (const [member, value] of Object.entries(overrides)) {
    if (value !== undefined) merged[member] = value;
  }
  return merged;
}
