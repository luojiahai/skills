---
name: x-archiver
description: "Archive media from X (formerly Twitter) — every image and video an account has posted — into an archives folder of your choosing. It reports what it would fetch and waits for your yes, and a re-run fetches only what is new."
argument-hint: "<X profile URL> [--archives DIR] [--alias NAME]"
disable-model-invocation: true
---

This archives **X, formerly Twitter** (`x.com`, and `twitter.com` links too).
Say so on the first run before fetching anything — the skill's name does not
tell the user which site this is about.

An account is never archived without asking first. Enumerate the list, report
it, wait for the user's answer, and only then fetch:

```bash
<skill-dir>/scripts/archive.sh <url> [the user's flags] --plan   # enumerate and report
<skill-dir>/scripts/archive.sh <url> [the user's flags] --go     # fetch what was approved
```

Whatever the user typed after the URL is passed through exactly as given —
those are the script's own flags, and an unknown one produces its usage error
rather than a guess from you. `--plan` and `--go` you add yourself.

One exception: if the user typed `--yes` themselves, that **is** their
confirmation. Run their command once, as given, and report what comes back —
do not add `--plan` or `--go`, and do not ask. It is not a flag for you to
reach for on your own.

Run it **from the user's working directory** — call it by its full path, do not
`cd` into the skill first. Archives land relative to where you run it, and a
skill directory is replaced by the next update.

It takes a profile URL — `x.com/<handle>` — and archives the whole account.
Downloading one named post is out of scope; that is a job for gallery-dl, which
this skill already needs installed. A `/status/` URL is refused rather than read
as the account that posted it.

## The two steps

`--plan` enumerates the account's posts, diffs them against what is already on
disk, and prints a block: the account, the folder, how many posts it found, how
many you already have, and how many are new. It downloads nothing.

Report that block and ask whether to go ahead. Then **give the turn back and
wait**. Do not run `--go` until the user has answered.

`--go` downloads exactly the posts that block described, and does not enumerate
again. It refuses a plan that is missing, more than 24 hours old, or made for a
different account or archives folder; each refusal prints the `--plan` command
that fixes it.

A `--go` that stops partway leaves the plan in place, so re-running `--go`
picks up only what is missing — and needs no new question, because the user
already approved that list.

One case needs no question: **`to fetch 0`** — there is nothing to approve.
Report that the account is up to date and stop. No `--go`.

The summary block `--go` prints is the run's whole result. Report that and stop.

## Before the first run

`setup.sh` checks what is needed and prints how to install it. It installs
nothing itself:

```bash
<skill-dir>/setup.sh
```

It needs [gallery-dl](https://github.com/mikf/gallery-dl) (`brew install
gallery-dl`, which brings yt-dlp with it) and Node.

Then the session. X shows almost nothing to a signed-out visitor and its login
cannot be scripted, so the first run reads the session out of a browser you are
already signed in to:

```bash
<skill-dir>/scripts/archive.sh <url> --browser chrome --plan
```

`--browser` accepts `chrome`, `firefox`, `safari`, `edge`, `brave`, `chromium`,
`opera`, `vivaldi`. macOS will ask for Keychain access, and Chrome-family
browsers generally need to be closed. That happens **once**: the session is
cached to `${XDG_STATE_HOME:-~/.local/state}/x-archiver/cookies.txt` and every
later run uses it, until X rejects it.

## Whose account is being spent

This runs on the user's own signed-in X session, and bulk archiving is what
X's automation rules exist to catch. The realistic failure is not a failed
download — it is their account being rate-limited or locked. Say this once,
plainly, before the first run. A live session token is also now sitting in a
file on their disk.

What may be kept, and what may be done with it, is between the user, X's terms
and the poster's copyright — that judgement belongs to the person running it,
not to you.

## Where the media goes

`--archives DIR` sets the root, and the account folder is `DIR/x/<alias>` if
the account has one and `DIR/x/<numeric user id>` if it does not. Without the
flag the root is `<git root of the current directory, else cwd>/archives`, the
same root `douyin-archiver` uses.

The `x/` folder is what lets both skills share that root: `douyin-archiver`
files its accounts under `douyin/<sec_uid>`, so there is no id the two could
collide on.

X handles are mutable and the numeric id is not, which is why the id is the
default folder. A renamed account goes on filling the folder it already has
without anything having to notice the rename — there is nothing to detect and
nothing to report.

`--alias NAME` overrides that, because a folder full of numbers is unreadable to
the person whose archive it is. It **names the folder**: an account already
archived is renamed on the next `--go`, and one that is new is created with that
name straight away. `--plan` reports the move and performs it on `--go`, never
before — so a preview never reorganises the archive.

What keeps that safe is `archiver.json`, which records the account's id against
its alias. A known id is one lookup from its folder, and because `account.json`
inside the folder carries the same alias, the map is rebuilt by scanning
whenever it turns out to be wrong — so a stale entry costs a directory read,
never an archive. Rename a folder by hand and the next run adopts the new name:
where the two disagree, the folder wins.

An alias may be letters — in any script, so 罗嘉海 is fine — digits, dots,
dashes and underscores. No spaces, no slashes, not starting with a dot, and not
another account's id. One already in use is refused before anything is fetched,
naming the account that holds it. `--unalias` puts the folder back under the id;
an empty `--alias` means nothing at all, not removal.

Resuming means passing the same `--archives` again. A different root is a
different archive and starts from nothing, so if the user has downloaded this
account before, use the root they used before.

A working directory inside the skill itself is not a project: the run stops and
asks for `--archives DIR` rather than archiving into a folder the next update
deletes.

## What it fetches

Media the account posted itself — images, videos and GIFs — from its own posts
and its replies to itself. Not retweets (someone else's upload), not quoted
posts (likewise), and not posts that carry no media at all. Likes, bookmarks,
lists and search are out of scope.

## When it fails

The entry point preflights gallery-dl and Node, and each failure prints its own
remedy — relay that rather than improvising.

- **rate-limited** — the run stops cleanly and reports what landed. Wait, then
  `--go` again; it resumes at the first post still missing.
- **session rejected** — the cached cookies are discarded. Re-run with
  `--browser NAME`. If it fails again, the user needs to sign in to X in that
  browser first.
- **protected / suspended / no such account** — distinct hard stops. None of
  them is ever reported as "up to date".
- **a post whose media is gone** — logged, skipped, counted in the summary, and
  the run carries on.

## Changing the scripts

`scripts/README.md` carries the constraints that make the design what it is,
several of them verified the hard way. Read it before modifying anything in
`scripts/`.

## State

```
<archives root>/
  archiver.json                          {"schema": 3, "accounts": {…}}
  x/<alias, else numeric user id>/
    account.json
    sync.json
    assets/{avatar.<ext>, banner.<ext>}
    posts/<YYYY-MM-DD|undated>_<id>/
      post.json
      1.jpg, 2.mp4, …
```

- `posts/<date>_<id>/` — one folder per post, holding a `post.json` and the
  media it lists as `1.jpg`, `2.mp4`… The folder name carries no post text: the
  date sorts the listing as a timeline, the id identifies the post, and the
  words live in `post.json` in full rather than truncated into a directory name.
  **These folders are the record of what has been downloaded.** `post.json` is
  written *before* the media, so it describes the post rather than claiming it
  landed — a post counts as done when every file it lists is present, and
  deleting any of them re-downloads it.
- `account.json` — the account's identity, its alias if it has one, and the
  URL it was archived from. Written as soon as the folder is resolved, before
  anything is downloaded. It is **authoritative for identity** and **never for
  progress**: what has been downloaded is answered by `posts/` alone.
- `sync.json` — the list awaiting approval between `--plan` and `--go`, plus
  what the last run did. **Deleting it loses no archive content**; the plan
  expires after 24 hours anyway.
- `assets/` — the account's current avatar and banner, overwritten each run.
  A history of them is not kept.
- `archiver.json` — at the root, holding the schema this archive uses and each
  account's id mapped to its alias, per platform. A schema this build does not
  know stops the run before anything is read or written. The map is a **cache,
  not an authority**: the folders and their `account.json` files are the truth,
  and it is rebuilt from them when it disagrees. An account with no alias has no
  entry.
