/**
 * account.mjs — where an account's folder is, and the identity written inside it.
 *
 * The folder is the account's alias if it has one, and its numeric id if it does
 * not:
 *
 *   <archives root>/x/1458023001234567890/account.json     no alias
 *   <archives root>/x/jia/account.json                     --alias jia
 *
 * The id is the default because handles are mutable and the id never changes, so
 * an account that is left alone can be renamed on X all day without anything
 * here having to notice. An alias is the one thing that overrides that, because
 * it is the one identifier the *user* chose — and a folder full of numbers is
 * unreadable to the person whose archive it is.
 *
 * What makes the alias safe is that it never has to be guessed. `archiver.json`
 * records id → alias, so a known id is one lookup from its folder; and because
 * `account.json` inside the folder holds the same alias, the map can be rebuilt
 * by scanning whenever it turns out to be wrong. The map is the fast path and
 * the tree is the truth.
 *
 * Where the two disagree, the folder's own location wins: a person who renamed a
 * directory has said something clearer than a file recording what they said
 * last time. That rule is not a reconciliation pass — it is recordIdentity
 * deriving the alias from `basename(dir)` every time it writes, so the two can
 * only ever disagree between one write and the next.
 *
 * `account.json` is authoritative for *identity* — which account is this folder
 * — and never for *progress*. What has been downloaded is answered by the post
 * folders (landed.mjs) and by nothing else: a stored count or newest-post id
 * would be a second account of the same thing, free to disagree after a run that
 * died between two writes. What the last run *did* is run history and lives in
 * sync.json, which may be deleted without losing anything.
 */
import { readdir, rename, stat } from 'node:fs/promises';
import path from 'node:path';

import { readJson, writeJson } from './cli.mjs';
import { readAliases, writeAlias } from './archiver.mjs';

export const ACCOUNT_FILE = 'account.json';
export const ACCOUNT_VERSION = 1;

/**
 * The directory this skill's accounts live under, inside a root it shares with
 * douyin-archiver. Two platforms, two folders, so an X user id and a sec_uid
 * cannot name the same directory — and an alias chosen here cannot collide with
 * one chosen there.
 */
export const PLATFORM = 'x';

/** Every account this skill has archived, whatever their ids. */
export const platformDir = (root) => path.join(root, PLATFORM);

/**
 * An id that may be used as a directory name.
 *
 * X ids are decimal and could simply be trusted, but the id arrives from a
 * subprocess's stdout and lands in a path — so it is checked here rather than
 * anywhere it is joined. A separator or a `..` in this position does not produce
 * a badly named folder, it produces a tree somewhere else entirely.
 */
export function isSafeId(accountId) {
  const id = String(accountId ?? '');
  return id.length > 0 && id.length <= 128 && /^[A-Za-z0-9._-]+$/.test(id) && id !== '.' && id !== '..';
}

/**
 * An alias that may be used as a directory name.
 *
 * Wider than isSafeId on purpose: an alias is typed by the person who owns the
 * archive, and the sibling skill's accounts are Chinese, so letters means
 * `\p{L}` rather than A–Z. Everything excluded is excluded because of what it
 * would do to a path — separators, control characters, a leading dot that hides
 * the folder — except spaces, which are excluded because every quoted example in
 * the docs would otherwise be a trap.
 *
 * Refused rather than rewritten. An alias the user cannot predict is worse than
 * one they have to retype.
 */
export function isSafeAlias(alias) {
  const value = String(alias ?? '');
  return value.length > 0 && value.length <= 128 && /^[\p{L}\p{N}._-]+$/u.test(value) && !value.startsWith('.');
}

/**
 * Why an alias was refused for its shape, in one place.
 *
 * The entry point says this before the archives root is even resolved and
 * checkAlias says it again afterwards; two copies of a sentence like this is
 * how the two come to describe different rules.
 */
export function aliasShapeRefusal(alias) {
  return (
    `${JSON.stringify(String(alias ?? ''))} cannot be an alias.\n` +
    '  Letters, digits, dots, dashes and underscores; no spaces, no slashes, and not starting with a dot.'
  );
}

/** Where this account's folder is if it has no alias, whether or not it exists. */
export function accountDirFor(root, accountId) {
  if (!isSafeId(accountId)) {
    throw new Error(`refusing to use ${JSON.stringify(String(accountId ?? ''))} as an account folder name`);
  }
  return path.join(platformDir(root), String(accountId));
}

/** Where an aliased folder is, whether or not it exists yet. */
export function aliasDirFor(root, alias) {
  if (!isSafeAlias(alias)) {
    throw new Error(`refusing to use ${JSON.stringify(String(alias ?? ''))} as an account folder name`);
  }
  return path.join(platformDir(root), String(alias));
}

/**
 * The fields a caller actually knows.
 *
 * An enumeration that yielded rows but never named the account falls back to
 * blanks. Spread as-is, those blanks would overwrite what an earlier run had
 * already recorded.
 */
function known(fields) {
  return Object.fromEntries(
    Object.entries(fields || {}).filter(([, value]) => value !== null && value !== undefined && value !== ''),
  );
}

/**
 * Who the account is, in a fixed order and holding nothing else.
 *
 * The order is for the person who opens the file: the same lines in the same
 * places whichever run happened to learn which first. Listing them is also what
 * keeps a key this skill has stopped writing from living on in an archive by
 * being copied forward run after run.
 */
const ACCOUNT_KEYS = ['id', 'handle', 'nickname', 'alias'];

function identity(existing, next, drop) {
  const merged = { ...known(existing), ...known(next) };
  for (const key of drop) delete merged[key];
  return Object.fromEntries(ACCOUNT_KEYS.filter((key) => key in merged).map((key) => [key, merged[key]]));
}

/**
 * Later facts win, nothing already known is dropped, and `drop` is the only way
 * to take something off.
 *
 * A blank cannot mean erasure, because every run passes fields it happens not to
 * know — so `--unalias` names the key it is removing instead. The shape is
 * written out rather than spread from the file being merged, so a key this
 * skill does not keep cannot survive in an archive by being copied forward.
 *
 * `platform` is stamped even though the parent directory already says it. It is
 * what makes a lone account.json self-describing when it has been copied out of
 * the tree, since no spec ships beside the skill.
 */
export function mergeAccount(existing, next, { drop = [] } = {}) {
  return {
    version: ACCOUNT_VERSION,
    platform: PLATFORM,
    account: identity(existing?.account, next?.account, drop),
    // A write with no url leaves the recorded one alone rather than blanking it.
    url: next?.url || existing?.url || null,
  };
}

/** An account folder's identity, or null if it has none. */
export async function readAccount(dir) {
  return readJson(path.join(dir, ACCOUNT_FILE));
}

export async function writeAccount(dir, next, options) {
  const merged = mergeAccount(await readAccount(dir), next, options);
  await writeJson(path.join(dir, ACCOUNT_FILE), merged);
  return merged;
}

/**
 * Who this folder belongs to, and — as one act, because they must agree — where
 * that account's folder now is.
 *
 * The alias written is `basename(dir)`, never the flag the user typed. That is
 * what makes "the folder's location wins" a property of the code rather than a
 * rule someone has to remember: a folder renamed by hand is adopted the next
 * time anything writes to it, and account.json cannot drift from the directory
 * it is sitting in.
 *
 * The mapping is written last and only when it is wrong, so an ordinary run
 * against an un-aliased account does not rewrite the root file at all.
 */
export async function recordIdentity(root, dir, { account, url = null } = {}) {
  // The folder's own account.json is consulted for the id when the caller has
  // none. A finished run writes only the url — by then the account was recorded
  // before the download — and taking the caller's word for the id meant that
  // write silently skipped the map, leaving account.json holding an alias
  // archiver.json had never heard of. The folder always knows whose it is.
  const existing = await readAccount(dir);
  const id = String(account?.id ?? existing?.account?.id ?? '');
  const base = path.basename(dir);
  const alias = base !== id && isSafeAlias(base) ? base : null;

  const merged = await writeAccount(
    dir,
    { account: { ...account, alias }, url },
    alias ? undefined : { drop: ['alias'] },
  );

  if (id) {
    const recorded = (await readAliases(root, PLATFORM))[id] ?? null;
    if (recorded !== alias) await writeAlias(root, PLATFORM, id, alias);
  }

  return merged;
}

/** An account folder's identity, if this build can read the file it holds. */
async function identityAt(dir) {
  const json = await readAccount(dir);
  return json?.version === ACCOUNT_VERSION ? json : null;
}

async function exists(dir) {
  try {
    await stat(dir);
    return true;
  } catch {
    return false;
  }
}

/**
 * Every account folder under the root that this build can read, as it is found.
 *
 * Lazy, so a match in the first folder does not cost a read of every other one.
 * A file written by a version that numbered its fields differently is skipped
 * rather than guessed at: it reads as no archive at all, which is the same
 * answer as a folder nobody has archived into.
 */
async function* accounts(root) {
  let entries;
  try {
    entries = await readdir(platformDir(root), { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(platformDir(root), entry.name);
    const json = await identityAt(dir);
    if (json) yield [dir, json];
  }
}

/**
 * The folder holding this account, or null.
 *
 * Three steps, cheapest first, and every one of them verified against the
 * account.json it lands on — a path that exists proves only that *something* is
 * there, and the folder another account is sitting in is exactly what must not
 * be written into.
 *
 *   1. the alias the mapping records — one stat, the ordinary case
 *   2. the id, for an account that has no alias
 *   3. a scan, which is what repairs a mapping that has gone stale
 *
 * Reads and never writes, so `--plan` may call it. The repair is a consequence
 * of the next write rather than a side effect of the lookup — see
 * recordIdentity.
 */
export async function resolveAccountDir(root, { id } = {}) {
  const wanted = String(id ?? '');
  if (!wanted) return null;

  const mapped = (await readAliases(root, PLATFORM))[wanted];
  if (mapped && isSafeAlias(mapped)) {
    const dir = aliasDirFor(root, mapped);
    if (String((await identityAt(dir))?.account?.id ?? '') === wanted) return dir;
  }

  if (isSafeId(wanted)) {
    const dir = accountDirFor(root, wanted);
    if (String((await identityAt(dir))?.account?.id ?? '') === wanted) return dir;
  }

  for await (const [dir, json] of accounts(root)) {
    if (String(json.account?.id ?? '') === wanted) return dir;
  }

  return null;
}

/**
 * The folder for an account whose id we do not know, or null.
 *
 * `--go` enumerates nothing, so it never learns the numeric id and cannot go
 * straight to the folder the way a plan can. The keys are tried in the order of
 * how much they prove, and the first two are direct:
 *
 *   alias   as a path, then through the mapping — theirs, and it names the folder
 *   url     the very URL the archive was made from — exact, survives a rename
 *   handle  what the account is called today — right until it is renamed
 *
 * One pass over the directory for the last three, because the answer is wanted
 * once and the alternative is three passes that each stop at a different folder.
 */
export async function findAccountDir(root, { url, alias, handle } = {}) {
  if (alias && isSafeAlias(alias)) {
    const dir = aliasDirFor(root, alias);
    if (await identityAt(dir)) return dir;

    for (const [id, name] of Object.entries(await readAliases(root, PLATFORM))) {
      if (name !== alias || !isSafeId(id)) continue;
      const byId = accountDirFor(root, id);
      // The id has to match as well as the folder existing. This whole branch
      // is reached because the map turned out to be stale, and a map that is
      // wrong about where an account is can be wrong about whose folder it is
      // pointing at.
      if (String((await identityAt(byId))?.account?.id ?? '') === id) return byId;
    }
  }

  const found = { alias: null, handle: null };

  for await (const [dir, json] of accounts(root)) {
    if (url && json.url === url) return dir;
    if (alias && json.account?.alias === alias) found.alias ??= dir;
    if (handle && json.account?.handle === handle) found.handle ??= dir;
  }

  return found.alias ?? found.handle ?? null;
}

/**
 * Every account id this platform has spoken for.
 *
 * The mapping's keys are the aliased accounts; the folders that are *not* named
 * by some alias are the un-aliased ones, and their names are their ids. Together
 * that is every id, without opening a single account.json.
 *
 * It exists so an alias can be refused for looking like somebody else's id. The
 * harm is deferred rather than immediate — `--alias 12345` only collides once
 * account 12345 is un-aliased and wants its own folder back — which is precisely
 * why it has to be refused at the point it is typed.
 */
export async function existingIds(root) {
  const aliases = await readAliases(root, PLATFORM);
  const names = new Set(Object.values(aliases));
  const ids = new Set(Object.keys(aliases));

  try {
    for (const entry of await readdir(platformDir(root), { withFileTypes: true })) {
      if (entry.isDirectory() && !names.has(entry.name)) ids.add(entry.name);
    }
  } catch {
    // Nothing archived on this platform yet, so nothing is spoken for.
  }

  return ids;
}

/**
 * Whether `alias` may be given to `id`, as `{ ok, reason }`.
 *
 * Shape is decided first and without touching the filesystem, so a typo is
 * refused by argument parsing rather than after a full timeline crawl. The rest
 * needs only the archives root — never the network — which is why the caller can
 * ask before it fetches anything.
 *
 * `id` may be null when the account has never been archived: a name already
 * taken is then taken by definition, because it cannot be taken by us.
 */
export async function checkAlias(root, { id = null, alias } = {}) {
  if (!isSafeAlias(alias)) return { ok: false, reason: aliasShapeRefusal(alias) };

  const mine = id === null ? null : String(id);

  for (const [other, name] of Object.entries(await readAliases(root, PLATFORM))) {
    if (name === alias && other !== mine) {
      return { ok: false, reason: `the alias ${JSON.stringify(alias)} already belongs to the account with id ${other}` };
    }
  }

  const occupant = await identityAt(aliasDirFor(root, alias));
  const occupantId = String(occupant?.account?.id ?? '');
  if (occupantId && occupantId !== mine) {
    return { ok: false, reason: `the alias ${JSON.stringify(alias)} already belongs to the account with id ${occupantId}` };
  }

  if ((await existingIds(root)).has(alias) && alias !== mine) {
    return {
      ok: false,
      reason:
        `${JSON.stringify(alias)} is another account's id on this platform, so it cannot be an alias.\n` +
        '  An un-aliased account is filed under its id, and this alias would one day want that folder.',
    };
  }

  return { ok: true };
}

/**
 * Put this account's folder where `alias` says it goes, and return the path.
 *
 * The move happens first and the records follow, because the tree is the truth
 * and the map is the cache: a crash after the rename leaves a folder whose next
 * write adopts it, while a crash the other way round would leave the index
 * ahead of reality.
 *
 * A destination that is already occupied is read before it is touched. The same
 * account sitting there is the ordinary aftermath of an interrupted run, and is
 * adopted. Anything else — a different account, or a folder with no readable
 * identity — is refused. Nothing is ever merged: two accounts' posts in one
 * folder is the one mistake here that cannot be undone.
 */
export async function applyAlias(root, { id, alias }) {
  const wanted = String(id);
  const target = aliasDirFor(root, alias);
  const current = await resolveAccountDir(root, { id: wanted });

  if (current === target) return target;

  if (await exists(target)) {
    const occupantId = String((await identityAt(target))?.account?.id ?? '');

    if (occupantId !== wanted) {
      throw new Error(
        `${target} already exists, and it is not this account's.\n` +
          `  ${occupantId ? `It belongs to the account with id ${occupantId}.` : 'It holds no account.json this build can read.'}\n` +
          '  Nothing has been moved. Choose another alias, or move that folder aside yourself.',
      );
    }

    if (current) {
      throw new Error(
        `this account is in two folders at once — ${current} and ${target}.\n` +
          '  Nothing has been moved, and nothing here will merge them. Keep the one you want and remove the other.',
      );
    }

    return target;
  }

  if (current) await rename(current, target);
  return target;
}

/**
 * Take the alias off, putting the folder back under the account's id.
 *
 * The counterpart to applyAlias and the only way to remove an alias, because a
 * blank `--alias` cannot mean it — every run passes flags it has no value for,
 * so an empty one has to read as silence.
 *
 * Unlike applyAlias this writes the records itself rather than leaving them to
 * the next write. `--unalias` is a whole instruction on its own: there is no
 * fetch behind it whose recordIdentity would tidy up afterwards, and a folder
 * that had moved while account.json still claimed the old alias would be exactly
 * the disagreement this layout is built to avoid.
 */
export async function clearAlias(root, { id }) {
  const wanted = String(id);
  const target = accountDirFor(root, wanted);
  const current = await resolveAccountDir(root, { id: wanted });

  if (current && current !== target) {
    if (await exists(target)) {
      throw new Error(
        `${target} already exists, so this account cannot be filed under its id again.\n` +
          '  Nothing has been moved. Move that folder aside yourself, then try again.',
      );
    }
    await rename(current, target);
  }

  const json = await identityAt(target);
  if (json) await recordIdentity(root, target, { account: json.account, url: json.url });
  else await writeAlias(root, PLATFORM, wanted, null);

  return target;
}
