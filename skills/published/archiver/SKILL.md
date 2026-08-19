---
name: archiver
description: "Archive a social account's posts to your own disk — Douyin videos, the images, videos and GIFs an account has posted on X (formerly Twitter), or an Instagram account's posts and reels. The URL says which. It reports what it would fetch and waits for your yes, and a re-run fetches only what is new."
argument-hint: "[profile URL] [--archives DIR] [--alias NAME]"
disable-model-invocation: true
---

This archives **Douyin** (`douyin.com`), **X, formerly Twitter** (`x.com`, and
`twitter.com` links too) and **Instagram** (`instagram.com`). Say which
platforms it covers on the first run, before fetching anything — the name does
not tell the user what is in it.

The URL decides the platform; nothing else does, and the user is never asked.

An account is never archived without asking first. Collect the list, report it,
wait for the user's answer, and only then fetch:

```bash
<skill-dir>/scripts/archive.sh <url> [the user's flags] --plan   # collect and report
<skill-dir>/scripts/archive.sh <url> [the user's flags] --go     # fetch what was approved
```

Whatever the user typed after the URL is passed through exactly as given —
those are the platform's own flags, and an unknown one produces its usage error
rather than a guess from you. `--plan` and `--go` you add yourself.

One exception: if the user typed `--yes` themselves, that **is** their
confirmation. Run their command once, as given, and report what comes back —
do not add `--plan` or `--go`, and do not ask. It is not a flag for you to
reach for on your own.

Run it **from the user's working directory** — call it by its full path, do not
`cd` into the skill first. Archives land relative to where you run it, and a
skill directory is replaced by the next update.

It takes a **profile** URL and archives the whole account. Downloading one named
post is out of scope; that is a job for a downloader run by hand. A single-post
URL is refused rather than read as the account that posted it.

A URL from a platform this skill does not archive is refused by name, and the
refusal lists what it does archive. There is no generic fallback: every promise
below — the post folder, the `post.json`, the re-run that fetches only what is
new — comes from platform code, and a generic downloader would satisfy none of
it while looking like it had worked.

## Every command answers in one JSON document

Whatever you run, stdout holds one document and nothing else. Parse the whole
stream. Progress chatter goes to stderr and is not for the user.

```json
{ "schema": 1, "ok": true, "command": "plan", "platform": "x",
  "exit": 0, "result": { … }, "error": { … } }
```

`ok` is how you tell a run that did what you asked from one that was refused or
stopped. `error` is there exactly when `ok` is false. `result` is there whenever
the run got somewhere — **including when `ok` is false**: a download that was
rate-limited after two hundred posts carries both, and you report both.

**The words are yours.** Nothing that comes back is written for the user. Say it
in **their language**, and in their vocabulary — sync, approve, download. Never
speak a flag, a command, a code or raw JSON to them: `--plan`, `--go`, `--yes`,
`--list` and `--archives` are yours to run and mean nothing to someone who typed
`/archiver`.

### When something is refused

```json
{ "code": "plan-stale", "message": "…", "details": { … },
  "remedy": { "message": "…", "command": "…", "run_by": "agent" } }
```

**Branch on `code`, never on `message`.** The codes are stable; the wording is
not. `message` is a fallback for a code this file has not heard of — if you meet
one, reword the message for the user rather than falling silent, and never read
it out verbatim.

`details` carries the facts, typed. Say "the list is nine hours old" from
`details.age_hours`, not by parsing a sentence.

`remedy.run_by` says whose it is to run. **`agent`** is yours — re-collecting an
account, for instance — and `remedy.command` is the exact invocation. **`user`**
is theirs: signing in to a browser, choosing a different folder name, fixing a
network they are behind. Tell them what to do in your own words; do not show
them the command, and do not run it for them.

The codes worth knowing:

| | |
| --- | --- |
| `rate-limited` | Wait and come back later. **Do not re-run now.** Report what landed. |
| `session-rejected` | The saved session was refused and thrown away. They sign in again. |
| `checkpoint-required` | Instagram only. The account is held behind a challenge. **Not a sign-in problem** — the session still works and has been kept. They clear the prompt in the app or a browser, then this runs again. Never tell them to sign in again. |
| `protected`, `suspended`, `no-such-account` | Three different things. Say which. **Never** "up to date". Instagram reports no `suspended`: it does not distinguish one from an account that never existed. |
| `empty`, `empty-grid` | The account has nothing this skill can fetch. Also never "up to date". |
| `session-expired-grid` | Douyin only: the profile counts posts but the grid is blank. That is the sign-in handoff below. |
| `session-missing`, `session-empty` | Douyin only: no session yet. Same handoff. |
| `login-abandoned`, `login-timed-out` | The sign-in did not finish. Offer it again. |
| `env-consent` | The tools have not been built yet. **Yours to act on** — see below. |
| `node-missing` | The runtime has not been built yet. **Theirs to run** — see below. |
| `env-build-failed` | The build failed. Say what `details.output` ends with, and that it needs the network. |
| `tool-missing`, `playwright-missing` | Only under the escape hatch. They install it — `details.install` names the command. |
| `plan-*`, `no-archive` | The prepared list is gone, stale, or for something else. Re-collect with `remedy.command`, then **ask again** before downloading. `plan-empty` is the one that means there was simply nothing left to download. |
| `url-single-post` | They pointed at one post. This archives whole accounts; `details` names the account to archive instead. |
| `flag-needs-value` | A flag was typed with no value. `details.flag` names it. Ask what they meant rather than dropping it. |
| `alias-move-failed`, `alias-target-occupied`, `unalias-target-occupied` | The folder could not be moved. Say where it is and what is in the way. |
| `internal-error` | The scripts crashed. Say so and stop; `details.stack` is for a bug report, not for the user. |

## Invoked with no URL

Typed bare, this asks what is already archived rather than doing nothing:

```bash
<skill-dir>/scripts/archive.sh --list [--archives DIR]
```

It reads the tree and downloads nothing, and needs no session. Its `result` is
`{ "root": …, "accounts": [ … ] }`, and each account carries:

| | |
| --- | --- |
| `platform` | `douyin`, `x` or `instagram` — group by it, since one root holds them all |
| `folder` | what the folder is called: the user's alias, else the account's id |
| `nickname` | what the account calls itself, or `null` |
| `dir` | where the archive is, if you need to say so or look inside |
| `url` | the URL it was archived from, or `null` |
| `posts` | post folders on disk — **not** a count of what fully landed |
| `last_run` | an ISO timestamp, or `null` for an account never run |
| `to_fetch` | how many a prepared list would still fetch, or `null` |

Write that out for the user and ask which to sync, then **give the turn back**.
Number the accounts, so their answer can be a number. Say who each one is, how
much is on disk, and whichever of `to_fetch` / `last_run` applies. Add one line,
once, saying that a profile URL archives an account not on the list — without it
the listing reads as a closed menu.

`posts` is what is on disk, so do not report it as what has been archived
successfully; a run that stopped partway leaves folders behind too.

Two fields decide what happens when an account is picked. **`url`** is what
`--plan` needs — use it exactly as given, and never rebuild one from a handle,
because handles change hands and the archive would fill up with whoever holds
that name today. A `null` means ask the user for the URL.

**`to_fetch`** being a number means a list has already been worked out and is
still usable, so those posts can be fetched without crawling the account again.
Say the number, wait for the user's yes, and only then run `--go` instead of
`--plan`. **Ask even though a list exists.** A parked list is written when it is
*collected*, not when it is approved, so it may be one the user was shown and
never answered — and nothing on disk tells that apart from a download that
stopped partway. The rule that an account is never archived without a yes has no
exception here.

Asked for several, do them one at a time: plan, report, wait, go, then the next.
Never collect every plan first and ask once, which is approval over counts
nobody has seen. If a run stops on a hard failure, report it and ask before
starting the next account.

An empty `accounts` is an ordinary answer, not a failure — the root may simply
never have been archived into. Say what this skill is and how to invoke it, in
your own words, but copy these lines exactly:

```
/archiver <profile url>
/archiver <profile url> --alias NAME      name the folder something readable, not the account id
/archiver <profile url> --archives DIR    keep the archive somewhere other than ./archives
```

Name the `root` it reported, so the user can tell you it is the wrong one.
Nothing else belongs in that message: not the `--help` output, not a
pointer to it, not an `archive.sh` command — that is the machinery, and the user
drives this by typing `/archiver`. Not `--plan`, `--go` or `--yes` either. Those
are yours to run, and `--yes` skips the confirmation this skill is built around.

## The two steps

`--plan` collects the account's post list, diffs it against what is already
downloaded, and reports it. It downloads nothing. Its `result`:

| | |
| --- | --- |
| `account` | `id`, `nickname`, `url`, and the readable handle — `handle` on X, `douyin_id` on Douyin. Name the account the way their language names people. |
| `dir` | where the archive is |
| `root` | the archives root this run used |
| `counts` | `found`, `on_disk`, `to_fetch` — **raw integers**, so group the digits the way their language groups them |
| `counts.platform` | what only one platform knows — see each platform's section |
| `notes` | `{ code, … }` objects; the ones that matter are below |
| `plan` | `created_at` and `expires_at`, so you never do the 24-hour arithmetic yourself |
| `next` | present only when there is something to fetch: `next.command` is the exact invocation, `run_by: "agent"` |

Tell the user who the account is, how much they already have, and how many are
new. Then ask whether to go ahead, **give the turn back and wait**. Do not run
`next.command` until they have answered.

Run `next.command` **exactly as given**. It already carries the archives root and
every other flag the user chose; rebuilding it yourself is how their archives
root gets silently dropped.

`--go` downloads from that list and does not collect again: it fetches the posts
the plan counted as new and never more than those, skipping any that landed
since. Its `result` adds:

| | |
| --- | --- |
| `run.downloaded` | posts this run fetched |
| `run.total` | posts on disk now |
| `run.failed` | posts that could not be fetched. Say the number when it is not zero — the list is kept, so a retry costs nothing and needs no new question. |
| `run.remaining` | posts still to fetch from the approved list |

A run that stops partway keeps the list, so running it again picks up only what
is missing — and needs no new question, because the user already approved it.

One case needs no question: **`counts.to_fetch` is `0`**. There is nothing to
approve; there will be no `next` either. Say the account is up to date and stop.

The `--go` document is the run's whole result. Report it and stop.

### The notes

| `code` | |
| --- | --- |
| `image-posts-skipped` | Douyin. **Say `count` out loud whenever it is there** — their archive is short by that many. |
| `hidden-posts` | Douyin. `count` posts the profile counts but never shows: private, deleted, region-locked. |
| `unlisted-posts` | Douyin. `count` archived posts the profile no longer lists. |
| `listing-truncated` | Douyin. The scroll hit its round limit, so the listing is short by an unknown amount. **Every other count in the document is a comparison against a partial list.** Say so. |
| `unattributed-posts` | Douyin. `count` cards on the page that no profile-feed response named, and so were not collected — a recommendation rail, or a run that missed those responses. |
| `undated-posts` | Douyin. `count` posts filed under `undated_<id>`, because nothing would say when they were published. |
| `duplicate-posts` | Any platform. `count` post ids found in two folders each. One answers for the post; the other's media is counted by nothing, so every figure beside it is short by that much. |
| `under-described-posts` | X and Instagram. `count` posts whose listing was cut off mid-post, or mid-carousel. They are fetched again, but their `post.json` lists fewer files than they carry. |
| `sweep` | X and Instagram. `mode: "incremental"` with `stopped_early: true` means it stopped after `threshold` known posts rather than reaching the end — so "nothing new" is not proven. Say so. A `--go` repeats the note its plan recorded, which may be up to a day old. **Instagram carries one of these per feed**, each with a `category` of `posts` or `reels`: say which feed was cut short, because "your posts are complete but I stopped partway through your reels" is the whole point of there being two. |
| `moving-to` | `--alias` will rename the folder to `dir` on the download step. Say it before they say yes; nothing has moved yet. |
| `root-changed` | The last run archived into `previous`. Say it — otherwise an `on_disk` of zero reads as an archive that lost its files. |

## Where the posts go

`--archives DIR` sets the root, and the account folder is
`DIR/<platform>/<alias>` if the account has one and `DIR/<platform>/<id>` if it
does not. Without the flag the root is `<nearest ancestor holding a .git, else the current
directory>/archives`, with symlinks resolved.

The platform folder is what lets one root hold them all: Douyin files accounts
under `douyin/<sec_uid>`, X under `x/<numeric user id>` and Instagram under
`instagram/<numeric user id>`, so there is no id two of them could collide on.

An account id is immutable and a handle is not, which is why the id is the
default folder. Changing a 抖音号, or renaming an X account, cannot orphan an
archive.

`--alias NAME` overrides that, because `MS4wLjABAAAAEKnfa654JAJ_N5lgZDQluwsxmY0`
is unreadable to the person whose archive it is. It **names the folder**: an
account already archived is renamed on the download step, and one that is new is
created with that name straight away. The plan reports the move as a `moving-to`
note and performs it only once the user has said yes — so a preview never
reorganises the archive. Say it before they answer.

What keeps that safe is `archiver.json`, which records the account's id against
its alias, per platform. A known id is one lookup from its folder, and because
`account.json` inside the folder carries the same alias, the map is rebuilt by
scanning whenever it turns out to be wrong — so a stale entry costs a directory
read, never an archive. Rename a folder by hand and the next run adopts the new
name: where the two disagree, the folder wins.

An alias may be letters — in any script, so 小明 is the point — digits, dots,
dashes and underscores. No spaces, no slashes, not starting with a dot, and not
another account's id. One already in use is refused before anything is fetched,
naming the account that holds it. `--unalias` puts the folder back under the id;
an empty `--alias` means nothing at all, not removal.

Resuming means passing the same `--archives` again. A different root is a
different archive and starts from nothing, so if the user has archived this
account before, use the root they used before.

A working directory inside the skill itself is not a project. Where the install
path names one — the `<project>/.claude/skills/` and `<project>/.agents/skills/`
layouts — the archive goes to `<project>/archives`, which for a skill under
`~/.claude/skills` is `~/archives`. Where it names none, the run stops and asks
for `--archives DIR` rather than archiving into a folder the next update
deletes. Naming the root explicitly is always the unambiguous thing to do.

## The tools it runs on

**There is nothing for the user to install.** The skill downloads and runs its
own `yt-dlp`, `gallery-dl`, Playwright and Chromium, at versions it pins, and
never consults what is already on the machine. A shell, `curl` and the POSIX
userland are all it assumes. Say this once if they ask what it needs.

They go in `${XDG_CACHE_HOME:-~/.cache}/archiver` — about 115MB to download and
400MB on disk for X, and 365MB to download and a little over a gigabyte on disk
once Douyin's browser is added. Sessions and cookies live somewhere
else entirely, so that directory can be deleted at any time and costs only a
re-download.

### The first run asks

The first time a platform needs them, the run stops with **`env-consent`**
rather than starting several hundred megabytes of download unannounced. That
refusal is **yours to act on**:

1. Tell the user how much it will download — `details.download_mb` — and where
   it goes — `details.dir`. Say that nothing is installed on their system and
   that the directory can be deleted whenever they like.
2. **Give the turn back and wait for their answer.**
3. If they agree, run `remedy.command`. Then run the original command again.

**`node-missing`** is the same conversation, one step earlier, and the step
`setup.sh` takes is **theirs to run**: it downloads roughly 115MB, which is
exactly the class of act the consent gate exists to stop happening silently. The
skill runs on the Node it built and on no other, so on a machine where nothing
has been built yet this is what **every** command answers — `--list` included.
Tell them what it does and ask them to run `<skill-dir>/setup.sh`, then re-run
the original command.

Consent is remembered per box. A run needing a box the user has already agreed to
is silent; the first Douyin run after an X or Instagram setup asks once more,
because Chromium is a quarter of a gigabyte and agreeing to the downloaders was
not agreeing to that. X and Instagram share their boxes exactly, so somebody set
up for one is set up for the other.

**`env-build-failed`** means it could not be built — almost always the network.
`details.output` holds the last thing the builder said; report the gist of it.

### Pre-warming, and clearing it out

```bash
<skill-dir>/setup.sh            # report what is built, build nothing
<skill-dir>/setup.sh douyin     # build everything Douyin needs, now
<skill-dir>/setup.sh x          # build everything X needs, now
<skill-dir>/setup.sh instagram  # build everything Instagram needs, now
<skill-dir>/setup.sh refresh    # rebuild the downloaders at their latest release
<skill-dir>/setup.sh clean      # delete the tools; sessions are untouched
```

`refresh` is for the user who meets a platform change before a fix ships: it
takes `yt-dlp` and `gallery-dl` at their latest release and keeps them until a
shipped bump passes them. It costs seconds and a few megabytes.

Somebody who only ever archives X or Instagram never downloads Chromium.

## Douyin

Needs a one-off sign-in, and nothing else the user has to provide: yt-dlp and the
browser it drives are the skill's own.

Only a human can pass Douyin's login, so signing in is its own step and
finishing it starts nothing:

```bash
<skill-dir>/scripts/archive.sh <profile-url> --login
```

That command is a **handoff**, in three beats. Print it and say a browser will
open. **Give the turn back** so they can run it. Then **wait until the user says
the sign-in is done** — do not run `--plan` before that. The command notices the
session by itself and stops there; it archives nothing, and it is the only thing
in this skill that opens a visible browser.

The session persists, and every later run works headless. A `--plan` with no
session refuses instantly rather than spending half a minute on a grid that
cannot render.

**Why it needs a browser.** yt-dlp has no Douyin account extractor, and Douyin's
feed API refuses unsigned requests, so the list of an account's posts can only be
read out of a real page. The downloading itself is yt-dlp's.

**Image posts (图文) are not downloaded.** Neither yt-dlp nor gallery-dl can
fetch them. They are counted during collection and reported as
`image-posts-skipped` on every run, so an account's archive is never quietly
short without saying so — **say that count out loud whenever the note is there**.
Tracked in [issue #48](https://github.com/luojiahai/skills/issues/48).

Douyin's `counts.platform` is `reported` (what the profile header claims),
`skipped_image_posts` and `unlisted`. `reported` may be `null` when the header
never rendered — that is unknown, not zero.

The one failure that needs a human is an expired session: `session-expired-grid`,
which means the grid rendered nothing while the header still counted posts. That
is the handoff above, again. A genuinely empty account is `empty-grid` instead,
and is not a sign-in problem.

Videos the account has published publicly, for personal archival. The pauses
between requests are deliberate: a run with them removed gets cut off partway.

## X, formerly Twitter

Needs a browser on this machine already signed in to X. That is the one
prerequisite the skill cannot supply — gallery-dl is its own, but a signed-in
session is not something any box can hold. There is no sign-in step to automate:
X's login cannot be scripted, by this or anything else. The first run reads the
session out of that browser:

```bash
<skill-dir>/scripts/archive.sh <url> --browser chrome --plan
```

`--browser` accepts `chrome`, `firefox`, `safari`, `edge`, `brave`, `chromium`,
`opera`, `vivaldi`. macOS will ask for Keychain access, and Chrome-family
browsers generally need to be closed. That happens **once**: the session is
cached and every later run uses it, until X rejects it.

**Whose account is being spent.** This runs on the user's own signed-in X
session, and bulk archiving is what X's automation rules exist to catch. The
realistic failure is not a failed download — it is their account being
rate-limited or locked. Say this once, plainly, before the first run. A live
session token is also now sitting in a file on their disk.

**What it takes, and what it leaves.** Media the account posted itself — images,
videos and GIFs — from its own posts and its replies to itself. Not retweets
(someone else's upload), not quoted posts (likewise), and not posts carrying no
media. Likes, bookmarks, lists and search are out of scope.

`--full` collects the whole timeline even when a re-run could stop early.
`--cookies FILE` uses an exported `cookies.txt` instead of a browser or the
cached session, for a machine where no signed-in browser is available.

X's `counts.platform` is `found_files`, `fetch_files`, `images` and `videos` —
posts are the headline number, files are what is actually downloaded.

Every run carries a `sweep` note. `mode: "incremental"` with
`stopped_early: true` means the collection stopped after `threshold` consecutive
posts it already had, rather than reaching the end of the timeline — so
`to_fetch: 0` there means "nothing new before the cut", not "nothing new at all".
Say which.

Its distinct hard stops, each its own code: `rate-limited` stops cleanly and
carries a `result` with what landed — report that, tell the user to come back
later, and **do not re-run**; `session-rejected` has already discarded the cached
cookies, so they sign in again; `protected`, `suspended` and `no-such-account`
are three different things, and none is ever reported as "up to date". A post
whose media is gone is skipped, counted in `run.failed`, and the run carries on.

## Instagram

Needs a browser on this machine already signed in to Instagram, exactly as X
does. There is no sign-in step to automate: Instagram's login cannot be
scripted into anything but a challenge, so the first run reads the session out
of that browser:

```bash
<skill-dir>/scripts/archive.sh <url> --browser chrome --plan
```

`--browser` takes the same names as X's, and the same caveats apply — macOS asks
for Keychain access, Chrome-family browsers generally need to be closed, and it
happens **once**. The session is cached separately from X's, so signing in to
one says nothing about the other.

**Whose account is being spent.** This runs on the user's own signed-in
Instagram session, and the realistic failure is not a failed download — it is
their account being rate-limited or challenged. Say this once, plainly, before
the first run, and say it more firmly than for X: Instagram answers a client
going too fast by holding the *account* rather than by refusing the request, and
clearing that is something only they can do, in the app. The pauses between
requests are deliberately long for exactly this reason; a run that seems slow is
a run that is working. A live session token is also now sitting in a file on
their disk.

**What it takes, and what it leaves.** The account's own posts — single images,
carousels and videos — and its reels, plus the caption of each. **Not stories,
not highlights, and not tagged posts.** Say so if they ask for any of them: a
story is gone within a day, so "a re-run fetches only what is new" could never be
true of one, and an archive quietly missing every day nobody ran would be worse
than one that never claimed to have them. Highlights are the account's own
permanent media and are the candidate for a later flag; they are not fetched
today. A URL naming a story, the tagged tab or a single post is refused by name.

`--full` collects the whole profile even when a re-run could stop early.
`--cookies FILE` uses an exported `cookies.txt` instead of a browser or the
cached session.

**Posts and reels are collected separately**, because each has to be able to
stop early without ending the other — so a run makes two passes and carries two
`sweep` notes. A post that appears in both is archived once.

Instagram's `counts.platform` is `found_files`, `fetch_files`, `images`,
`videos` and `reels`. The first four count **files**; `reels` counts **posts**,
which is the number a user could check against their own profile.

There is no `assets/` directory here: Instagram's listing carries no profile
image, and fetching one would cost an extra request per run against the limiter
that challenges accounts.

Its distinct hard stops: `rate-limited` stops cleanly and carries a `result`
with what landed — report it, tell the user to come back later, and **do not
re-run**; `checkpoint-required` means Instagram is holding their account behind
a challenge, which **is not a session problem** — the cached login still works
and has deliberately been kept, so tell them to clear the prompt in the app or a
browser and then run again, and never tell them to sign in again;
`session-rejected` has already discarded the cached cookies, so they do sign in
again; `protected` means a private account that has not approved this session.
A post whose media is gone is skipped, counted in `run.failed`, and the run
carries on.

## What it fetches, and whose judgement that is

Posts the account has published publicly, archived to the user's own disk.
Nothing is uploaded anywhere. It is subject to each platform's terms and to the
copyright of whatever it downloads — that judgement belongs to the person
running it, not to you.

## When it fails

Each platform preflights its own tools, and every refusal carries a `code`, its
facts in `details`, and — where there is one — a `remedy`. Branch on the code,
say it in the user's words, and respect `remedy.run_by`: run it yourself only
when it says `agent`.

## Changing the scripts

`scripts/README.md` carries the constraints that make the design what it is.
Read it before modifying anything in `scripts/`. `env/README.md` does the same
for the tool environment — read that before touching a pin, the lock, or
`ensure-env`.

## State

```
<archives root>/
  archiver.json                    {"schema": 3, "accounts": {…}}
  douyin/<alias, else sec_uid>/
    account.json
    sync.json
    posts/<YYYY-MM-DD|undated>_<id>/
      post.json
      1.mp4
  x/<alias, else numeric user id>/
    account.json
    sync.json
    assets/{avatar.<ext>, banner.<ext>}
    posts/<YYYY-MM-DD|undated>_<id>/
      post.json
      1.jpg, 2.mp4, …
  instagram/<alias, else numeric user id>/
    account.json
    sync.json
    posts/<YYYY-MM-DD|undated>_<shortcode>/
      post.json
      1.jpg, 2.mp4, …
```

- `posts/<date>_<id>/` — one folder per post, holding a `post.json` and the
  media it lists as `1.mp4`, `1.jpg`, `2.mp4`… The folder name carries no post
  text: the date sorts the listing as a timeline, the id identifies the post, and
  the words live in `post.json` in full rather than truncated into a directory
  name. **These folders are the record of what has been downloaded.** `post.json`
  is written *before* the media, so it describes the post rather than claiming it
  landed — a post counts as done when every file it lists is present, and
  deleting any of them re-downloads it.
- `account.json` — the account's identity, its alias if it has one, and the URL
  it was archived from. Written as soon as the folder is resolved, before
  anything is downloaded. It is **authoritative for identity** and **never for
  progress**: what has been downloaded is answered by `posts/` alone.
- `sync.json` — the list awaiting approval between the two steps, plus what the
  last run did. **Deleting it loses no archive content**; the list expires after
  24 hours anyway.
- `assets/` — the account's current avatar and banner, overwritten each run. A
  history of them is not kept. X only: nothing reads Douyin's out of the profile
  page yet, and Instagram's listing carries no profile image, so the directory is
  simply absent on both.
- `archiver.json` — at the root, holding the schema this archive uses and each
  account's id mapped to its alias, per platform. A schema this build does not
  know stops the run before anything is read or written. The map is a **cache,
  not an authority**: the folders and their `account.json` files are the truth,
  and it is rebuilt from them when it disagrees. An account with no alias has no
  entry.

State that is not an archive — sessions and cookies — lives under
`${XDG_STATE_HOME:-~/.local/state}/archiver/<platform>/`, not in the skill
directory, so signing in is once per user rather than once per project and a
plugin update cannot delete it. The tools are somewhere else again, under
`${XDG_CACHE_HOME:-~/.cache}/archiver/`, because they are re-derivable and a
session is not.
