#!/usr/bin/env node
/**
 * account.mjs — where an account's folder is, and the identity written inside it.
 *
 * The folder is the account's alias if it has one, and its sec_uid if it does
 * not:
 *
 *   <archives root>/douyin/MS4wLjABAAAA…/account.json     no alias
 *   <archives root>/douyin/jia/account.json               --alias jia
 *
 * The sec_uid is the default because a user can change their 抖音号 and the
 * sec_uid never changes, so an account that is left alone can rename itself all
 * it likes without anything here having to notice. An alias is the one thing
 * that overrides that, because it is the one identifier the *user* chose — and
 * `MS4wLjABAAAAEKnfa654JAJ_N5lgZDQluwsxmY0lhfmEYNQBBkwGG98` is unreadable to the
 * person whose archive it is.
 *
 * What makes the alias safe is that it never has to be guessed. `archiver.json`
 * records id → alias, so a known sec_uid is one lookup from its folder; and
 * because `account.json` inside the folder holds the same alias, the map can be
 * rebuilt by scanning whenever it turns out to be wrong. The map is the fast
 * path and the tree is the truth.
 *
 * Where the two disagree, the folder's own location wins: a person who renamed a
 * directory has said something clearer than a file recording what they said last
 * time. That rule is not a reconciliation pass — it is recordIdentity deriving
 * the alias from `basename(dir)` every time it writes, so the two can only ever
 * disagree between one write and the next.
 *
 * The 抖音号 is still kept inside the file, because it is the identifier a human
 * can actually read and type, and because a single-post download may learn it
 * before it learns anything else.
 *
 * `account.json` is authoritative for *identity* — which account is this folder
 * — and never for *progress*. What has been downloaded is answered by the post
 * folders under posts/ (landed.mjs) and by nothing else: a stored count or
 * newest-post id would be a second record of the same thing, free to disagree
 * with the files after a run that died between two writes. What the last run
 * *did* is run history and lives in sync.json, which may be deleted without
 * losing anything.
 *
 * Subcommands:
 *   resolve --sec-uid UID [--douyin-id ID] [--alias NAME] [--archives DIR]
 *           [--require-match]
 *       Prints the folder path for an account, creating nothing. A sec_uid is
 *       looked up through the alias map; without one, the 抖音号 or the alias is
 *       looked up by scanning. --require-match exits 3 rather than naming a
 *       folder that does not exist yet.
 *
 *   write --folder DIR [--meta FILE] [--sec-uid UID] [--douyin-id ID] [--url URL]
 *       Merges what this run knows into <folder>/account.json, and records the
 *       folder's own name as the account's alias. Fields it was not given are
 *       left as the previous run recorded them.
 *
 *   check-alias --alias NAME [--sec-uid UID] [--douyin-id ID] [--url URL]
 *               [--archives DIR]
 *       Exits 0 if NAME may name this account's folder, or 2 saying why not.
 *       Touches nothing. Called before the run commits to anything. The sec_uid
 *       may be absent — the 抖音号, URL and alias are then used to work out
 *       whose account this is, so an alias is not refused for colliding with
 *       the very account asking for it.
 *
 *   alias --sec-uid UID --alias NAME [--archives DIR]
 *       Moves the account's folder to NAME and prints where it now is.
 *
 *   unalias --sec-uid UID [--archives DIR]
 *       Moves it back under the sec_uid and prints where it now is.
 *
 *   root [--archives DIR]
 *       Prints the archives root: the flag if given, else the default for the
 *       current working directory. The single place that answer is computed.
 */
import { readdir, rename, stat } from 'node:fs/promises';
import path from 'node:path';

import { isMainModule, optString, parseArgs, readJson, writeJson } from './cli.mjs';
import { readAliases, writeAlias } from './archiver.mjs';
import { archivesRoot, normalizeRoot } from './paths.mjs';

export const ACCOUNT_FILE = 'account.json';
export const ACCOUNT_VERSION = 1;

/**
 * The directory this skill's accounts live under, inside a root it shares with
 * x-archiver. Two platforms, two folders, so a sec_uid and an X user id cannot
 * name the same directory — and an alias chosen here cannot collide with one
 * chosen there.
 */
export const PLATFORM = 'douyin';

/** Every account this skill has archived, whatever their ids. */
export const platformDir = (root) => path.join(root, PLATFORM);

/**
 * An id that may be used as a directory name.
 *
 * A sec_uid is `MS4wLjABAAAA…` — long, opaque, and made of characters that are
 * safe in a path. It is checked anyway, here rather than at every place it is
 * joined, because it arrives from a URL or a subprocess's stdout: a separator
 * or a `..` in this position does not produce a badly named folder, it produces
 * a tree somewhere else entirely.
 */
export function isSafeId(accountId) {
  const id = String(accountId ?? '');
  return id.length > 0 && id.length <= 128 && /^[A-Za-z0-9._-]+$/.test(id) && id !== '.' && id !== '..';
}

/**
 * An alias that may be used as a directory name.
 *
 * Wider than isSafeId on purpose: an alias is typed by the person who owns the
 * archive, and the accounts here are Chinese, so letters means `\p{L}` rather
 * than A–Z. Everything excluded is excluded because of what it would do to a
 * path — separators, control characters, a leading dot that hides the folder —
 * except spaces, which are excluded because every quoted example in the docs
 * would otherwise be a trap.
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
 * The collector's metadata carries every key it knows *of*, null where it found
 * nothing, and a single-post run knows only the 抖音号. Spread as-is, those
 * blanks would overwrite what a full sweep had already recorded.
 */
function known(fields) {
  return Object.fromEntries(
    Object.entries(fields || {}).filter(([, value]) => value !== null && value !== undefined && value !== ''),
  );
}

/**
 * Who the account is, in a fixed order and holding nothing else.
 *
 * `id` is the sec_uid — the same key x-archiver uses for the X user id, so both
 * platforms' account.json read the same way. Listing the keys is also what keeps
 * one this skill has stopped writing from living on in an archive by being
 * copied forward run after run.
 */
const ACCOUNT_KEYS = ['id', 'douyin_id', 'nickname', 'alias'];

function identity(existing, next, drop) {
  const merged = { ...known(existing), ...known(next) };
  for (const key of drop) delete merged[key];
  return Object.fromEntries(ACCOUNT_KEYS.filter((key) => key in merged).map((key) => [key, merged[key]]));
}

/**
 * What this run knows wins; what only the previous run knew survives; and `drop`
 * is the only way to take something off.
 *
 * A blank cannot mean erasure, because every run passes fields it happens not to
 * know — so `--unalias` names the key it is removing instead. The shape is
 * written out rather than spread from the old file, so the fields this skill no
 * longer keeps — `root` and `updated_at`, which moved to sync.json's last_run,
 * and `name`, which became `alias` — cannot survive in an archive by being
 * copied forward.
 *
 * `platform` is stamped even though the parent directory already says it. It is
 * what makes a lone account.json self-describing when it has been copied out of
 * the tree, which matters more now that no spec ships beside the skill.
 */
export function mergeAccount(existing, next, { drop = [] } = {}) {
  return {
    version: ACCOUNT_VERSION,
    platform: PLATFORM,
    account: identity(existing?.account, next?.account, drop),
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
 *   2. the sec_uid, for an account that has no alias
 *   3. a scan, which is what repairs a mapping that has gone stale
 *
 * Reads and never writes, so a plan may call it. The repair is a consequence of
 * the next write rather than a side effect of the lookup — see recordIdentity.
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
 * The folder for an account whose sec_uid we do not know, or null.
 *
 * A single-post download learns the 抖音号 before anything else, and a user may
 * only remember what they called the archive. The keys are tried in the order of
 * how much they prove, and the alias is tried as a path first because it *is*
 * the folder's name:
 *
 *   alias     as a path, then through the mapping — theirs, and it names the folder
 *   url       the very URL the archive was made from — exact, survives a rename
 *   douyin_id what the account is called today — right until it is changed
 *
 * One pass over the directory for the last three, because the answer is wanted
 * once and the alternative is three passes that stop at different folders.
 */
export async function findAccountDir(root, { url, alias, douyinId } = {}) {
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

  const found = { alias: null, douyinId: null };

  for await (const [dir, json] of accounts(root)) {
    if (url && json.url === url) return dir;
    if (alias && json.account?.alias === alias) found.alias ??= dir;
    if (douyinId && json.account?.douyin_id === douyinId) found.douyinId ??= dir;
  }

  return found.alias ?? found.douyinId ?? null;
}

/**
 * Every account id this platform has spoken for.
 *
 * The mapping's keys are the aliased accounts; the folders that are *not* named
 * by some alias are the un-aliased ones, and their names are their sec_uids.
 * Together that is every id, without opening a single account.json.
 *
 * It exists so an alias can be refused for looking like somebody else's id. The
 * harm is deferred rather than immediate — an alias that is another account's
 * sec_uid only collides once that account is un-aliased and wants its own folder
 * back — which is precisely why it has to be refused at the point it is typed.
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
 * refused by argument parsing rather than after a browser has opened and a
 * timeline has been scrolled. The rest needs only the archives root — never the
 * network — which is why the caller can ask before it fetches anything.
 *
 * `id` may be null when the account has never been archived: a name already
 * taken is then taken by definition, because it cannot be taken by us.
 */
export async function checkAlias(root, { id = null, alias } = {}) {
  if (!isSafeAlias(alias)) return { ok: false, reason: aliasShapeRefusal(alias) };

  const mine = id === null ? null : String(id);

  for (const [other, name] of Object.entries(await readAliases(root, PLATFORM))) {
    if (name === alias && other !== mine) {
      return { ok: false, reason: `the alias ${JSON.stringify(alias)} already belongs to the account with sec_uid ${other}` };
    }
  }

  const occupant = await identityAt(aliasDirFor(root, alias));
  const occupantId = String(occupant?.account?.id ?? '');
  if (occupantId && occupantId !== mine) {
    return {
      ok: false,
      reason: `the alias ${JSON.stringify(alias)} already belongs to the account with sec_uid ${occupantId}`,
    };
  }

  if ((await existingIds(root)).has(alias) && alias !== mine) {
    return {
      ok: false,
      reason:
        `${JSON.stringify(alias)} is another account's sec_uid on this platform, so it cannot be an alias.\n` +
        '  An un-aliased account is filed under its sec_uid, and this alias would one day want that folder.',
    };
  }

  return { ok: true };
}

/**
 * Put this account's folder where `alias` says it goes, and return the path.
 *
 * The move happens first and the records follow, because the tree is the truth
 * and the map is the cache: a crash after the rename leaves a folder whose next
 * write adopts it, while a crash the other way round would leave the index ahead
 * of reality.
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
          `  ${occupantId ? `It belongs to the account with sec_uid ${occupantId}.` : 'It holds no account.json this build can read.'}\n` +
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
 * Take the alias off, putting the folder back under the account's sec_uid.
 *
 * The counterpart to applyAlias and the only way to remove an alias, because a
 * blank `--alias` cannot mean it — archive.sh passes flags it has no value for,
 * so an empty one has to read as silence.
 *
 * Unlike applyAlias this writes the records itself rather than leaving them to
 * the next write. `--unalias` is a whole instruction on its own: there is no
 * fetch behind it whose write would tidy up afterwards, and a folder that had
 * moved while account.json still claimed the old alias would be exactly the
 * disagreement this layout is built to avoid.
 */
export async function clearAlias(root, { id }) {
  const wanted = String(id);
  const target = accountDirFor(root, wanted);
  const current = await resolveAccountDir(root, { id: wanted });

  if (current && current !== target) {
    if (await exists(target)) {
      throw new Error(
        `${target} already exists, so this account cannot be filed under its sec_uid again.\n` +
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

// ---- CLI -------------------------------------------------------------------

/** The flag if given, else the default for the current working directory. */
function rootFor(opts) {
  try {
    const given = optString(opts, 'archives');
    return given ? normalizeRoot(given) : archivesRoot();
  } catch (err) {
    console.error(`error: ${err.message}`);
    process.exit(2);
  }
}

async function resolve(opts) {
  const root = rootFor(opts);
  const secUid = optString(opts, 'sec_uid');
  const douyinId = optString(opts, 'douyin_id');
  const alias = optString(opts, 'alias');

  if (!secUid && !douyinId && !alias) {
    console.error('error: resolve needs --sec-uid, --douyin-id or --alias');
    process.exit(2);
  }

  // The sec_uid identifies the account, but no longer names its folder on its
  // own — the alias map does that, and a scan repairs the map. An account that
  // has never been archived has no folder at all, and --require-match is how the
  // caller asks to be told that rather than given a path.
  if (secUid) {
    let dir;
    try {
      dir = (await resolveAccountDir(root, { id: secUid })) ?? (alias ? aliasDirFor(root, alias) : accountDirFor(root, secUid));
    } catch (err) {
      console.error(`error: ${err.message}`);
      process.exit(2);
    }
    // The id, not merely a folder. resolveAccountDir returning null and this
    // path falling back to the bare sec_uid is exactly the case where a folder
    // of that name belongs to somebody else — "something is there" would then
    // hand --go another account's archive to run a plan against.
    if (opts.require_match && String((await identityAt(dir))?.account?.id ?? '') !== secUid) {
      process.exit(3);
    }
    console.log(dir);
    return;
  }

  const existing = await findAccountDir(root, { alias, douyinId });
  if (existing) {
    console.log(existing);
    return;
  }

  // Without a sec_uid there is no folder to invent: the 抖音号 cannot name one,
  // because it is the mutable identifier this layout stopped filing by, and an
  // alias with no id behind it has nothing to record in the map.
  process.exit(3);
}

async function write(opts) {
  const folder = optString(opts, 'folder');
  if (!folder) {
    console.error('error: write needs --folder');
    process.exit(2);
  }

  // --meta is the collector's metadata; the flags are for the paths that never
  // ran a collection at all.
  const meta = optString(opts, 'meta') ? ((await readJson(opts.meta)) ?? {}) : {};

  // The alias is not passed: recordIdentity reads it off the folder's own name,
  // which is what keeps account.json and the directory from disagreeing.
  await recordIdentity(rootFor(opts), folder, {
    account: {
      id: optString(opts, 'sec_uid') || meta.sec_uid,
      douyin_id: optString(opts, 'douyin_id') || meta.douyin_id,
      nickname: meta.nickname,
    },
    url: optString(opts, 'url'),
  });
}

async function checkAliasCommand(opts) {
  const root = rootFor(opts);
  const alias = optString(opts, 'alias');
  let id = optString(opts, 'sec_uid');

  // A run that has no sec_uid yet — the single-post fallback, or a profile URL
  // that carried none — still has to be able to name the account, or the check
  // reads the account's *own* alias as a collision with itself and refuses the
  // one thing that was always allowed. The 抖音号 and the alias are enough to
  // find a folder that already exists, and an account nothing has archived
  // cannot be holding the name anyway.
  if (!id) {
    const existing = await findAccountDir(root, {
      url: optString(opts, 'url'),
      alias,
      douyinId: optString(opts, 'douyin_id'),
    });
    if (existing) id = String((await identityAt(existing))?.account?.id ?? '');
  }

  const verdict = await checkAlias(root, { id: id || null, alias });
  if (!verdict.ok) {
    console.error(`error: ${verdict.reason}`);
    process.exit(2);
  }
}

async function move(opts, { off }) {
  const root = rootFor(opts);
  const secUid = optString(opts, 'sec_uid');
  if (!secUid) {
    console.error('error: this command needs --sec-uid');
    process.exit(2);
  }

  try {
    console.log(off ? await clearAlias(root, { id: secUid }) : await applyAlias(root, { id: secUid, alias: optString(opts, 'alias') }));
  } catch (err) {
    console.error(`error: ${err.message}`);
    process.exit(2);
  }
}

// Tests import this file, so the CLI dispatches only when it is the entry point.
if (isMainModule(import.meta.url)) {
  const [command, ...rest] = process.argv.slice(2);
  const opts = parseArgs(rest);

  if (command === 'resolve') await resolve(opts);
  else if (command === 'write') await write(opts);
  else if (command === 'check-alias') await checkAliasCommand(opts);
  else if (command === 'alias') await move(opts, { off: false });
  else if (command === 'unalias') await move(opts, { off: true });
  else if (command === 'root') console.log(rootFor(opts));
  else {
    console.error(
      `error: unknown command '${command ?? ''}' (expected resolve|write|check-alias|alias|unalias|root)`,
    );
    process.exit(2);
  }
}
