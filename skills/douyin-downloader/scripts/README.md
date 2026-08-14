# douyin-downloader scripts

Read this before changing anything here. The constraints below are why the
design looks the way it does; each was verified against the live site, and
several of the obvious simplifications do not work.

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
through the cursor write and a bogus summary telling the user to re-run the
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

| File | Role |
| --- | --- |
| `download.sh` | Entry point. Owns folder, plan and cursor policy. Everything else is called by it. |
| `download-douyin.sh` | General-purpose layer: a list of URLs/IDs in, one folder per post out, with throttling. Knows nothing about accounts. |
| `collect-douyin-ids.mjs` | Drives Playwright, scrolls the profile, emits post URLs and profile metadata. |
| `export-cookies.mjs` | Exports the Playwright session as a Netscape `cookies.txt` for yt-dlp. |
| `plan.mjs` | The confirm step: diffs the collected list against what is on disk, owns `.plan.json`, and renders **every** block the skill prints. |
| `archive.mjs` | What is already downloaded, answered from the post folders themselves. The layout rules, shared with x-downloader. |
| `cli.mjs` | The argument parsing, file reading and entry-point detection `plan.mjs` and `cursor.mjs` share. |
| `cursor.mjs` | Resolves an account's folder by identity; writes `cursor.json`; answers what the downloads root is. |
| `paths.mjs` | Single source of truth for where state lives and how Playwright is found. |
| `collect-douyin-ids.js` | A DevTools console snippet that harvests `/video/` ids — a no-dependency fallback if Playwright breaks. It does **not** track `collect-douyin-ids.mjs`: it has no profile-metadata read, no `--limit`, and no image-post counting, so it emits ids and nothing else. |

## State files, disjoint on purpose

The **post folders under `posts/`** are the sole record of what has downloaded.
`cursor.json` holds identity and last-run metadata and **gates nothing**.

They deliberately do not both track downloads. If they did, a run that failed
between writing one and the other would leave the cursor claiming posts that
were never fetched, and the error would be silent and permanent.

`.plan.json` is a third file but not a third source of truth: it is a cache of
one collection pass, and every question it answers is re-derived from disk next
time.

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
report described. In between, the list waits in `<folder>/.plan.json`, which is
why confirming costs no second collection and why what is fetched is exactly
what was shown.

`--go` runs no collection pass. The `sec_uid` is in the profile URL, so the
folder is found by scanning the root for a matching `cursor.json` **or**
`.plan.json` — the second of those is what finds an account planned but never
downloaded, which by definition has no cursor yet. The only browser it can open
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

Every block printed — the one approved, the one a finished run reports, the one
a single post gets — is rendered by `plan.mjs`, and what is on disk is counted
in exactly one place (`archive.mjs`'s `onDiskIds`). They were briefly three
hand-aligned copies across two languages, with `wc -l` counting in one of them
and unique ids in another; a blank line in the old `.archive.txt` was enough to
make a run contradict the number the user had approved.

`load` re-checks the plan against disk before handing it on. Without that, a
`--go` resumed after a partial run would pay a metadata request per post just
to discover it was already there — the fast resume the archive file used to
give, restored without a second record.

## The downloads root is computed once

`paths.mjs` owns it — `normalizeRoot` for an explicit `--downloads` (tilde
expanded, made absolute, symlinks resolved as far as the path exists) and
`downloadsRoot` for the default. `download.sh` asks for it through
`cursor.mjs root` rather than recomputing it in shell, because a root that
disagrees between the two languages names a different account folder and
silently re-downloads everything.

The symlink resolution is not fussiness: on macOS the default root comes back
as `/private/tmp/...` while a hand-typed `--downloads /tmp/...` would not, and
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
listing. Deleted, hidden, region-locked, missed by a collection that stopped
short, or fetched by `/video/` id and never on the profile at all are
indistinguishable without fetching each one.

No gap is recorded anywhere. A remembered count is a second account of what has
downloaded sitting beside the folders themselves, which is the drift "State
files, disjoint on purpose" exists to prevent, so each is re-derived from the
collected list and the disk every run. Hence `summary` needs `.plan.json`'s
`collected` **list** rather than its count, and a plan written before that list
existed prints no note rather than a wrong one.

## Where things live

Nothing mutable hangs off the skill directory. It may be installed read-only,
sit inside a plugin directory that updates replace, or be moved anywhere — so
paths are never derived from its location.

| What | Where | Why |
| --- | --- | --- |
| session, cookies, `node_modules` | `${XDG_STATE_HOME:-~/.local/state}/douyin-downloader/` | user-level: sign in once, not once per project; survives skill reinstalls |
| downloads | `--downloads DIR`, else `<git root of cwd, else cwd>/downloads/` | project-level: an archive belongs beside the work it is part of, unless the user says otherwise |
| Chromium binaries | `~/Library/Caches/ms-playwright` | shared across every project, so the ~150MB is paid once |

**A cwd inside the skill is not a project.** Asked to run `scripts/download.sh`,
an agent tends to cd here first — and in a project that is not a git repository,
`cwd/downloads` was then the skill's own folder. Whole archives landed in
`<project>/.claude/skills/douyin-downloader/downloads/`, where the next update
deletes them. So a cwd under the skill directory is discarded: the project is
recovered from the install path (`<project>/.claude/skills/<skill>` or
`.agents/`), and where that names none, the run stops and asks for
`--downloads`. Guessing is the one thing it must not do — a wrong root names a
different account folder and silently re-downloads everything.

The **downloads** root is written down once, in `paths.mjs`, and `download.sh`
asks for it through `cursor.mjs root` rather than reimplementing the rule — it
is the root that varies per run, and two answers to it would split an account's
archive in half. The `posts/` subdirectory is likewise named in both languages
(`archive.mjs`'s `POSTS_DIR` and `download.sh`'s `POSTS_SUBDIR`); change one and
change the other. The **state** directory is still spelled out in both languages
(`paths.mjs` and the top of `download.sh`): it is one unchanging expression,
`${XDG_STATE_HOME:-~/.local/state}/douyin-downloader`, and the shell needs it
before it can afford to start Node. Change it in one place and change it in the
other. `../setup.sh` installs into that directory and is safe to re-run — the
skill's `package.json` is the version manifest, copied in at install time.

Playwright is loaded from the state directory by explicit path, since that is
outside Node's upward module resolution. It is CommonJS, so an import by path
lands its exports on `.default` — `loadPlaywright()` normalises that.

## Tests

The pure logic — the diff, the plan validation rules, the status rendering,
path normalisation, the shared argument parsing, the cursor's merge and folder
naming, and the layout rules in `archive.mjs` — has unit tests, and no
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
./download.sh "https://www.douyin.com/user/MS4w..." --downloads ~/Videos/douyin --yes

# collect only
node collect-douyin-ids.mjs --headless "https://www.douyin.com/user/MS4w..." -o urls.txt

# download an arbitrary list
./download-douyin.sh -i urls.txt -o ~/Videos/douyin
```

`download-douyin.sh` accepts full `/video/` URLs, `/user/...?modal_id=...` URLs,
and bare numeric IDs interchangeably, and de-duplicates them. Use `-n` to see
the yt-dlp command without running it.

## Shared with x-downloader, on purpose

`archive.mjs` here and `archive.mjs` / `naming.mjs` in **x-downloader** hold the
same rules, written twice:

- `posts/<YYYY-MM-DD|undated>_<id>/`, one folder per post
- media numbered by position — `1.mp4`, `2.jpg`
- `text.txt`: permalink, timestamp, blank line, then the untruncated caption
- a post counts as downloaded when its folder holds at least one media file
- the account folder is prefixed — `douyin_<抖音号>` here, `x_<handle>` there —
  because both skills default to the same `<git root>/downloads` root, and an
  X handle that matches a 抖音号 would otherwise interleave two accounts in one
  folder. `--name` renames the account part and keeps the prefix, so no name
  can be chosen that collides.

They are duplicated rather than shared. A skill is a self-contained folder under
`skills/`, distributed and symlinked on its own, so there is nowhere a shared
module could live that is still a skill. **Change a rule here and change it
there** — the two archives are meant to be readable with one mental model, and
the duplication is only worth its cost while they agree.

Two deliberate differences:

- x-downloader's enumerator reports how many files a post should hold, so it can
  tell a half-fetched post from a complete one. Douyin's collector yields ids
  and nothing else, so `isPostComplete` here takes no expected count and one
  media file is the most that can be checked.
- `countMedia` here matches the positional `<n>.<ext>` shape rather than
  excluding known junk, because yt-dlp can leave `1.f137.mp4` / `1.f140.m4a`
  behind when a stream merge fails — whole files that would make an unplayable
  post read as finished. gallery-dl does not do that, so x-downloader's
  exclusion list is sufficient there.
- x-downloader *builds* its folder names in JS (`naming.mjs`). Here nothing
  does — yt-dlp's `POST_DIR` output template in `download-douyin.sh` builds
  them, and `archive.mjs` only reads them back. That is two spellings of one
  rule in two languages, so `archive.test.mjs` reads the template out of the
  shell script and checks the regex still accepts what it produces. Change the
  template and that test tells you.

`--print-to-file` appends and has no overwrite mode, so `download-douyin.sh`
clears a post's `text.txt` before fetching it — matched by id, since the folder
name depends on a date it does not yet have. That lives in the same script as
the `--print-to-file` that needs it, so running the layer standalone twice does
not double the file either.
