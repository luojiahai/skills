/**
 * output.mjs — the one document every command answers with.
 *
 * Stdout carries exactly one JSON document and nothing else. Its reader is
 * `SKILL.md` rather than a person: the skill words the outcome for somebody who
 * typed `/archiver`, has never seen this command line, and may not be reading in
 * English — so what leaves here is facts, and the sentences are written there.
 *
 * ```json
 * { "schema": 1, "ok": true, "command": "plan", "platform": "x",
 *   "exit": 0, "result": { … }, "error": { … } }
 * ```
 *
 * - `command` is what the line asked for, and `null` — with `platform` null too
 *   — only where nothing was dispatched: a bare invocation, a URL naming no
 *   supported platform, two platforms at once.
 * - `exit` repeats the process exit code, because output is captured and read
 *   away from the process that produced it.
 * - `error` is present exactly when `ok` is false. `result` is present whenever
 *   the run got far enough to have one, **independently of `ok`**: a `--go` that
 *   rate-limits mid-download carries both, and collapsing it either way loses
 *   something the user needs.
 *
 * `ok` answers "was this run refused or stopped", which is not the same question
 * as "did the exit code say zero". A Douyin `--go` that lost three posts to the
 * downloader finished as asked and still exits `FAILED`, because shell callers
 * read a lost post as a non-zero exit — so it is `ok` with a non-zero `exit`,
 * and the posts it lost are in `result.run.failed`.
 *
 * **`error.message` is a fallback, not a user-facing string.** The agent branches
 * on `error.code` and words the outcome itself. The message exists so a refusal
 * added to these scripts after `SKILL.md` was written degrades to something
 * sayable rather than to silence, and it is reworded before it reaches anybody.
 *
 * **One module owns this.** The document a user approves and the document a
 * finished run reports have to agree — same counts, same rule for what is on
 * disk — and they only reliably agree by being the same code. The same holds
 * across platforms sharing one archives root: letting each assemble its own
 * object is the drift that ends with two platforms describing one run
 * differently.
 */
import { EXIT } from './exit.mjs';
import { exitFor } from './errors.mjs';

/**
 * The version of this output contract, starting at 1.
 *
 * Unrelated to `archiver.json`'s on-disk schema: the two documents are never in
 * one reader's hands at once.
 */
export const OUTPUT_SCHEMA = 1;

/** The entry point as the user can type it, for a remedy or a next step. */
export function self() {
  return process.env.ARCHIVE_SELF || 'archive.sh';
}

const integer = (value) => Math.trunc(Number(value) || 0);

/** The envelope, with `result` and `error` present only when there is one. */
function document({ command = null, platform = null, exit, result = null, error = null }) {
  const doc = { schema: OUTPUT_SCHEMA, ok: !error, command, platform, exit };
  if (result) doc.result = result;
  if (error) doc.error = error;
  return doc;
}

/** The document on stdout, and the exit code that goes with it. */
function emit(doc) {
  console.log(JSON.stringify(doc, null, 2));
  return doc.exit;
}

/** A command that did what it was asked. */
export function answer({ command = null, platform = null, result = null, exit = EXIT.OK }) {
  return emit(document({ command, platform, exit, result }));
}

/**
 * A refusal: a stable code, the facts behind it, and — where one exists — a
 * remedy saying whose it is to run.
 *
 * `result` is passed when the run got somewhere before it stopped. A rate-limited
 * download that fetched two hundred posts is neither a success nor a nothing.
 */
export function refuse({
  command = null,
  platform = null,
  code,
  message,
  details = null,
  remedy = null,
  result = null,
  exit = exitFor(code),
}) {
  const error = { code, message };
  if (details) error.details = details;
  if (remedy) error.remedy = remedy;
  return emit(document({ command, platform, exit, result, error }));
}

/** Progress lines, on stderr, so they never land in the middle of the document. */
export function progress(message, { progress: inPlace = false } = {}) {
  // In-place rewriting exists to show a human that a long run is still going.
  // Off a terminal there is nobody watching, and a thousand-post download would
  // fill the reader's context with a counter.
  if (inPlace) {
    if (process.stderr.isTTY) process.stderr.write(`\r${message}`);
    return;
  }
  process.stderr.write(`${message}\n`);
}

/** Shell-quoted, so a path with a space or an apostrophe survives being read back. */
export function quote(argument) {
  const value = String(argument);
  return /^[A-Za-z0-9._:/=-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * The invocation that follows this one, with the user's own flags carried
 * through.
 *
 * Rebuilt from the command line as given rather than from what the run parsed
 * out of it, so nothing the user chose — the archives root above all — can be
 * silently dropped on the way to the next step. Only the mode flag is replaced,
 * because that is the only thing that differs between the two halves of a run.
 */
const MODE_FLAGS = new Set(['--plan', '--go', '--yes', '-y']);

export function commandFor(argv, mode) {
  const kept = argv.filter((argument) => !MODE_FLAGS.has(argument));
  return [self(), ...kept, `--${mode}`].map(quote).join(' ');
}

/**
 * The account's identity, as fields, so it can be named the way the user's
 * language names people. Threaded with the same descriptor `account.mjs` takes,
 * so the readable handle is `handle` on X and `douyin_id` on Douyin without this
 * file knowing either.
 */
export function accountFields(descriptor, account, url = null) {
  return {
    id: account?.id ?? null,
    [descriptor.handleKey]: account?.[descriptor.handleKey] ?? null,
    nickname: account?.nickname ?? null,
    url: url ?? null,
  };
}

/**
 * The three counts every run has, as raw integers, plus whatever only one
 * platform knows.
 *
 * Platform numbers nest inside `counts` because they are counts — which leaves
 * `details` meaning one thing only: the facts behind a refusal.
 *
 * There is no `up_to_date` beside `to_fetch`. Two fields that can disagree is
 * how a run gets reported as up to date while a plan sits waiting.
 */
export function archiveCounts({ found, onDisk, toFetch, platform = {} }) {
  return {
    found: integer(found),
    on_disk: integer(onDisk),
    to_fetch: integer(toFetch),
    platform,
  };
}

/** What a finished download delivered. */
export function runCounts({ downloaded, total, failed, remaining }) {
  return {
    downloaded: integer(downloaded),
    total: integer(total),
    failed: integer(failed),
    remaining: integer(remaining),
  };
}

/**
 * The payload `--plan`, `--go` and `--yes` share, with the parts only some of
 * them have added when they are there.
 *
 * The rules that decide *whether* a part is there live here rather than in each
 * platform's run, because they are the rules the two must agree on. A platform
 * hands over facts — `nextFor` is the command line as typed, and whether a next
 * step exists is settled from the counts.
 */
export function archiveResult({
  account, dir, root, counts, notes = [], plan = null, nextFor = null, run = null,
}) {
  const payload = { account, dir, root, counts, notes };
  if (plan) payload.plan = plan;
  // `to_fetch: 0` is the whole of "already up to date", so a next step beside it
  // would be a second field saying otherwise.
  if (nextFor && counts.to_fetch > 0) payload.next = nextStep(nextFor);
  if (run) payload.run = run;
  return payload;
}

/**
 * The notes both platforms work out the same way, ahead of the ones only one of
 * them has. A rename and a moved archives root are facts about the run rather
 * than about the site it read.
 */
export function sharedNotes({ dir, movingTo = null, root, previousRoot = null }) {
  return [
    ...(movingTo && movingTo !== dir ? [movingToNote(movingTo)] : []),
    ...(previousRoot && previousRoot !== root ? [rootChangedNote(previousRoot)] : []),
  ];
}

/**
 * What a run that downloaded nothing delivered: the archive as it already stood.
 * A `--yes` against an account with nothing new still ran, and still reports.
 */
export function nothingFetched(counts) {
  return runCounts({ downloaded: 0, total: counts.on_disk, failed: 0, remaining: 0 });
}

/** When the plan was made and when it stops being one, so nobody does TTL arithmetic. */
export function planWindow({ createdAt, ttlHours }) {
  return {
    created_at: createdAt,
    expires_at: new Date(Date.parse(createdAt) + ttlHours * 3600 * 1000).toISOString(),
  };
}

/** The exact command that fetches what a plan just described. */
function nextStep(argv) {
  return { command: commandFor(argv, 'go'), run_by: 'agent' };
}

/**
 * Where `--alias` would put this folder. A plan says what a `--go` would do and
 * performs nothing: a preview that silently reorganised the archive would be a
 * preview that lied.
 */
function movingToNote(dir) {
  return { code: 'moving-to', dir };
}

/**
 * The root the previous run used, when it is not this one's. Left unsaid, a run
 * against a different root starts a second archive in silence, and its `on_disk`
 * of zero reads as an account that has lost its files.
 */
function rootChangedNote(previous) {
  return { code: 'root-changed', previous };
}
