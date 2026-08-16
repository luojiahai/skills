# douyin-archiver scripts

Read this before changing anything here. The constraints below are why the
design looks the way it does; each was verified against the live site, and
several of the obvious simplifications do not work.

Some of what follows is written in the past tense, about bugs that were fixed.
Those passages keep the names things had at the time: this skill was
`douyin-downloader` until this rename, its entry point was `download.sh`, and its
root directory was `downloads/`.

## Constraints

**yt-dlp cannot enumerate an account.** It ships exactly one Douyin extractor,
matching only `https://www.douyin.com/video/<id>`. There is no `douyin:user`
(unlike TikTok, which has `tiktok:user`), so a `/user/...` URL yields nothing —
IDs have to be collected separately.

**The feed API cannot be called directly.** `/aweme/v1/web/aweme/post/` requires
an `a_bogus` signature computed by obfuscated page JS. Without it the endpoint
returns **HTTP 200 with a zero-byte body** — a silent block, not an error. That
is why collection drives a real browser: the page signs its own requests.

**Your everyday Chrome cannot be automated.** Since Chrome 136,
`--remote-debugging-port` is refused on the default profile. Hence a dedicated
Playwright Chromium against its own profile directory (see *Where things live*).

**The profile grid requires a login.** Anonymously, the header still reports the
video count while the grid renders zero cards. `--login` establishes the session
once; it persists, and later runs work headless.

**Footer links are other people's videos.** The page footer carries SEO
recommendations tagged `?source=Baiduspider`. Harvesting all `/video/` links
without filtering collects strangers' uploads — an early version did exactly
that, returning 7 videos, none of them the account's.

**Grid class names are obfuscated and rotate** (`a.RZuwF26I`, `div.gsF4XxDR`).
Filter structurally — exclude `footer`, exclude the SEO marker — never by class.

**A shell function called under `||` runs with errexit off.** `run_plan … ||
status=$?` read like status capture; it was bash turning `set -e` off for the
whole function body — a refused plan printed its refusal and then *kept going*,
through the metadata write and a bogus summary telling the user to re-run the
`--go` that had just failed. So `run_plan` is invoked plainly, failure exiting
the script through errexit, and the plan load carries its own `|| return $?`
so the refusal holds even if a guarded call sneaks back in. `download_list` is
the one function still called under `||`: it manages `set +e` around its
pipeline itself and returns an explicit status, which is the pattern that
makes such a call safe.

**The pauses are what let a long run finish.** `download-douyin.sh` runs yt-dlp
with `--sleep-requests 2 --sleep-interval 3 --max-sleep-interval 8`. Douyin
rate-limits hard: an unthrottled batch starts failing partway through and can
get the session challenged. Tuning these down to make a run finish faster is
what stops it finishing.

## Files

**This skill archives; the tools it drives download.** The split is the reason
there are two shell scripts and not one. `archive.sh` owns the account — which
folder it lives in, what is already on disk, what is missing, and whether the
user has said yes — and knows nothing about how bytes arrive.
`download-douyin.sh` takes a list of URLs and fetches them, and knows nothing
about accounts. yt-dlp is a downloader and is named as one throughout; it cannot
resume an account, which is the whole reason this layer sits above it. The
filenames are the only place that boundary is written down, so
`download-douyin.sh` keeps its name deliberately — renaming it to match the
skill would erase the distinction it exists to mark.

| File | Role |
| --- | --- |
| `archive.sh` | Entry point. Owns folder, plan and metadata policy. Everything else is called by it. |
| `download-douyin.sh` | General-purpose layer: a list of URLs/IDs in, one folder per post out, with throttling. Knows nothing about accounts. |
| `collect-douyin-ids.mjs` | Drives Playwright, scrolls the profile, emits post URLs and profile metadata. |
| `export-cookies.mjs` | Exports the Playwright session as a Netscape `cookies.txt` for yt-dlp. |
| `plan.mjs` | The confirm step: diffs the collected list against what is on disk, records the account in `account.json` on the way past, and renders **every** block the skill prints. |
| `landed.mjs` | What is already downloaded, answered from the post folders themselves. The layout rules, shared with x-archiver. |
| `cli.mjs` | The argument parsing, file reading, atomic JSON writing and entry-point detection the other modules share. |
| `account.mjs` | Where an account's folder is (`douyin/<sec_uid>`); owns the shape of `account.json` and how it merges; answers what the archives root is. Called by both `plan.mjs` and `archive.sh`. |
| `post.mjs` | The shape of `post.json` — the shape `download-douyin.sh`'s yt-dlp template has to produce — and whether a post holds every file it lists. |
| `sync.mjs` | `sync.json`: the parked plan and the last run's history. Deletable without loss. |
| `archiver.mjs` | The archives root's schema version, and the refusal when it is one this build cannot read. Also a `check` CLI, since the run here is driven from bash. |
| `paths.mjs` | Single source of truth for where state lives and how Playwright is found. |
| `collect-douyin-ids.js` | A DevTools console snippet that harvests `/video/` ids — a no-dependency fallback if Playwright breaks. It does **not** track `collect-douyin-ids.mjs`: it has no profile-metadata read, no `--limit`, and no image-post counting, so it emits ids and nothing else. |

## State files, disjoint on purpose

The **post folders under `posts/`** are the sole record of what has downloaded.
`account.json` is **authoritative for identity** — which folder is this
account's — and **never for progress**.

They deliberately do not both track downloads. If they did, a run that failed
between writing one and the other would leave the identity file claiming posts
that were never fetched, and the error would be silent and permanent. That is
why nothing here records a newest post or a collected count: both would be a
second answer to a question `posts/` already answers correctly.

`post.json` inside a post folder is not a second record either, because it is
written **before** the media rather than after. It describes the post; whether
the post landed is still answered by looking for the files it names. That is
also what finally gives this skill an expected file count — yt-dlp reports none
for Douyin, so before it, "downloaded" could only mean "the folder holds at
least one file", and a post whose media failed after its text was written read
as complete.

`sync.json` is a third file but not a third source of truth: it holds a cache of
one collection pass and a note of what the last run did, and **deleting it loses
no archive content**. Every question it answers is re-derived from disk next
time. A resumption cursor would break that sentence and is deliberately absent —
it is the same mistake as `.archive.txt` below, wearing a newer name.

There used to be a fourth, `.archive.txt`, and removing it is why this file
changed. yt-dlp's `--download-archive` keys on ids, not paths, so it kept
reporting a post as downloaded after its files had been deleted — a user who
removed a bad download got silence instead of a re-fetch. `--no-overwrites`
keys on the resolved path instead, which is what makes `rm -rf` on a post
folder mean "fetch this again".

## Plan, then go

Nothing about an account can be reported before it is collected — not the
nickname, not the video count, and certainly not how many are new. So the run
is split: `--plan` collects, diffs and reports; `--go` downloads what the
report described. In between, the list waits in `<folder>/sync.json`, which is
why confirming costs no second collection and why what is fetched is exactly
what was shown.

`--go` runs no collection pass, and needs none: the `sec_uid` is in the profile
URL and the `sec_uid` *is* the folder, so the account's directory is known
outright rather than found by scanning. The parked plan carries identity too,
but only as a guard for `validatePlan`; nothing looks a folder up by it. The
only browser it can open
is `export-cookies.mjs`, and only when the cached cookies are missing or yt-dlp
has just rejected them.

A plan is refused rather than repaired when it is missing, older than 24h, or
written for another account, root or folder. The alternative to refusing is
downloading a list the user never approved. It is deleted once every video in
it has landed, and kept when a run stops partway, so a retry re-fetches only
what is missing.

`--yes` does both halves in one process, for using the scripts by hand. The
skill never reaches for it — an agent asks — but it outranks a `--plan` or
`--go` that comes after it on the command line, so a user who typed it keeps
their pre-authorisation when the skill appends its own mode flag.

Every block printed — the one approved, and the one a finished run reports — is
rendered by `plan.mjs`, and what is on disk is counted in exactly one place
(`landed.mjs`'s `onDiskIds`). They were briefly three
hand-aligned copies across two languages, with `wc -l` counting in one of them
and unique ids in another; a blank line in the old `.archive.txt` was enough to
make a run contradict the number the user had approved.

`load` re-checks the plan against disk before handing it on. Without that, a
`--go` resumed after a partial run would pay a metadata request per post just
to discover it was already there — the fast resume the archive file used to
give, restored without a second record.

## The archives root is computed once

`paths.mjs` owns it — `normalizeRoot` for an explicit `--archives` (tilde
expanded, made absolute, symlinks resolved as far as the path exists) and
`archivesRoot` for the default. `archive.sh` asks for it through
`account.mjs root` rather than recomputing it in shell, because a root that
disagrees between the two languages names a different account folder and
silently re-downloads everything.

The symlink resolution is not fussiness: on macOS the default root comes back
as `/private/tmp/...` while a hand-typed `--archives /tmp/...` would not, and
a plan made one way would then be refused the other.

## No early-stop

Collection always scrolls the whole feed. An earlier design stopped once it hit
already-downloaded IDs, which is unsafe — Douyin pins up to 3 posts at the top
regardless of age, so a stop-at-first-known rule halts immediately and collects
nothing, forever, silently.

It is also not worth defending against: a full scroll of a 284-video account
measures **~34 seconds**, while downloads take 30–40 minutes and are already
deduped against the post folders on disk. If you ever point this at an account
with thousands of posts, revisit — a `--fast` opt-in would be the shape to
add.

## Counts will not match

Three numbers describe one account and none of them measure the same thing:
`reported` is the `作品 N` in the profile header, `collected` is the downloadable
cards a pass actually harvested, and `on disk` / `total` is post folders holding
media.

They part company in both directions, and a block notes each gap rather than
leaving a disagreeing pair of numbers looking like an error:

- **`collected < reported`** — `作品 N` counts posts that never render as cards:
  private, deleted, region-locked. The 284-video account used in testing
  collects 282 on every run, reproducibly.
- **on disk > collected** — no run ever removes a post. A post the account
  stops showing stays downloaded, and from then on the folder outnumbers the
  profile: `1 archived post no longer on the profile`. (Deleting a post folder
  by hand is the one thing that shrinks an archive, and it is how you ask for
  that post again.)
- **image posts are counted, never collected** — 图文 posts link as `/note/<id>`
  and nothing here can fetch them yet (issue #39). They are reported as skipped
  and subtracted before the `counted but not shown` gap is worked out, so the
  same posts are not blamed twice.

That second note claims only what was observed, an id here and not in the
listing. Deleted, hidden, region-locked, and missed by a collection that stopped
short are indistinguishable without fetching each one.

No gap is recorded anywhere. A remembered count is a second account of what has
downloaded sitting beside the folders themselves, which is the drift "State
files, disjoint on purpose" exists to prevent, so each is re-derived from the
collected list and the disk every run. Hence `summary` needs the parked plan's
`collected` **list** rather than its count, and a plan written before that list
existed prints no note rather than a wrong one.

## Where things live

Nothing mutable hangs off the skill directory. It may be installed read-only,
sit inside a plugin directory that updates replace, or be moved anywhere — so
paths are never derived from its location.

| What | Where | Why |
| --- | --- | --- |
| session, cookies, `node_modules` | `${XDG_STATE_HOME:-~/.local/state}/douyin-archiver/` | user-level: sign in once, not once per project; survives skill reinstalls |
| archives | `--archives DIR`, else `<git root of cwd, else cwd>/archives/` | project-level: an archive belongs beside the work it is part of, unless the user says otherwise |
| Chromium binaries | `~/Library/Caches/ms-playwright` | shared across every project, so the ~150MB is paid once |

**A cwd inside the skill is not a project.** Asked to run `scripts/archive.sh`,
an agent tends to cd here first — and in a project that is not a git repository,
the root resolved to the skill's own folder. Whole archives landed in
`<project>/.claude/skills/douyin-downloader/downloads/` — the names both had at
the time — where the next update deletes them. So a cwd under the skill
directory is discarded: the project is recovered from the install path
(`<project>/.claude/skills/<skill>` or `.agents/`), and where that names none,
the run stops and asks for `--archives`. Guessing is the one thing it must not
do — a wrong root names a different account folder and silently re-downloads
everything.

The **archives** root is written down once, in `paths.mjs`, and `archive.sh`
asks for it through `account.mjs root` rather than reimplementing the rule — it
is the root that varies per run, and two answers to it would split an account's
archive in half. The `posts/` subdirectory is likewise named in both languages
(`landed.mjs`'s `POSTS_DIR` and `archive.sh`'s `POSTS_SUBDIR`); change one and
change the other. The **state** directory is still spelled out in both languages
(`paths.mjs` and the top of `archive.sh`): it is one unchanging expression,
`${XDG_STATE_HOME:-~/.local/state}/douyin-archiver`, and the shell needs it
before it can afford to start Node. Change it in one place and change it in the
other. `../setup.sh` installs into that directory and is safe to re-run — the
skill's `package.json` is the version manifest, copied in at install time.

Playwright is loaded from the state directory by explicit path, since that is
outside Node's upward module resolution. It is CommonJS, so an import by path
lands its exports on `.default` — `loadPlaywright()` normalises that.

## Tests

The pure logic — the diff, the plan validation rules, the status rendering,
path normalisation, the shared argument parsing, the metadata merge and folder
resolution, and the layout rules in `landed.mjs` — has unit tests, and no
dependencies beyond Node:

```bash
node --test scripts/*.test.mjs
```

Everything else (a real grid, a real session, yt-dlp) is verified by running it
against a live account.

## Manual use

The scripts work standalone if you want them without the skill:

```bash
# establish or refresh the session (opens a window)
node collect-douyin-ids.mjs --login "https://www.douyin.com/user/MS4w..."

# an account, without the two-step confirm
./archive.sh "https://www.douyin.com/user/MS4w..." --archives ~/Videos/douyin --yes

# collect only
node collect-douyin-ids.mjs --headless "https://www.douyin.com/user/MS4w..." -o urls.txt

# download an arbitrary list
./download-douyin.sh -i urls.txt -o ~/Videos/douyin
```

`download-douyin.sh` accepts full `/video/` URLs, `/user/...?modal_id=...` URLs,
and bare numeric IDs interchangeably, and de-duplicates them. Use `-n` to see
the yt-dlp command without running it.

That it takes a single `/video/` URL is plumbing for the account loop, whose
list is made of them, and not a user entry point — `archive.sh` takes profile
URLs only.

## Shared with x-archiver, on purpose

`landed.mjs`, `post.mjs`, `account.mjs`, `sync.mjs` and `archiver.mjs` here have
counterparts of the same name in **x-archiver**, holding the same rules written
twice. The layout both produce:

```
<archives root>/
  archiver.json                 {"schema": 3, "accounts": {…}}
  douyin/<alias, else sec_uid>/ x/<alias, else user id>/
    account.json
    sync.json
    posts/<YYYY-MM-DD|undated>_<id>/
      post.json
      1.mp4
```

- `posts/<YYYY-MM-DD|undated>_<id>/`, one folder per post, `undated` a literal
- media numbered by position — `1.mp4`
- `post.json`: `version`, `id`, `permalink`, `timestamp`, `text`, `reply_to`,
  `media`, in that order and holding nothing else. Written **before** the media.
  `media[].url` and `media[].id` are optional and often absent.
- a post counts as downloaded when every file its `post.json` lists is present
- the account folder is the account's `--alias` if it has one and its immutable
  id if it does not, under a platform folder — because both skills default to the
  same `<git root>/archives` root, and an alias chosen on one platform must not
  be able to collide with one chosen on the other.
- an alias is refused if it is another account's id on that platform, or already
  another account's alias. Letters (`\p{L}`, so CJK), digits, `.`, `_`, `-`;
  no spaces, no separators, no leading dot, 128 chars.
- `account.json`'s `alias` is always `basename(dir)`, written from the folder
  rather than from the flag. That is the whole of "the folder's location wins":
  a directory renamed by hand is adopted by the next write, and the two cannot
  drift. An empty `--alias` is silence; `--unalias` is the removal.
- a rename is three writes in one order — the folder, then `account.json` inside
  it, then `archiver.json` — because the tree is the truth and the root file is
  a cache. A crash before the last one is repaired by the next scan. `--plan`
  never moves anything; `--go` does.
- `account.json` beside `posts/`, holding `version`, `platform`, `account` and
  `url` and nothing else — authoritative for identity, never for progress. The
  alias is a key *inside* `account`, beside the id, so the file stays four keys
  wide. Both
  write it when the folder is resolved, both merge into what is already there,
  and both treat a blank as silence rather than an erasure.
- `sync.json` beside it, holding `version`, `plan` and `last_run`. Deleting it
  loses no archive content.
- `archiver.json` at the root, holding the schema version and `accounts`, an
  id → alias map nested per platform. Absent reads as current; unknown stops the
  run; **schema 2 is readable and upgraded in place**, since every schema-2
  folder is a legal un-aliased schema-3 one. An account with no alias has no
  entry. A mapping entry pointing at a folder that is not there is a stale cache
  line and self-heals; a file that cannot be *parsed* stops the run, because it
  may be a schema from the future and rebuilding it would clobber it.

They are duplicated rather than shared. A skill is a self-contained folder under
`skills/`, distributed and symlinked on its own, so there is nowhere a shared
module could live that is still a skill. **Change a rule here and change it
there** — the two archives are meant to be readable with one mental model, and
the duplication is only worth its cost while they agree. The specification lives
in the issue tracker; these two blocks are what ships.

Four deliberate differences:

- **`post.json` is written by yt-dlp here, and in JS there.** `--print-to-file`
  fires after extraction and before the download, which is exactly when the file
  has to appear; doing it from Node would cost a second metadata request per
  post against a hard rate limiter. So `POST_TEMPLATE` in `download-douyin.sh`
  assembles the JSON, every user-text field passed through yt-dlp's `j`
  conversion, and `landed.test.mjs` pins the template — driving the real yt-dlp
  through `--load-info-json`, which needs no network — against the shape
  `post.mjs` reads back. So the two `post.mjs` modules agree on the *file* and
  differ in their API: x-archiver's owns `toTimestamp` and `mediaEntry` and takes
  media as `{num, ext, …}`, because it is the thing turning gallery-dl's rows
  into filenames; this one has neither and takes `{file, …}`, because by the time
  anything in Node sees a media entry the name has already been decided by the
  template.
- **The junk-file problem solved itself.** `countMedia` used to match the
  positional `<n>.<ext>` shape rather than excluding known junk, because yt-dlp
  can leave `1.f137.mp4` / `1.f140.m4a` behind when a stream merge fails —
  whole files that made an unplayable post read as finished. Against a named
  list of expected files, none of those is `1.mp4`, so no rule is needed for
  them at all.
- **x-archiver *builds* its folder names in JS (`naming.mjs`). Here nothing
  does** — yt-dlp's `POST_DIR` output template builds them, and `landed.mjs`
  only reads them back. That is two spellings of one rule in two languages, so
  `landed.test.mjs` reads the template out of the shell script and checks the
  regex still accepts what it produces.
- **`assets/` is x-only.** gallery-dl puts the avatar and banner URLs on rows
  x-archiver already reads. Nothing here reads Douyin's out of the profile page
  yet, so the directory is simply absent — the layout allows it to be.

`--print-to-file` appends and has no overwrite mode, so `download-douyin.sh`
clears a post's `post.json` before fetching it — matched by id, since the folder
name depends on a date it does not yet have. Without it a re-fetch concatenates
a second JSON document onto the first and the file stops parsing entirely. That
lives in the same script as the `--print-to-file` that needs it, so running the
layer standalone twice does not break the file either.
