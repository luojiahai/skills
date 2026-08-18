---
"luojiahai-skills": patch
---

archiver: the platform implementations move into `scripts/platforms/`, and two untested paths gain tests.

Nothing you type changes, no output moves, and no archive is laid out differently. This is the skill's own source being filed differently, plus coverage for two things that had none.

`scripts/x/` and `scripts/douyin/` are now `scripts/platforms/x/` and `scripts/platforms/douyin/`, with `shared/` staying where it is. The filesystem now says what the registry already implied: a platform is a folder you add, and `shared/` is what more than one of them needs. Doing it at two platforms rather than later is the whole point — the cost of the move grows with every platform added.

Two paths no test reached now have them. The dispatcher's resolution of a platform folder — the one call that turns a registry entry into a path on disk — was replaced by a stub in every test, so a registry naming a folder that was not there would have surfaced only when somebody archived a URL for that platform; every registered platform is now resolved for real. Loading Playwright out of the browser box was exercised only by the integration job that imported it, so the refusal when a box holds no Playwright, and the unwrapping that reaches Chromium through a CommonJS default export, are now covered where the rest of the suite runs.

If you are extending the skill: what a platform folder owes is stated in `scripts/platforms/README.md`, beside the folders it governs.
