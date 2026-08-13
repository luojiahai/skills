---
name: douyin-downloader
description: "Download every video from a Douyin account, or a single Douyin video, into a downloads folder of your choosing — it reports what it would fetch and waits for your yes, and a re-run fetches only what is new."
argument-hint: "<Douyin profile or video URL> [--downloads DIR] [--name NAME]"
disable-model-invocation: true
---

An account is never downloaded without asking first. Collect the list, report
it, wait for the user's answer, and only then fetch:

```bash
<skill-dir>/scripts/download.sh <url> [the user's flags] --plan   # collect and report
<skill-dir>/scripts/download.sh <url> [the user's flags] --go     # download what was approved
```

Whatever the user typed after the URL is passed through exactly as given —
those are the script's own flags, and an unknown one produces its usage error
rather than a guess from you. `--plan` and `--go` you add yourself.

Run it **from the user's working directory** — call it by its full path, do not
`cd` into the skill first. Downloads land relative to where you run it, and a
skill directory is replaced by the next update.

It auto-detects a `/user/` profile URL (every video from the account) from a
`/video/` URL (just that one). `--user` is accepted as an alias for the
profile URL.

## The two steps

`--plan` collects the account's video list — about half a minute in a headless
browser — diffs it against what is already downloaded, and prints a block: the
account, the folder, how many videos it found, how many are new. It downloads
nothing.

Report that block and ask whether to go ahead. Then **give the turn back and
wait**. Do not run `--go` until the user has answered.

`--go` downloads exactly the videos that block described, and does not collect
again. It refuses a plan that is missing, more than 24 hours old, or made for a
different account or a different downloads folder; each refusal prints the
`--plan` command that fixes it.

Two cases need no question:

- **`to fetch 0`** — there is nothing to approve. Report that the account is up
  to date and stop. No `--go`.
- **a `/video/` URL** — one named video is already as specific as an
  instruction gets, so it downloads straight away.

The summary block `--go` prints is the run's whole result. Report that and stop.

## Where the videos go

`--downloads DIR` sets the root, and the account folder is `DIR/<抖音号>` — or
`DIR/<NAME>` with `--name`, which is only needed the first time. Without the
flag the root is `<git root of the current directory, else cwd>/downloads`.

Resuming means passing the same `--downloads` again: under that root the folder
is found by matching the account's identity, whatever it is called. A different
root is a different archive and starts from nothing, so if the user has
downloaded this account before, use the root they used before.

A working directory inside the skill itself is not a project: the run stops and
asks for `--downloads DIR` rather than archiving into a folder the next update
deletes.

## Before the first run

`setup.sh` installs yt-dlp's companions and is safe to re-run:

```bash
setup.sh
```

Then the user signs in once — only a human can pass Douyin's login:

```bash
node scripts/collect-douyin-ids.mjs --login <profile-url>
```

That command is a **handoff**. Print it, tell them a browser will open and that
they sign in, wait for the video grid, then press Enter — and give the turn back
so they can run it. The session persists, and every later run works headless.

Session, cookies and dependencies live under
`${XDG_STATE_HOME:-~/.local/state}/douyin-downloader/`, not in this skill
directory, so that sign-in is once per user rather than once per project.

## When it fails

The script preflights yt-dlp, Playwright and the session, and each failure
prints its own remedy — relay that rather than improvising.

The one that needs a human is an expired session: the collector reports 0 videos
in the grid while the header still shows a video count. That is the handoff
above, again.

A `--go` that stops partway leaves the plan in place, so re-running `--go`
picks up only what is missing — no second collection.

## What it fetches, and whose judgement that is

Videos the account has published publicly, for personal archival. It is subject
to Douyin's terms and to the copyright of whatever it downloads — that
judgement belongs to the person running it, not to you.

## Changing the scripts

`scripts/README.md` carries the constraints that make the design what it is,
several of them verified the hard way. Read it before modifying anything in
`scripts/`.

## State

One folder per account, under the downloads root:

- `videos/` — the media, named `<upload_date> - <title> [<id>].<ext>`
- `.archive.txt` — yt-dlp's record of what has landed, and what makes a run
  resumable. **This alone decides whether a video is re-fetched.** Deleting it
  re-downloads everything.
- `cursor.json` — identity and last-run state, including the root the last run
  used. Reporting only; it gates nothing. Deleting it costs the account its
  `--name` folder association, nothing more.
- `.plan.json` — between `--plan` and `--go`, the list awaiting approval.
  Deleted once every video in it has landed.
