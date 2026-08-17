---
"luojiahai-skills": patch
---

`douyin-archiver` and `x-archiver` are now one skill, **`archiver`**. This is a
**breaking** change to what the skill is called; your archives are read exactly
as they are.

`/douyin-archiver` and `/x-archiver` no longer exist. `/archiver` takes the same
URLs and the same flags:

```bash
/archiver https://www.douyin.com/user/MS4w... --plan
/archiver https://x.com/someone --plan
```

The URL says which platform it is, and you are never asked. A URL from a
platform this skill does not archive is refused by name, listing what it does —
there is no generic fallback, because every promise the skill makes (the post
folder, the `post.json`, the re-run that fetches only what is new) comes from
platform code.

**If you installed the old skills, delete the two stale symlinks by hand.**
`scripts/link-skills.sh` only ever adds links, so `~/.claude/skills/x-archiver`
and `~/.agents/skills/douyin-archiver` will go on resolving to nothing until you
remove them, then re-run the script.

**Your archives are untouched.** Same `archiver.json` schema 3, same
`douyin/<account>/` and `x/<account>/` folders, same `post.json`. Point the new
skill at the root you used before and it picks up where it left off.

**Sessions move** to `~/.local/state/archiver/<platform>/`. Nothing migrates
them, so the first run of each platform asks you to sign in again: `/archiver
<douyin-url> --login` for Douyin, and `--browser chrome` on the first X run.

**A plan parked by an older build is refused**, so the first `--go` after this
asks for a fresh `--plan` rather than acting on a list it half understands.
Plans expire after a day anyway and `sync.json` may be deleted without losing
any archive.

Signing in to Douyin is now its own step and finishing it starts nothing:
`--login` opens a browser, notices the session by itself rather than waiting for
you to press Enter, and stops. A `--plan` with no session refuses instantly
instead of spending half a minute on a grid that cannot render — the two states
used to be indistinguishable, because pressing Enter a moment early looked
exactly like an expired session.

`setup.sh` takes a platform: a bare run checks everything and installs nothing,
`setup.sh douyin` installs the browser that side needs. Someone who only ever
archives X is never handed a Chromium download.

Both platforms now print the same block, and Douyin's gained an `on disk` line
it should always have had.
