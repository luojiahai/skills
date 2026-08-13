---
"luojiahai-skills": patch
---

douyin-downloader now asks before it downloads, and lets you choose where videos land.

A run on an account is in two halves. The first collects the account's video list and reports it — whose account it is, the folder it would use, how many videos it found and how many of those you don't already have — and downloads nothing. Only after you say yes does the second half fetch exactly that list, without collecting again. Nothing new to fetch means nothing to approve: it says the account is up to date and stops. A single `/video/` URL still downloads straight away, being as specific as an instruction gets already.

`--downloads DIR` now reaches the skill, so `/douyin-downloader <url> --downloads ~/data` archives into `~/data/<抖音号>` instead of `./downloads/`. Passing the same folder again resumes that archive from wherever you run it; the folder is found by matching the account, whatever it is named. The default is unchanged, and each account's `cursor.json` now records the root it last used, so a run that finds it somewhere else says so.

If you type `--yes` yourself, that counts as the confirmation and the run goes straight through — the skill will not ask you again.

Also fixes a long-standing bug where downloading a single unavailable video exited silently with no message, taking the cookie-refresh retry down with it.
