/**
 * listing.mjs — what is already archived under a root.
 *
 * The one question in this skill that is about the archive rather than about an
 * account: somebody has come back to a project and wants to know what is in it
 * before naming anything. So this walks every platform, where everything else
 * here is threaded with one platform's descriptor.
 *
 * It reads and never writes — no stamp, no folder, no repair of a stale alias
 * map. A listing is how a user decides what to do next, so the one thing it must
 * not do is change what it is describing.
 *
 * It also runs before any platform is loaded, which is what lets it answer on a
 * machine with no yt-dlp, no gallery-dl and no session. Reading the tree is not
 * archiving, and a preflight here would make the question unanswerable exactly
 * when it is most worth asking.
 *
 * **It reports facts and says nothing.** The words belong to `SKILL.md`, because
 * they are read by somebody who typed `/archiver`, has never seen this command
 * line, and may not be reading in English — and a block rendered here would be
 * one fixed English layout for all of them. So an account is reported as what it
 * is: the folder, who it is, how many post folders are on disk, when it last
 * ran, and whether a list is already approved.
 *
 * `dir` and `url` are here for the same reason. Acting on a listing needs the
 * account's folder and the URL it was archived from, and a caller that had to
 * rebuild either out of a platform name and a folder name is a caller that can
 * rebuild them wrong.
 */
import { readdir } from 'node:fs/promises';
import path from 'node:path';

import { accounts } from './account.mjs';
import { checkRoot } from './archiver.mjs';
import { POSTS_DIR, isLanded, postIdFromFolder, readArchive } from './landed.mjs';
import { approved, validatePlan } from './plan.mjs';
import { PLATFORMS } from './platforms.mjs';
import { loadPlan, readSync } from './sync.mjs';

/** How many post folders are on disk, which is not the same as how many landed. */
async function countPosts(accountDir) {
  let entries;
  try {
    entries = await readdir(path.join(accountDir, POSTS_DIR), { withFileTypes: true });
  } catch {
    // An account nobody has downloaded into yet has no posts directory, which is
    // an ordinary answer rather than a failure.
    return 0;
  }
  return entries.filter((entry) => entry.isDirectory() && postIdFromFolder(entry.name)).length;
}

/**
 * How many posts a parked plan would still fetch, or null if it would fetch none.
 *
 * Two questions, both answered the way `--go` answers them. Whether the plan is
 * usable is `validatePlan`'s, because reporting a plan `--go` then refuses is
 * how somebody is told 37 are waiting and sent back to the start when they say
 * yes. How many are left is the platforms' `outstanding` rule — a plan is kept
 * after a run that stopped partway precisely so the retry fetches the
 * remainder, so the whole approved list is the wrong number the moment any of
 * it has landed.
 *
 * Null covers both "no usable plan" and "nothing left in it": a plan whose posts
 * have all landed since is one `--go` would finish without fetching anything,
 * and offering it would promise work that is already done.
 */
async function pendingCount(accountDir, { accountId, postIdKey, root, now }) {
  // An account.json with no id is the one place the two could still part: this
  // has nothing to check the plan's account against, while `--go` does — Douyin
  // takes the id straight from the URL it was handed. So an unidentifiable
  // folder reports nothing, which costs a `--plan` and never a refusal.
  if (!accountId) return null;

  const plan = await loadPlan(accountDir);
  if (!validatePlan(plan, { accountId, root, now }).ok) return null;

  const archive = await readArchive(accountDir);
  const left = approved(plan).filter((post) => !isLanded(archive.get(post[postIdKey]))).length;
  return left === 0 ? null : left;
}

/**
 * Every account archived under `root`, in the order they are worth reading.
 *
 * Ordering is here rather than left to the caller because it is a fact about the
 * archive: grouped by the platform registry's order and, within a platform, most
 * recently run first — somebody who opens this has come back to whatever they
 * last touched. Accounts that have never run have nothing to sort by and fall to
 * the end in name order, which at least does not shuffle between runs.
 */
export async function readAccounts(root, { now = Date.now() } = {}) {
  const found = [];

  for (const platform of PLATFORMS) {
    const here = [];
    for await (const [dir, json] of accounts(platform.account, root)) {
      const accountId = json.account?.id ?? null;
      here.push({
        platform: platform.name,
        folder: path.basename(dir),
        dir,
        nickname: json.account?.nickname ?? null,
        url: json.url ?? null,
        posts: await countPosts(dir),
        last_run: (await readSync(dir))?.last_run?.at ?? null,
        to_fetch: await pendingCount(dir, { accountId, postIdKey: platform.postIdKey, root, now }),
      });
    }

    here.sort(byRecency);
    found.push(...here);
  }

  return found;
}

function byRecency(a, b) {
  if (a.last_run && b.last_run) return b.last_run.localeCompare(a.last_run);
  if (a.last_run) return -1;
  if (b.last_run) return 1;
  return a.folder.localeCompare(b.folder);
}

/**
 * The whole answer for one root.
 *
 * The schema is checked first and the run is abandoned if this build cannot read
 * it, because a newer layout may file accounts somewhere this walk does not look
 * — and a partial archive reported as the whole one is worse here than anywhere
 * else, since the next thing that happens is somebody choosing from it.
 *
 * `root` is returned rather than left to the caller to remember: it is the one
 * fact in a listing the user might disagree with — wrong project, or an archive
 * made under a different `--archives` — so whoever reports this has to be able
 * to say where it looked, including when there is nothing there to say it about.
 */
export async function listArchive(root, { now = Date.now() } = {}) {
  await checkRoot(root);
  return { root, accounts: await readAccounts(root, { now }) };
}
