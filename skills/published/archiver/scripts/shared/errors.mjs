/**
 * errors.mjs — every refusal this skill can make, as a code with an exit beside it.
 *
 * A refusal is identified by its code and never by its wording. The agent reading
 * this skill's output branches on the code; the sentence a user hears is written
 * in `SKILL.md`, in their language. So a code may not be renamed without renaming
 * it there too, and a sentence may be reworded freely.
 *
 * The table lives here rather than in `exit.mjs` because the two answer different
 * questions. `exit.mjs` is five constants a shell caller reads; this is the fifty
 * or so identities behind them, and the mapping between the two. Keeping them
 * apart is what lets `exit.mjs` stay readable at a glance.
 *
 * **Exhaustive.** A code emitted from anywhere in this skill has an entry here,
 * and `refusal()` throws for one that does not — every document a test produces
 * is validated against `output.schema.json`, whose enum is this table, so a code
 * added to the scripts without being added here fails the suite rather than
 * reaching a user.
 */
import { EXIT } from './exit.mjs';

/**
 * Code → exit, grouped the way a reader meets them: what was typed, where the
 * archive is, what the URL named, the alias, the tools, the session, the plan,
 * and what the site said.
 *
 * Many codes share one exit, and that is the point: `EXIT.REFUSED` alone means
 * seven different things, which is precisely why a code sits in front of it.
 */
export const ERROR_EXITS = {
  // Dispatch and command line
  'no-arguments': EXIT.USAGE,
  'unsupported-platform': EXIT.USAGE,
  'multiple-platforms': EXIT.USAGE,
  'list-with-url': EXIT.USAGE,
  'list-unknown-flag': EXIT.USAGE,
  'list-unexpected-argument': EXIT.USAGE,
  'unknown-flag': EXIT.USAGE,
  'no-url': EXIT.USAGE,
  'downloads-renamed': EXIT.USAGE,
  'node-missing': EXIT.FAILED,

  // Archives root
  'root-in-skill': EXIT.USAGE,
  'archive-schema-unreadable': EXIT.USAGE,
  'archive-schema-unsupported': EXIT.USAGE,

  // URL
  'url-share-link': EXIT.USAGE,
  'url-not-profile': EXIT.USAGE,
  'url-not-platform': EXIT.USAGE,
  'url-no-account': EXIT.USAGE,
  'url-reserved-handle': EXIT.USAGE,
  'url-out-of-scope': EXIT.USAGE,

  // Alias
  'alias-and-unalias': EXIT.USAGE,
  'alias-invalid': EXIT.USAGE,
  'alias-taken': EXIT.USAGE,
  'alias-is-other-id': EXIT.USAGE,
  'alias-target-occupied': EXIT.FAILED,
  'account-in-two-folders': EXIT.FAILED,
  'unalias-target-occupied': EXIT.FAILED,
  'unsafe-account-id': EXIT.FAILED,

  // Tools
  'env-consent': EXIT.REFUSED,
  'env-build-failed': EXIT.FAILED,
  'tool-missing': EXIT.FAILED,
  'playwright-missing': EXIT.FAILED,
  'playwright-broken': EXIT.FAILED,

  // Session
  'session-missing': EXIT.UNAUTHORIZED,
  'session-empty': EXIT.UNAUTHORIZED,
  'session-expired-grid': EXIT.UNAUTHORIZED,
  'login-abandoned': EXIT.UNAUTHORIZED,
  'login-timed-out': EXIT.UNAUTHORIZED,
  'session-rejected': EXIT.UNAUTHORIZED,
  'no-session-source': EXIT.FAILED,
  'session-unreadable': EXIT.FAILED,

  // Plan
  'no-archive': EXIT.REFUSED,
  'plan-missing': EXIT.REFUSED,
  'plan-unreadable': EXIT.REFUSED,
  'plan-no-timestamp': EXIT.REFUSED,
  'plan-stale': EXIT.REFUSED,
  'plan-foreign-account': EXIT.REFUSED,
  'plan-foreign-root': EXIT.REFUSED,
  'plan-empty': EXIT.REFUSED,

  // Collection and fetch
  empty: EXIT.EMPTY,
  'empty-grid': EXIT.EMPTY,
  'unidentified-account': EXIT.FAILED,
  'no-douyin-id': EXIT.FAILED,
  'bad-account-id': EXIT.FAILED,
  'rate-limited': EXIT.FAILED,
  protected: EXIT.FAILED,
  suspended: EXIT.FAILED,
  'no-such-account': EXIT.FAILED,
  'post-gone': EXIT.FAILED,
  'downloader-unavailable': EXIT.FAILED,
  'collect-failed': EXIT.FAILED,

  // Internal
  'internal-error': EXIT.FAILED,
};

/**
 * A refusal raised from a module that has no business emitting one.
 *
 * `paths.mjs` knows a working directory is inside the skill; it does not know
 * which command is running or which platform, and those belong in the envelope.
 * So it throws this and the run that catches it fills the rest in.
 *
 * `message` is the fallback sentence, not what the user is told — see
 * `output.mjs`.
 */
export class Refusal extends Error {
  constructor(code, message, { details = null, remedy = null } = {}) {
    super(message);
    this.name = 'Refusal';
    this.code = code;
    this.details = details;
    this.remedy = remedy;
  }
}

/** The exit a code carries, or a throw for one that is not in the table. */
export function exitFor(code) {
  const exit = ERROR_EXITS[code];
  if (exit === undefined) throw new Error(`no exit code for refusal '${code}'`);
  return exit;
}

/**
 * The fields of a thrown `Refusal`, for a caller that is turning it into a
 * document. Anything else is re-thrown: an unexpected error is the dispatcher's
 * `internal-error` to report, and swallowing it here would file a bug as a
 * refusal.
 */
export function refusalFields(error) {
  if (!(error instanceof Refusal)) throw error;
  return { code: error.code, message: error.message, details: error.details, remedy: error.remedy };
}
