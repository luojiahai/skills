---
"luojiahai-skills": patch
---

archiver: a deep review pass — correctness, security, and numbers you can trust.

Nothing you type changes and no archive is laid out differently. Two things behave differently on purpose, both below.

**Posts that were being lost, silently.** A Douyin post carrying several videos only ever had its *first* file recorded, so once that one landed the post read as finished and the rest stayed missing forever. Every file is recorded now. Posts already on disk are not repaired by this — a post.json listing one file cannot be told apart from a post that only ever had one without refetching it — so this fixes the future, not the past.

An X listing cut off mid-post had the same shape: two of a post's four images recorded, all four downloaded, and the post permanently under-describing itself. Those posts are now refetched and counted in a note.

**Douyin could file a stranger's post under your account.** The page's recommendation links were excluded only if they sat in the footer or carried a search-engine marker; anything else was collected. Harvesting is now scoped to the account's own grid, and every id is checked against the profile feed's own responses before it is filed. A card that fails both is counted and reported rather than archived.

**Numbers the run could not stand behind are now withheld rather than guessed.** A profile count Douyin abbreviates (`作品 1.2万`) explains no gap, because subtracting from a rounded number was wrong by up to five hundred. A listing that hit its scroll limit says so, so the counts beside it are read as comparisons against a partial list. A resumed X `--go` reports the archive's real total instead of just what that run fetched. Posts that could not be dated, ids found in two folders at once, and cards nothing could attribute all reach the document now instead of only stderr.

**Refusals that were crashes.** A Douyin `--go` whose browser profile was locked, and a folder rename that hit a permissions error or a mount boundary, both used to surface as "the archiver crashed" with a stack. Both now say what happened and what to do. A Douyin download that meets a rate limit stops and says so rather than making hundreds more requests into the limiter with your own session.

**An alias you could be locked out of.** `--alias NAME --go` on Douyin renamed the folder without recording the alias, and every later run then read your own alias as another account's id and refused it — permanently. Recording happens with the move now, and an account is never refused its own alias even if `archiver.json` is deleted or copied past.

**Security.** The tool-environment builder's cleanup traps no longer re-parse their argument at fire time, so a cache path holding an apostrophe is neither a syntax error nor an injection point. `git rev-parse` is no longer executed inside whatever repository you happen to be standing in — the project root is found by walking up for a `.git`. Profile images are fetched only over HTTPS from Twitter's own CDN and are size-capped. Session cookie files and the directories holding them are forced to `0600`/`0700` even when they already existed. The `setup.sh` command an agent is told to run is shell-quoted, and is trusted only when it resolves to this skill's own `archive.sh`.

**Two deliberate behaviour changes.**

Consent is now remembered per box rather than once for everything. Agreeing to the ~115MB X needs was being read as agreeing to a quarter of a gigabyte of Chromium, so the first Douyin run after an X-only setup now asks once more. That is intended.

A Douyin `--go` uses the cached `cookies.txt` when its session cookies are still live, and opens a browser only when they are missing or expired. Three separate places in the docs already described it working this way; now it does. An ordinary `--go` opens no browser at all.

**Smaller things.** `--alias -foo` is a usage error instead of a run that quietly archives under the numeric id. An alias or archives path that looks like a hostname no longer dispatches the run into the wrong platform. A URL naming one post gets a message about that post on both platforms. `--downloads` is refused in one place instead of three, and only in flag position. Downloads in the environment builder carry connect and total timeouts, so a captive portal is no longer a skill that hangs with nothing on screen; an interrupted `--refresh` can no longer leave you believing you are on the latest downloaders while running the shipped pins; and abandoned build directories are swept.
