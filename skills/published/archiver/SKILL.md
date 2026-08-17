---
name: archiver
description: "Archive a social account's posts to your own disk — Douyin videos, or the images, videos and GIFs an account has posted on X (formerly Twitter). The URL says which. It reports what it would fetch and waits for your yes, and a re-run fetches only what is new."
argument-hint: "<profile URL> [--archives DIR] [--alias NAME]"
disable-model-invocation: true
---

This archives **Douyin** (`douyin.com`) and **X, formerly Twitter** (`x.com`,
and `twitter.com` links too). Say which platforms it covers on the first run,
before fetching anything — the name does not tell the user what is in it.

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
post is out of scope; that is a job for the downloader the platform already
needs installed. A single-post URL is refused rather than read as the account
that posted it.

A URL from a platform this skill does not archive is refused by name, and the
refusal lists what it does archive. There is no generic fallback: every promise
below — the post folder, the `post.json`, the re-run that fetches only what is
new — comes from platform code, and a generic downloader would satisfy none of
it while looking like it had worked.

## The two steps

`--plan` collects the account's post list, diffs it against what is already
downloaded, and prints a block: the account, the folder, how many posts it
found, how many you already have, and how many are new. It downloads nothing.

Report that block and ask whether to go ahead. Then **give the turn back and
wait**. Do not run `--go` until the user has answered.

`--go` downloads from that plan, and does not collect again: it fetches the posts
the block counted as new and never more than those, skipping any that have landed
since. It refuses a plan that is missing, more than 24 hours old, or made for a
different account or a different archives root; each refusal prints the `--plan`
command that fixes it.

A `--go` that stops partway leaves the plan in place, so re-running `--go` picks
up only what is missing — and needs no new question, because the user already
approved that list.

One case needs no question: **`to fetch 0`** — there is nothing to approve.
Report that the account is up to date and stop. No `--go`.

The summary block `--go` prints is the run's whole result. Report that and stop.

## Where the posts go

`--archives DIR` sets the root, and the account folder is
`DIR/<platform>/<alias>` if the account has one and `DIR/<platform>/<id>` if it
does not. Without the flag the root is `<git root of the current directory, else
cwd>/archives`.

The platform folder is what lets one root hold both: Douyin files accounts under
`douyin/<sec_uid>` and X under `x/<numeric user id>`, so there is no id the two
could collide on.

An account id is immutable and a handle is not, which is why the id is the
default folder. Changing a 抖音号, or renaming an X account, cannot orphan an
archive.

`--alias NAME` overrides that, because `MS4wLjABAAAAEKnfa654JAJ_N5lgZDQluwsxmY0`
is unreadable to the person whose archive it is. It **names the folder**: an
account already archived is renamed on the next `--go`, and one that is new is
created with that name straight away. `--plan` reports the move and performs it
on `--go`, never before — so a preview never reorganises the archive.

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

A working directory inside the skill itself is not a project: the run stops and
asks for `--archives DIR` rather than archiving into a folder the next update
deletes.

## Before the first run

`setup.sh` reports what each platform needs. A bare run installs nothing:

```bash
<skill-dir>/setup.sh            # check every platform
<skill-dir>/setup.sh douyin     # check Douyin, and install what can be installed
<skill-dir>/setup.sh x          # check X
```

The two platforms cost very different things, and the asymmetry is real rather
than an oversight — see each platform's section below.

## Douyin

Needs [yt-dlp](https://github.com/yt-dlp/yt-dlp), Node, and a one-off sign-in.
`setup.sh douyin` installs the Playwright browser it drives.

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
fetch them. They are counted during collection and reported as skipped in every
block, so an account's archive is never quietly short without saying so — say
that number out loud when it is not zero. Tracked in
[issue #48](https://github.com/luojiahai/skills/issues/48).

The one failure that needs a human is an expired session: the collector reports
0 posts in the grid while the header still shows a post count. That is the
handoff above, again.

Videos the account has published publicly, for personal archival. The pauses
between requests are deliberate: a run with them removed gets cut off partway.

## X, formerly Twitter

Needs [gallery-dl](https://github.com/mikf/gallery-dl) (`brew install
gallery-dl`) and Node, plus a browser already signed in to X. There is no
sign-in step to automate — X's login cannot be scripted, by this or anything
else. The first run reads the session out of that browser:

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

Its distinct hard stops: **rate-limited** stops cleanly and reports what landed —
wait, then `--go` again; **session rejected** discards the cached cookies, so
re-run with `--browser NAME`; **protected / suspended / no such account** are
each named, and none is ever reported as "up to date". A post whose media is gone
is logged, skipped, counted in the summary, and the run carries on.

## What it fetches, and whose judgement that is

Posts the account has published publicly, archived to the user's own disk.
Nothing is uploaded anywhere. It is subject to each platform's terms and to the
copyright of whatever it downloads — that judgement belongs to the person
running it, not to you.

## When it fails

Each platform preflights its own tools and each failure prints its own remedy —
relay that rather than improvising.

## Changing the scripts

`scripts/README.md` carries the constraints that make the design what it is.
Read it before modifying anything in `scripts/`.

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
- `sync.json` — the list awaiting approval between `--plan` and `--go`, plus what
  the last run did. **Deleting it loses no archive content**; the plan expires
  after 24 hours anyway.
- `assets/` — the account's current avatar and banner, overwritten each run. A
  history of them is not kept. X only: nothing reads Douyin's out of the profile
  page yet, so the directory is simply absent there.
- `archiver.json` — at the root, holding the schema this archive uses and each
  account's id mapped to its alias, per platform. A schema this build does not
  know stops the run before anything is read or written. The map is a **cache,
  not an authority**: the folders and their `account.json` files are the truth,
  and it is rebuilt from them when it disagrees. An account with no alias has no
  entry.

State that is not an archive — sessions, cookies, the Playwright dependency —
lives under `${XDG_STATE_HOME:-~/.local/state}/archiver/<platform>/`, not in the
skill directory, so signing in is once per user rather than once per project and
a plugin update cannot delete it.
