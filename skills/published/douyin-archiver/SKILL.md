---
name: douyin-archiver
description: "Archive every video from a Douyin account into an archives folder of your choosing — it reports what it would fetch and waits for your yes, and a re-run fetches only what is new. Image posts (图文) are counted and reported, but not yet downloaded."
argument-hint: "<Douyin profile URL> [--archives DIR] [--alias NAME]"
disable-model-invocation: true
---

An account is never archived without asking first. Collect the list, report
it, wait for the user's answer, and only then fetch:

```bash
<skill-dir>/scripts/archive.sh <url> [the user's flags] --plan   # collect and report
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

It takes a `/user/` profile URL and archives the whole account. Downloading one
named video is out of scope; that is a job for yt-dlp, which this skill already
needs installed. A `/video/` URL is refused rather than read as the account that
posted it.

## The two steps

`--plan` collects the account's post list — about half a minute in a headless
browser — diffs it against what is already downloaded, and prints a block: the
account, the folder, how many posts it found, how many are new. It downloads
nothing.

Report that block and ask whether to go ahead. Then **give the turn back and
wait**. Do not run `--go` until the user has answered.

`--go` downloads exactly the posts that block described, and does not collect
again. It refuses a plan that is missing, more than 24 hours old, or made for a
different account or a different archives folder; each refusal prints the
`--plan` command that fixes it.

One case needs no question: **`to fetch 0`** — there is nothing to approve.
Report that the account is up to date and stop. No `--go`.

The summary block `--go` prints is the run's whole result. Report that and stop.

## Where the posts go

`--archives DIR` sets the root, and the account folder is `DIR/douyin/<alias>`
if the account has one and `DIR/douyin/<sec_uid>` — the `MS4w…` part of a profile
URL — if it does not. Without the flag the root is `<git root of the current
directory, else cwd>/archives`, the same root `x-archiver` uses.

The `douyin/` folder is what lets both skills share that root: `x-archiver`
files its accounts under `x/<numeric user id>`, so there is no id the two could
collide on.

A 抖音号 is mutable and a sec_uid is not, which is why the sec_uid is the default
folder. Changing a 抖音号 cannot orphan an archive, and the 抖音号 is still kept
inside `account.json` because it is the identifier a human can read and type.

`--alias NAME` overrides that, because `MS4wLjABAAAAEKnfa654JAJ_N5lgZDQluwsxmY0`
is unreadable to the person whose archive it is. It **names the folder**: an
account already archived is renamed on the next `--go`, and one that is new is
created with that name straight away. `--plan` reports the move and performs it
on `--go`, never before — so a preview never reorganises the archive.

What keeps that safe is `archiver.json`, which records the account's sec_uid
against its alias. A known sec_uid is one lookup from its folder, and because
`account.json` inside the folder carries the same alias, the map is rebuilt by
scanning whenever it turns out to be wrong — so a stale entry costs a directory
read, never an archive. Rename a folder by hand and the next run adopts the new
name: where the two disagree, the folder wins.

An alias may be letters — in any script, so 小明 is the point — digits, dots,
dashes and underscores. No spaces, no slashes, not starting with a dot, and not
another account's sec_uid. One already in use is refused before the browser
opens, naming the account that holds it. `--unalias` puts the folder back under
the sec_uid; an empty `--alias` means nothing at all, not removal.

Resuming means passing the same `--archives` again. A different root is a
different archive and starts from nothing, so if the user has downloaded this
account before, use the root they used before.

A working directory inside the skill itself is not a project: the run stops and
asks for `--archives DIR` rather than archiving into a folder the next update
deletes.

## Before the first run

`setup.sh` installs yt-dlp's companions and is safe to re-run:

```bash
<skill-dir>/setup.sh
```

Then the user signs in once — only a human can pass Douyin's login:

```bash
node <skill-dir>/scripts/collect-douyin-ids.mjs --login <profile-url>
```

That command is a **handoff**. Print it, tell them a browser will open and that
they sign in, wait for the post grid, then press Enter — and give the turn back
so they can run it. The session persists, and every later run works headless.

Session, cookies and dependencies live under
`${XDG_STATE_HOME:-~/.local/state}/douyin-archiver/`, not in this skill
directory, so that sign-in is once per user rather than once per project.

## When it fails

The script preflights yt-dlp, Playwright and the session, and each failure
prints its own remedy — relay that rather than improvising.

The one that needs a human is an expired session: the collector reports 0 posts
in the grid while the header still shows a post count. That is the handoff
above, again.

A `--go` that stops partway leaves the plan in place, so re-running `--go`
picks up only what is missing — no second collection.

## What it fetches, and whose judgement that is

Videos the account has published publicly, for personal archival. It is subject
to Douyin's terms and to the copyright of whatever it downloads — that
judgement belongs to the person running it, not to you.

**Image posts (图文) are not downloaded.** Neither yt-dlp nor gallery-dl can
fetch them. They are counted during collection and reported as skipped in every
block, so an account's archive is never quietly short without saying so — say
that number out loud when it is not zero. Tracked in
[issue #39](https://github.com/luojiahai/skills/issues/39).

## Changing the scripts

`scripts/README.md` carries the constraints that make the design what it is,
several of them verified the hard way. Read it before modifying anything in
`scripts/`.

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
```

- `posts/<date>_<id>/` — one folder per post, holding a `post.json` and the
  media it lists as `1.mp4`. The folder name carries no caption: the date sorts
  the listing as a timeline, the id identifies the post, and the words live in
  `post.json` in full rather than truncated into a directory name. **These
  folders are the record of what has been downloaded.** `post.json` is written
  *before* the media, so it describes the post rather than claiming it landed —
  a post counts as done when every file it lists is present, and deleting any of
  them re-downloads it. This is also what finally gives a Douyin post an expected
  file count: yt-dlp reports none, so before this a post whose download failed
  after its text was written could read as complete.
- `account.json` — the account's identity (sec_uid, 抖音号, nickname), its alias
  if it has one, and the profile URL it was archived from. Written as
  soon as the folder is resolved, before anything is downloaded. It is
  **authoritative for identity** and **never for progress**: what has been
  downloaded is answered by `posts/` alone.
- `sync.json` — the list awaiting approval between `--plan` and `--go`, plus
  what the last run did. **Deleting it loses no archive content**; the plan
  expires after 24 hours anyway.
- `archiver.json` — at the root, holding the schema this archive uses and each
  account's id mapped to its alias, per platform. A schema this build does not
  know stops the run before anything is read or written. The map is a **cache,
  not an authority**: the folders and their `account.json` files are the truth,
  and it is rebuilt from them when it disagrees. An account with no alias has no
  entry.

There is no `assets/` here. `x-archiver` keeps the account's avatar and banner,
which it gets free with its listing pass; nothing reads Douyin's out of the
profile page yet, so the directory is simply absent.
