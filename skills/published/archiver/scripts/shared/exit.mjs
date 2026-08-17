/**
 * exit.mjs — one exit table, for every platform and the dispatcher above them.
 *
 * A caller should be able to tell "rate-limited, try later" from "you typed the
 * flag wrong" without knowing which platform ran, which is only true if the
 * codes mean the same thing everywhere.
 */
export const EXIT = {
  OK: 0,
  /** The command line is wrong: an unknown flag, no URL, a URL that names no account. */
  USAGE: 2,
  /** The run was refused on its own terms: a stale plan, an alias already in use. */
  REFUSED: 3,
  /** The tools or the network failed. */
  FAILED: 4,
  /** The session was rejected, and the remedy is a new one. */
  UNAUTHORIZED: 5,
  /** There is nothing to archive: no posts, or none this skill can fetch. */
  EMPTY: 6,
};
