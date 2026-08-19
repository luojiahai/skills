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
import { Refusal } from './errors.mjs';

export const ACCOUNT_FILE = 'account.json';
export const ACCOUNT_VERSION = 1;

/**
 * A platform's descriptor, threaded through every function here as an explicit
 * argument rather than closed over. Two things vary between platforms and
 * nothing else does:
 *
 *   platform   the folder its accounts live under, inside the shared root
 *   handleKey  what `account.json` calls the readable handle — `douyin_id`
 *              for Douyin, `handle` for X
 *
 * Explicit because it is greppable: a descriptor threaded through argument
 * lists can be followed from the registry to the call, where a bound closure
 * would only show at the point it was made. The descriptors themselves live in
 * `platforms.mjs`, beside the registry that decides which one a URL means.
 *
 * The platform folder is also the collision barrier: two platforms, two
 * folders, so an X user id and a sec_uid cannot name the same directory — and an
 * alias chosen on one cannot collide with one chosen on the other.
 */

/** Every account one platform has archived, whatever their ids. */
export const platformDir = ({ platform }, root) => path.join(root, platform);

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
 * archive, and Douyin accounts are commonly Chinese, so letters means
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
 * The entry point raises this before the archives root is even resolved and
 * checkAlias reaches it again afterwards; two copies of a refusal like this is
 * how the two come to describe different rules.
 */
export function aliasShapeRefusal(alias) {
  return new Refusal(
    'alias-invalid',
    `${JSON.stringify(String(alias ?? ''))} cannot be an alias — letters, digits, dots, dashes ` +
      'and underscores; no spaces, no slashes, and not starting with a dot',
    { details: { alias: String(alias ?? '') } },
  );
}

/** Where this account's folder is if it has no alias, whether or not it exists. */
export function accountDirFor(descriptor, root, accountId) {
  if (!isSafeId(accountId)) {
    throw new Refusal(
      'unsafe-account-id',
      `refusing to use ${JSON.stringify(String(accountId ?? ''))} as an account folder name`,
      { details: { id: String(accountId ?? '') } },
    );
  }
  return path.join(platformDir(descriptor, root), String(accountId));
}

/** Where an aliased folder is, whether or not it exists yet. */
export function aliasDirFor(descriptor, root, alias) {
  if (!isSafeAlias(alias)) throw aliasShapeRefusal(alias);
  return path.join(platformDir(descriptor, root), String(alias));
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
 * keeps an archive holding this shape and nothing else — a key spread in from
 * the file being merged would live on in it with nothing to stop it.
 */
const accountKeys = ({ handleKey }) => ['id', handleKey, 'nickname', 'alias'];

function identity(descriptor, existing, next, drop) {
  const merged = { ...known(existing), ...known(next) };
  for (const key of drop) delete merged[key];
  return Object.fromEntries(accountKeys(descriptor).filter((key) => key in merged).map((key) => [key, merged[key]]));
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
export function mergeAccount(descriptor, existing, next, { drop = [] } = {}) {
  return {
    version: ACCOUNT_VERSION,
    platform: descriptor.platform,
    account: identity(descriptor, existing?.account, next?.account, drop),
    // A write with no url leaves the recorded one alone rather than blanking it.
    url: next?.url || existing?.url || null,
  };
}

/** An account folder's identity, or null if it has none. */
export async function readAccount(dir) {
  return readJson(path.join(dir, ACCOUNT_FILE));
}

export async function writeAccount(descriptor, dir, next, options) {
  const merged = mergeAccount(descriptor, await readAccount(dir), next, options);
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
export async function recordIdentity(descriptor, root, dir, { account, url = null } = {}) {
  // The folder's own account.json is consulted for the id when the caller has
  // none — a run that collected nothing has only whatever the plan carried, and
  // that can be blank. Taking the caller's word would skip the map silently,
  // leaving account.json holding an alias archiver.json has never heard of. The
  // folder always knows whose it is.
  const existing = await readAccount(dir);
  const id = String(account?.id ?? existing?.account?.id ?? '');
  const base = path.basename(dir);
  const alias = base !== id && isSafeAlias(base) ? base : null;

  const merged = await writeAccount(
    descriptor,
    dir,
    { account: { ...account, alias }, url },
    alias ? undefined : { drop: ['alias'] },
  );

  if (id) {
    const recorded = (await readAliases(root, descriptor.platform))[id] ?? null;
    if (recorded !== alias) await writeAlias(root, descriptor.platform, id, alias);
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
 * A file this build cannot read is skipped rather than guessed at: it reads as
 * no archive at all, which is the same answer as a folder nobody has archived
 * into.
 */
export async function* accounts(descriptor, root) {
  let entries;
  try {
    entries = await readdir(platformDir(descriptor, root), { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(platformDir(descriptor, root), entry.name);
    const json = await identityAt(dir);
    if (json) yield [dir, json];
  }
}

/**
 * An account folder, as everything a caller needs in order to act on it.
 *
 * The path is what the rest of the skill wants — the archive, the plan, the post
 * folders and the document all take it — so this is a plain object rather than
 * anything a caller has to unwrap. What it adds is the identity the lookup
 * already read on its way to the folder, so nobody has to open account.json a
 * second time to learn whose folder they were just handed.
 *
 * `account` and `url` are null where there was no file to read them from — a
 * folder for an account nothing has archived yet. A caller that needs the
 * identity as of *now* rather than as of the lookup reads it itself; what is
 * here is what the folder said when it answered to being this account's.
 */
function folderOf(dir, json) {
  return {
    dir,
    id: String(json?.account?.id ?? '') || null,
    account: json?.account ?? null,
    url: json?.url ?? null,
  };
}

/**
 * Where this account's folder is, now that its id is known.
 *
 * Resolved, never computed. The folder may be named for an alias, and going
 * straight to the id would quietly start a second, empty archive beside the real
 * one on every aliased account. Only an account nothing has archived yet gets a
 * computed path — under the alias asked for if there is one, and under its id if
 * not.
 *
 * The folder need not exist. This says where it goes, which is what a caller has
 * to know before it can read the archive there or create it.
 *
 * An id this build will not put in a path is answered as `{ ok: false }` rather
 * than thrown. A run settles the folder inside its listing's row loop, where a
 * throw surfaces as an unexplained stream failure instead of the refusal the
 * user is owed — and the wording of that refusal is the platform's, since only
 * it can say what it reported an id for.
 *
 * `movingTo` is where filing would put this folder, or null when no rename was
 * asked for. It is answered here, from the same id and the same flags the move
 * itself will use, so a plan cannot announce a destination that filing would not
 * produce.
 */
export async function settleFolder(descriptor, root, { id, alias, unalias } = {}) {
  if (!isSafeId(id)) return { ok: false, reason: 'unsafe-id', id: String(id ?? '') };

  const movingTo = aliasTarget(descriptor, root, { id, alias, unalias });
  const found = await resolveFolder(descriptor, root, { id });
  if (found) return { ok: true, folder: found, movingTo };

  const dir = alias ? aliasDirFor(descriptor, root, alias) : accountDirFor(descriptor, root, id);
  return { ok: true, folder: { dir, id: String(id), account: null, url: null }, movingTo };
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
async function resolveFolder(descriptor, root, { id } = {}) {
  const wanted = String(id ?? '');
  if (!wanted) return null;

  const mapped = (await readAliases(root, descriptor.platform))[wanted];
  if (mapped && isSafeAlias(mapped)) {
    const dir = aliasDirFor(descriptor, root, mapped);
    const json = await identityAt(dir);
    if (String(json?.account?.id ?? '') === wanted) return folderOf(dir, json);
  }

  if (isSafeId(wanted)) {
    const dir = accountDirFor(descriptor, root, wanted);
    const json = await identityAt(dir);
    if (String(json?.account?.id ?? '') === wanted) return folderOf(dir, json);
  }

  for await (const [dir, json] of accounts(descriptor, root)) {
    if (String(json.account?.id ?? '') === wanted) return folderOf(dir, json);
  }

  return null;
}

export async function resolveAccountDir(descriptor, root, { id } = {}) {
  return (await resolveFolder(descriptor, root, { id }))?.dir ?? null;
}

/**
 * The folder for an account whose id we do not know, or null.
 *
 * `--go` collects nothing, so it never learns the numeric id and cannot go
 * straight to the folder the way a plan can.
 *
 * An `--alias` is tried directly first — as a path, then through the mapping —
 * because the user named that folder and the name is enough to open it without
 * reading anything else. Everything else is settled in one pass over the account
 * folders, which match in the order of how much each proves:
 *
 *   url     the very URL the archive was made from — exact, survives a rename
 *   alias   theirs, recorded in account.json
 *   handle  what the account is called today — right until it is renamed
 *
 * One pass rather than three, because the answer is wanted once and three passes
 * would each stop at a different folder.
 */
export async function findFolder(descriptor, root, { id, url, alias, handle } = {}) {
  // An id, where the caller has one, settles it outright: resolveFolder answers
  // only once account.json there names this account, so a non-null answer is the
  // identity check as well as the lookup. The keys below match on what a folder
  // says about itself, which a folder belonging to somebody else can also say.
  if (id) {
    const folder = await resolveFolder(descriptor, root, { id });
    if (folder) return folder;
  }

  if (alias && isSafeAlias(alias)) {
    const dir = aliasDirFor(descriptor, root, alias);
    const json = await identityAt(dir);
    if (json) return folderOf(dir, json);

    for (const [id, name] of Object.entries(await readAliases(root, descriptor.platform))) {
      if (name !== alias || !isSafeId(id)) continue;
      const byId = accountDirFor(descriptor, root, id);
      // The id has to match as well as the folder existing. This whole branch
      // is reached because the map turned out to be stale, and a map that is
      // wrong about where an account is can be wrong about whose folder it is
      // pointing at.
      const mine = await identityAt(byId);
      if (String(mine?.account?.id ?? '') === id) return folderOf(byId, mine);
    }
  }

  const found = { alias: null, handle: null };

  for await (const [dir, json] of accounts(descriptor, root)) {
    if (url && json.url === url) return folderOf(dir, json);
    if (alias && json.account?.alias === alias) found.alias ??= folderOf(dir, json);
    if (handle && json.account?.[descriptor.handleKey] === handle) found.handle ??= folderOf(dir, json);
  }

  return found.alias ?? found.handle ?? null;
}

export async function findAccountDir(descriptor, root, keys = {}) {
  return (await findFolder(descriptor, root, keys))?.dir ?? null;
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
export async function existingIds(descriptor, root) {
  const aliases = await readAliases(root, descriptor.platform);
  const names = new Set(Object.values(aliases));
  const ids = new Set(Object.keys(aliases));

  try {
    for (const entry of await readdir(platformDir(descriptor, root), { withFileTypes: true })) {
      if (entry.isDirectory() && !names.has(entry.name)) ids.add(entry.name);
    }
  } catch {
    // Nothing archived on this platform yet, so nothing is spoken for.
  }

  return ids;
}

/**
 * An alias is decided in three moments, and they are one protocol.
 *
 * `checkAliasShape` needs neither the filesystem nor the archives root, so a
 * typo is refused by argument parsing rather than after a full timeline crawl.
 * `checkAlias` answers everything the archives root alone can settle, which is
 * why a run may ask it before it fetches anything — but it is answered against
 * whatever id is knowable without a fetch, so it is marked provisional.
 * `confirmAlias` asks again with the id the listing brought back, and takes the
 * provisional verdict as an argument: a caller that reaches the second moment
 * without having passed the first is missing an argument rather than breaking a
 * convention, and promising a move that `--go` would then refuse is worse than
 * stopping.
 */
export function checkAliasShape(alias) {
  return isSafeAlias(alias) ? { ok: true, alias } : { ok: false, refusal: aliasShapeRefusal(alias) };
}

export async function checkAlias(descriptor, root, { id = null, alias } = {}) {
  return { ...(await decideAlias(descriptor, root, { id, alias })), alias, provisional: true };
}

export async function confirmAlias(descriptor, root, provisional, { id, alias } = {}) {
  // A plain Error rather than a Refusal: this is a caller that skipped the first
  // moment, and reporting a bug in the skill as the user's mistake would send
  // them off to fix an alias that is fine.
  if (provisional?.provisional !== true || provisional.alias !== alias) {
    throw new Error(`an alias is confirmed against the provisional verdict taken for it, not ${JSON.stringify(alias)} alone`);
  }
  if (!provisional.ok) return { ok: false, refusal: provisional.refusal, alias };
  return { ...(await decideAlias(descriptor, root, { id, alias })), alias };
}

/**
 * Whether `alias` may be given to `id`, as `{ ok: true }` or
 * `{ ok: false, refusal }`.
 *
 * `id` may be null when the account has never been archived: a name already
 * taken is then taken by definition, because it cannot be taken by us.
 */
async function decideAlias(descriptor, root, { id = null, alias } = {}) {
  if (!isSafeAlias(alias)) return { ok: false, refusal: aliasShapeRefusal(alias) };

  const mine = id === null ? null : String(id);

  for (const [other, name] of Object.entries(await readAliases(root, descriptor.platform))) {
    if (name === alias && other !== mine) return { ok: false, refusal: aliasTaken(alias, other) };
  }

  // The folder is asked whose it is before the id set is consulted, and an
  // occupant that is *us* settles the question. `existingIds` reads every
  // directory the map does not name as an id, so with archiver.json deleted or
  // stale — both of which the archive is meant to survive — an account's own
  // alias folder would otherwise count as somebody else's id and lock the user
  // out of the name they chose, permanently and with a message that is untrue.
  const occupant = await identityAt(aliasDirFor(descriptor, root, alias));
  const occupantId = String(occupant?.account?.id ?? '');
  if (occupantId && occupantId !== mine) return { ok: false, refusal: aliasTaken(alias, occupantId) };
  if (occupantId && occupantId === mine) return { ok: true };

  if ((await existingIds(descriptor, root)).has(alias) && alias !== mine) {
    return {
      ok: false,
      refusal: new Refusal(
        'alias-is-other-id',
        `${JSON.stringify(alias)} is another account's id on this platform, so it cannot be an alias — ` +
          'an un-aliased account is filed under its id, and this alias would one day want that folder',
        {
          details: { alias },
          remedy: { message: 'choose a different name for this folder', run_by: 'user' },
        },
      ),
    };
  }

  return { ok: true };
}

function aliasTaken(alias, holderId) {
  return new Refusal(
    'alias-taken',
    `the alias ${JSON.stringify(alias)} already belongs to the account with id ${holderId}`,
    {
      details: { alias, holder_id: String(holderId) },
      remedy: { message: 'choose a different name for this folder', run_by: 'user' },
    },
  );
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
export async function applyAlias(descriptor, root, { id, alias }) {
  const wanted = String(id);
  const target = aliasDirFor(descriptor, root, alias);
  const current = await resolveAccountDir(descriptor, root, { id: wanted });

  if (current === target) return target;

  if (await exists(target)) {
    const occupantId = String((await identityAt(target))?.account?.id ?? '');

    if (occupantId !== wanted) {
      throw new Refusal(
        'alias-target-occupied',
        `${target} already exists, and it is not this account's — ` +
          `${occupantId ? `it belongs to the account with id ${occupantId}` : 'it holds no account.json this build can read'}. ` +
          'Nothing has been moved',
        {
          details: { target, occupant_id: occupantId || null },
          remedy: { message: 'choose another name, or move that folder aside first', run_by: 'user' },
        },
      );
    }

    if (current) {
      throw new Refusal(
        'account-in-two-folders',
        `this account is in two folders at once — ${current} and ${target}. ` +
          'Nothing has been moved, and nothing here will merge them',
        {
          details: { dirs: [current, target] },
          remedy: { message: 'keep the folder you want and remove the other', run_by: 'user' },
        },
      );
    }

    return target;
  }

  if (current) await move(current, target);
  return target;
}

/**
 * A rename that answers with a code rather than a stack.
 *
 * `ENOTEMPTY` is a target another run created between the check above and this
 * line — a real race, not a hypothetical one. `EXDEV` is an archives root
 * spanning two mounts, and `EACCES` a folder somebody has made read-only. All
 * three arrive here as a plain Error, which `refusalFields` re-throws and the
 * dispatcher reports as "the archiver crashed" with a stack — for a situation
 * the user can put right in one command.
 */
async function move(from, to) {
  try {
    await rename(from, to);
  } catch (error) {
    throw new Refusal(
      'alias-move-failed',
      `could not move ${from} to ${to}: ${error?.message ?? error}`,
      {
        details: { from, to, errno: error?.code ?? null },
        remedy: {
          message: 'move the folder by hand, or choose a name whose folder is free',
          run_by: 'user',
        },
      },
    );
  }
}

/**
 * Take the alias off, putting the folder back under the account's id.
 *
 * The counterpart to applyAlias and the only way to remove an alias, because a
 * blank `--alias` cannot mean it — every run passes flags it has no value for,
 * so an empty one has to read as silence.
 *
 * Moves and no more, as applyAlias does. Filing is what records, so both halves
 * of a rename are written by the one act rather than by whichever of these two
 * was reached.
 */
export async function clearAlias(descriptor, root, { id }) {
  const wanted = String(id);
  const target = accountDirFor(descriptor, root, wanted);
  const current = await resolveAccountDir(descriptor, root, { id: wanted });

  if (current && current !== target) {
    if (await exists(target)) {
      throw new Refusal(
        'unalias-target-occupied',
        `${target} already exists, so this account cannot be filed under its id again. ` +
          'Nothing has been moved',
        {
          details: { target },
          remedy: { message: 'move that folder aside, then try again', run_by: 'user' },
        },
      );
    }
    await move(current, target);
  }

  return target;
}

/**
 * Where `--alias`/`--unalias` would put this account's folder, or null when
 * neither was asked for.
 *
 * Only ever *computed*. The move itself belongs to `--go`: a `--plan` that
 * silently reorganised the archive would be a preview that lied, and a rename
 * between the two invalidates nothing, because a plan records the archives root
 * and the account — never the folder it is sitting in.
 *
 * An id or an alias this build would refuse as a folder name yields null rather
 * than throwing. The refusal itself belongs to the run, which says so properly
 * long before a block is rendered; a preview is not the place to raise it.
 */
function aliasTarget(descriptor, root, { id, alias, unalias }) {
  try {
    if (unalias) return id ? accountDirFor(descriptor, root, id) : null;
    return alias ? aliasDirFor(descriptor, root, alias) : null;
  } catch {
    return null;
  }
}

/**
 * The rename a run was asked for, performed — the folder it was already in when
 * nothing was asked for, or when there is no id to rename against.
 */
async function moveFolder(descriptor, root, accountDir, { id, alias, unalias }) {
  if (!id || !(alias || unalias)) return accountDir;
  const moved = unalias
    ? await clearAlias(descriptor, root, { id })
    : await applyAlias(descriptor, root, { id, alias });
  return moved ?? accountDir;
}

/**
 * Filing: putting this account's folder where its name says it goes, and
 * recording that it is there.
 *
 * One act, because the two must agree. A folder that has moved while
 * account.json still names the old place — and archiver.json still maps the id
 * to it — is the disagreement this layout exists to prevent, and leaving the
 * record to a later call is what opens the window for it. Do not split these
 * again to record after some work in between: whatever that work is can fail,
 * and the folder will have moved anyway.
 *
 * The move goes first and the record follows, because the tree is the truth and
 * the map is the cache: a crash between them leaves a folder whose next write
 * adopts it, while the other order would leave the index ahead of reality.
 *
 * Every approved run files, including one that found nothing new to fetch. An
 * alias is a thing the user asked of the archive, not a reward for having
 * downloaded something: announcing the move and skipping it leaves the folder
 * under its id and the next run announcing the same move again.
 */
export async function fileAccount(descriptor, root, folder, { id, account, url = null, alias, unalias } = {}) {
  const dir = await moveFolder(descriptor, root, folder.dir, { id, alias, unalias });
  const identity = await recordIdentity(descriptor, root, dir, { account, url });
  return {
    dir,
    id: String(identity.account?.id ?? '') || null,
    account: identity.account,
    url: identity.url,
  };
}
