---
"luojiahai-skills": patch
---

archiver: the skill now downloads and runs its own tools instead of asking you to install any.

Nothing you type changes, no output moves, and no archive is laid out differently — but the first run after this update will stop and ask before fetching a few hundred megabytes, so it is worth knowing what it is asking for.

`yt-dlp` and `gallery-dl` ship extractor fixes constantly, because Douyin and X keep changing. A copy of either that happened to be on your machine was a breakage nobody could diagnose from the other end of an issue: nothing said which version ran, and "reinstall your yt-dlp" is not a support answer. So the skill now pins its own `yt-dlp`, `gallery-dl`, Playwright, Chromium, CPython and Node, builds them itself, and uses them always — including when you already have those tools on your `PATH`.

They go in three directories under `${XDG_CACHE_HOME:-~/.cache}/archiver`, keyed by the versions they were built from: the runtime, the downloaders, and the browser. Around 115MB of download for X and 365MB with Douyin's browser added; roughly 400MB and a little over a gigabyte on disk — Playwright needs both a full Chromium and a headless shell, since every run but the Douyin sign-in is headless and that one is a visible browser you sign in to. Only `curl` is assumed to exist — no Homebrew, no `pip`, no `pipx`, and `scripts/archive.sh` no longer tells a Linux user to run `brew install node`.

The first time a platform needs them the run refuses, saying how much it will download and where it goes, so the agent can ask you before anything is fetched. Every run after that is silent. Somebody who only ever archives X still never downloads Chromium.

Because they are re-derivable, they are cache rather than state: `rm -rf ~/.cache/archiver` is unconditionally safe and costs only a re-download. Your sessions and cookies stay in `~/.local/state/archiver` and are never touched — including by the first Douyin run after this update, which clears out the orphaned `node_modules` an earlier arrangement left beside them.

`setup.sh` stops suggesting installs and pre-warms instead: `setup.sh douyin` or `setup.sh x` builds everything ahead of time, which is what you want before a flight or a long batch. `setup.sh refresh` is new — it rebuilds just the two downloaders at their latest release, for when a platform changes before a fix ships, and keeps them until a newer pin overtakes them. `setup.sh clean` deletes the lot.

`ARCHIVER_SYSTEM_TOOLS=1` puts you back on whatever is on `PATH`. It is all-or-nothing and unsupported, and a build that fails never falls back to it on its own.
