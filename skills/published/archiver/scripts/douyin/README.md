# Douyin platform scripts

Read this before changing anything here. The constraints below are why the
design looks the way it does; each is verified against the live site, and the
simplifications they rule out are named as they come up.

## Constraints

**yt-dlp cannot collect an account's posts.** It ships exactly one Douyin extractor,
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
without filtering collects a handful of strangers' uploads and none of the
account's own.

**Grid class names are obfuscated and rotate** (`a.RZuwF26I`, `div.gsF4XxDR`).
Filter structurally — exclude `footer`, exclude the SEO marker — never by class.

**The orchestration stays in Node.** Not preference — shell cannot hold this
shape safely. A shell function called under `||` runs with `set -e` switched off
for its whole body, so `run_plan … || status=$?` reads like status capture while
letting a *refused* plan print its refusal and then keep going, through the
metadata write and a bogus summary telling the user to re-run the `--go` that
just failed. Every refusal here is a returned exit code that the caller must
read, and `../archive.sh` holds only the node preflight and the `--downloads`
refusal.

**The pauses are what let a long run finish.** `fetch.mjs` runs yt-dlp with
`--sleep-requests 2 --sleep-interval 3 --max-sleep-interval 8`. Douyin
rate-limits hard: an unthrottled batch starts failing partway through and can
get the session challenged. Tuning these down to make a run finish faster is
what stops it finishing.

## Files

**This platform archives; the tool it drives downloads.** `run.mjs` owns the
account — which folder it lives in, what is already on disk, what is missing, and
whether the user has said yes — and knows nothing about how bytes arrive.
`fetch.mjs` owns everything said to yt-dlp and knows nothing about accounts.
yt-dlp is a downloader and is named as one throughout; it cannot resume an
account, which is the whole reason this layer sits above it.

| File | Role |
| --- | --- |
| `run.mjs` | The whole run: parses the command line, refuses what it must, and drives plan and go. Everything else is called by it. |
| `target.mjs` | What the user pointed at, and a post's permalink. A profile URL, or a refusal by name — a `/video/` URL is never read as the account that posted it. |
| `collect.mjs` | Drives Playwright, scrolls the profile, and returns every post the grid names. The DOM says which posts exist; the feed responses passing underneath say what each one is. |
| `fetch.mjs` | Everything said to yt-dlp, and the download loop. One invocation per post, into a folder this side chose. |
| `login.mjs` | Signing in, as its own step. Waits by watching for the session cookie, not by trusting a keypress. |
| `session.mjs` | Whether the profile holds a session, and minting it as a Netscape `cookies.txt` yt-dlp can read. |
| `playwright.mjs` | Finding the browser this platform drives — the one dependency no other platform has. |
| `blocks.mjs` | The parts of a block that are Douyin's: how this site names an account, and the three gaps between numbers that would otherwise look like an error. |

The archive itself — `account.json`, `post.json`, `sync.json`, `archiver.json`,
the post folders and every block this skill prints — is [`../shared/`](../shared/README.md).

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
also what gives this skill an expected file count at all: yt-dlp reports none
for Douyin, so without `post.json` "downloaded" could only mean "the folder
holds at least one file", and a post whose media failed after its text was
written would read as complete.

`sync.json` is a third file but not a third source of truth: it holds a cache of
one collection pass and a note of what the last run did, and deleting it loses no
archive content — the rule it exists under, specified in
[`../shared/README.md`](../shared/README.md).

There is no fourth file, and there must not be one. The reason is sharp on this
platform: yt-dlp's `--download-archive` keys on ids, not paths, so it reports a
post as downloaded after its files are deleted, and a user who removes a bad
download gets silence instead of a re-fetch. `--no-overwrites` keys on the
resolved path instead, which is what makes `rm -rf` on a post folder mean "fetch
this again".

## Plan, then go

The split run, what `sync.json` parks between the halves, when a plan is refused
and why `--yes` outranks a later mode flag are the same on every platform, and
are specified in [`../shared/README.md`](../shared/README.md).

What is particular here: `--go` runs no collection pass and needs none. The
`sec_uid` is in the profile URL and the `sec_uid` *is* the folder, so the
account's directory is known outright rather than found by scanning. The only
browser `--go` opens is `session.mjs` minting cookies, and only when the cached
file is missing or yt-dlp has just rejected it.

Every block printed — the one approved, and the one a finished run reports — is
rendered by `../shared/plan.mjs`, and what is on disk is counted in exactly one
place (`landed.mjs`'s `onDiskIds`). Do not hand-align a second copy of either in
another language: counting lines in one place and unique ids in another is all
it takes for a run to contradict the number the user approved.

`loadPlan` returns the parked plan and nothing more; `run.mjs` re-checks it
against disk with `outstanding` before fetching. Without that re-check a `--go`
resumed after a partial run would pay a metadata request per post just to
discover it was already there — this way the resume is fast, and there is still
no second record of what has landed.

## The archives root is computed once

`paths.mjs` owns it — `normalizeRoot` for an explicit `--archives` (tilde
expanded, made absolute, symlinks resolved as far as the path exists) and
`archivesRoot` for the default. Every caller asks it rather than recomputing the
rule, because two answers name a different account folder and silently
re-download an entire archive.

The symlink resolution is not fussiness: on macOS the default root comes back
as `/private/tmp/...` while a hand-typed `--archives /tmp/...` would not, and
a plan made one way would then be refused the other.

## No early-stop

Collection always scrolls the whole feed. Do not stop it at the first
already-downloaded ID: Douyin pins up to 3 posts at the top regardless of age,
so a stop-at-first-known rule halts immediately and collects nothing, forever,
silently.

It is also not worth much. A full scroll of a few hundred posts measures **~34
seconds**, and a stopper does not save that: page load, the 3s settle and up to
12s of header polling are a floor it cannot go under. What it buys is around
twenty seconds, once per re-run.

Against that, every way it goes wrong is silent. Stopping short truncates
`collected`, and three block lines are computed from it — `found N of M
reported`, `hidden()`, and `missing()`, which would report every archived post
below the cut as *no longer on the profile*. That last one is parked in the plan
and read back at `--go` time, so the false number outlives the run that made it.
The fetch list stays correct throughout, which is precisely the problem: the
archive quietly gets smaller while the run reports success.

The X side does stop early, after 100 consecutive known posts, and can hold that
rule to account because `makeStopper` is a pure function with tests of its own.
The equivalent here would live inside the browser loop.

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
  and nothing here can fetch them yet (issue #48). They are reported as skipped
  and subtracted before the `counted but not shown` gap is worked out, so the
  same posts are not blamed twice.

That second note claims only what was observed, an id here and not in the
listing. Deleted, hidden, region-locked, and missed by a collection that stopped
short are indistinguishable without fetching each one.

No gap is recorded anywhere. A remembered count is a second account of what has
downloaded sitting beside the folders themselves, which is the drift "State
files, disjoint on purpose" exists to prevent, so each is re-derived from the
collected list and the disk every run. Hence `summary` needs the parked plan's
`collected` **list** rather than its count, and a plan carrying no such list
prints no note rather than a wrong one.

## Where things live

Nothing mutable hangs off the skill directory. It may be installed read-only,
sit inside a plugin directory that updates replace, or be moved anywhere — so
paths are never derived from its location.

| What | Where | Why |
| --- | --- | --- |
| session, cookies, `node_modules` | `${XDG_STATE_HOME:-~/.local/state}/archiver/douyin/` | user-level: sign in once, not once per project; survives skill reinstalls |
| archives | `--archives DIR`, else `<git root of cwd, else cwd>/archives/` | project-level: an archive belongs beside the work it is part of, unless the user says otherwise |
| Chromium binaries | `~/Library/Caches/ms-playwright` | shared across every project, so the ~150MB is paid once |

**A cwd inside the skill is not a project.** Asked to run `scripts/archive.sh`,
an agent tends to cd here first — and in a project that is not a git repository,
the root would resolve to the skill's own folder, putting whole archives under
`<project>/.claude/skills/<skill>/archives/`, where the next update deletes
them. So a cwd under the skill
directory is discarded: the project is recovered from the install path
(`<project>/.claude/skills/<skill>` or `.agents/`), and where that names none,
the run stops and asks for `--archives`. Guessing is the one thing it must not
do — a wrong root names a different account folder and silently re-downloads
everything.

The **archives** root, the **state** directory and the `posts/` subdirectory are
each written down once — in `paths.mjs` and `landed.mjs` — and every caller asks
rather than recomputing. Two answers to the archives root would name a different
account folder and silently re-download an entire archive. `../../setup.sh
douyin` installs into the state directory and is safe to re-run; this folder's
`package.json` is the version manifest, copied in at install time.

Playwright is loaded from the state directory by explicit path, since that is
outside Node's upward module resolution. It is CommonJS, so an import by path
lands its exports on `.default` — `loadPlaywright()` normalises that.

## Tests

The pure logic — the diff, the plan validation rules, the status rendering,
path normalisation, the shared argument parsing, the metadata merge and folder
resolution, and the layout rules in `landed.mjs` — has unit tests, and no
dependencies beyond Node. From the repo root, which runs every platform's suite
as well as the shared one:

```bash
npm test
```

Everything else (a real grid, a real session, yt-dlp) is verified by running it
against a live account.

## Manual use

`run.mjs` is reached through the skill's dispatcher, which resolves the platform
from the URL. Call that rather than this folder:

```bash
# sign in once (opens a window, and stops there)
../archive.sh "https://www.douyin.com/user/MS4w..." --login

# an account, without the two-step confirm
../archive.sh "https://www.douyin.com/user/MS4w..." --archives ~/Videos/douyin --yes
```

One post's worth of yt-dlp arguments lives in `fetch.mjs` and nowhere else. Do
not add a separate downloader script to point at a list of URLs: it would be a
second path into the same folders, with its own flags and its own idea of what
`post.json` should contain, and the two would drift.

## The archive this shares with the other platform

`account.json`, `post.json`, `sync.json`, `archiver.json` and the
`posts/<date>_<id>/` layout are written by `../shared/`, and specified in
[`../shared/README.md`](../shared/README.md). Both platforms write into one
archives root, so those rules are not this platform's to change alone.

What is particular to this one:

- **Where each field of `post.json` comes from.** The X platform gets everything
  from its collection pass, because gallery-dl prints the caption, the date and
  the filename together. Here the caption and the timestamp come from the profile
  feed responses read during the scroll, and only the media filename comes from
  yt-dlp — it is what picks the container, so nothing else can know the
  extension. `--print` fires after extraction and before the download, so the
  name still arrives in time for `post.json` to be written first. Both platforms
  build the file with `../shared/post.mjs`; what differs is what each hands
  `mediaEntry`, which is `{file}` here because yt-dlp has already said the name,
  and `{num, ext, …}` on X because that platform assembles the name itself.
- **Junk files need no rule of their own.** yt-dlp can leave `1.f137.mp4` /
  `1.f140.m4a` behind when a stream merge fails — whole files, which would make
  an unplayable post read as finished under any rule that merely matched the
  positional `<n>.<ext>` shape. Against a named list of expected files, none of
  those is `1.mp4`, so nothing has to know about them.
- **`assets/` is X-only.** gallery-dl puts the avatar and banner URLs on rows the
  X platform already reads. Nothing here reads Douyin's out of the profile page
  yet, so the directory is simply absent — the layout allows it to be.
