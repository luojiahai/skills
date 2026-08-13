---
name: douyin-downloader
description: "Download every video from a Douyin account, or a single Douyin video, into ./downloads/ — resumable, so a re-run fetches only what is new."
argument-hint: "Douyin profile or video URL"
disable-model-invocation: true
---

Run `scripts/download.sh` with the URL the user gave you, as it is given:

```bash
<skill-dir>/scripts/download.sh <url> [--name NAME]
```

Run it **from the user's working directory** — call it by its full path, do not
`cd` into the skill first. Downloads land relative to where you run it, and a
skill directory is replaced by the next update.

It auto-detects a `/user/` profile URL (every video from the account) from a
`/video/` URL (just that one). `--user` is accepted as an alias; `--name` sets a
readable folder name instead of the account's 抖音号, and is only needed on the
first run.

The summary block it prints is the run's whole result. Report that and stop.

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

## What it fetches, and whose judgement that is

Videos the account has published publicly, for personal archival. It is subject
to Douyin's terms and to the copyright of whatever it downloads — that
judgement belongs to the person running it, not to you.

## Changing the scripts

`scripts/README.md` carries the constraints that make the design what it is,
several of them verified the hard way. Read it before modifying anything in
`scripts/`.

## State

Downloads land in `<git root of the current directory, else cwd>/downloads/`,
one folder per account. A working directory inside the skill itself is not a
project: the run stops and asks for `--downloads DIR` instead of archiving into
a folder the next update deletes.

- `videos/` — the media, named `<upload_date> - <title> [<id>].<ext>`
- `.archive.txt` — yt-dlp's record of what has landed, and what makes a run
  resumable. **This alone decides whether a video is re-fetched.** Deleting it
  re-downloads everything.
- `cursor.json` — identity and last-run state. Reporting only; it gates nothing.
  Deleting it costs the account its `--name` folder association, nothing more.
