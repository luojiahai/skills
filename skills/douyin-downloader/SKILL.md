---
name: douyin-downloader
description: "Download every video from a Douyin account, or a single Douyin video, into ./downloads/ — re-runs fetch only what is new."
argument-hint: "Douyin profile or video URL"
disable-model-invocation: true
---

Run `scripts/download.sh` with the URL the user gave you:

```bash
scripts/download.sh <url> [--name NAME]
```

It auto-detects a `/user/` profile URL (every video from the account) from a
`/video/` URL (just that one). `--user` is accepted as an alias; `--name` sets a
readable folder name instead of the account's 抖音号, and is only needed on the
first run.

Report the summary block it prints. Don't re-run it to "check" — re-running
re-scrolls the whole profile, which takes ~34 seconds.

## Before the first run

`setup.sh` installs yt-dlp's companions and is safe to re-run:

```bash
setup.sh
```

Then the user signs in once — only a human can pass Douyin's login:

```bash
node scripts/collect-douyin-ids.mjs --login <profile-url>
```

A browser opens. They sign in, wait for the video grid to appear, press Enter.
The session persists, and every later run works headless.

**Never try to drive that login yourself, and never block waiting on it.**

## When it fails

The script preflights yt-dlp, Playwright and the session, and each failure
prints its own remedy — relay that rather than improvising.

The one that needs a human is an expired session: the collector reports 0 videos
in the grid while the header still shows a video count. That means signing in
again, with the command above.

## What it downloads, and what it does not

This fetches videos the account has published publicly, for personal archival.
It is subject to Douyin's terms and to the copyright of whatever it downloads —
that judgement belongs to the person running it, not to you.

The throttling between requests is deliberate. Don't remove it or tune it down
to make a run finish faster; it is what keeps a long run from being cut off
partway.

## Why it is built this way

Downloading a whole account is not something yt-dlp can do alone, and the
reasons constrain any change you might make — read `scripts/README.md` before
modifying anything in `scripts/`.

The short version: yt-dlp has no `douyin:user` extractor, so video IDs must be
collected separately; Douyin's feed API needs an `a_bogus` signature from
obfuscated page JS and returns an empty body without it, so IDs can only be read
out of a real browser; and Chrome 136+ refuses automation against your everyday
profile, so that browser is a dedicated Playwright one.

## State

Nothing mutable lives in this skill directory.

- **Session, cookies, dependencies** →
  `${XDG_STATE_HOME:-~/.local/state}/douyin-downloader/`. User-level, so the user
  signs in once rather than once per project.
- **Downloads** → `<git root of the current directory, else cwd>/downloads/`.

Per account, in `downloads/<folder>/`:

- `videos/` — the media, named `<upload_date> - <title> [<id>].<ext>`
- `.archive.txt` — yt-dlp's record of what has downloaded. **This alone decides
  whether a video is re-fetched.** Deleting it re-downloads everything.
- `cursor.json` — identity and last-run state. Reporting only; it gates nothing.
  Deleting it costs the account its `--name` folder association, nothing more.
