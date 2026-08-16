---
name: douyin-archiver
description: "Archive every video from a Douyin account, or download a single Douyin video, into an archives folder of your choosing — it reports what it would fetch and waits for your yes, and a re-run fetches only what is new. Image posts (图文) are counted and reported, but not yet downloaded."
argument-hint: "<Douyin profile or video URL> [--archives DIR] [--name NAME]"
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

It auto-detects a `/user/` profile URL (every post from the account) from a
`/video/` URL (just that one).

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

Two cases need no question:

- **`to fetch 0`** — there is nothing to approve. Report that the account is up
  to date and stop. No `--go`.
- **a `/video/` URL** — one named post is already as specific as an
  instruction gets, so it downloads straight away.

The summary block `--go` prints is the run's whole result. Report that and stop.

## Where the posts go

`--archives DIR` sets the root, and the account folder is `DIR/douyin_<抖音号>`
— or `DIR/douyin_<NAME>` with `--name`, which is only needed the first time.
Without the flag the root is `<git root of the current directory, else
cwd>/archives`, the same root `x-archiver` uses.

The `douyin_` prefix is what lets both skills share that root: `x-archiver`
names its folders `x_<handle>`, so a 抖音号 and an X handle that happen to match
still get a folder each. `--name` renames the account part and keeps the prefix
— there is no way to name a folder that collides.

Resuming means passing the same `--archives` again: under that root the folder
is found by matching the account's identity, whatever it is called. A different
root is a different archive and starts from nothing, so if the user has
downloaded this account before, use the root they used before.

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

One folder per account, under the archives root:

- `posts/<date>_<id>/` — one folder per post, holding its media as `1.mp4`,
  `2.jpg`… and a `text.txt` with the post's permalink, timestamp and full
  caption. The name carries no caption: the date sorts the listing as a
  timeline, the id identifies the post, and the words live in `text.txt` in full
  rather than truncated into a directory name. **These folders are the record of
  what has been downloaded**, and a post counts as done when it holds media.
  Deleting one re-downloads it.
- `metadata.json` — the account's identity, the profile URL it was archived
  from and the archives root the last run used. Written as soon as the folder
  is resolved, before anything is downloaded. It is **authoritative for
  identity** — which folder is this account's — and **never for progress**: what
  has been downloaded is answered by `posts/` alone. Deleting it costs the
  archive its folder, and the next run starts a new one.
- `.plan.json` — between `--plan` and `--go`, the list awaiting approval.
  Deleted once every post in it has landed.
