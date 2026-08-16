---
"luojiahai-skills": patch
---

Both archivers now write a single shared **schema 2** layout. This is a breaking
change to the on-disk shape: an archive made by an earlier version is invisible
to this one, and running against it re-downloads the account in full.

**Move your archive first.** There is no automatic migration and no detection of
the old layout. Either start a fresh root, or convert the old one by hand.

```
<archives root>/
  archiver.json                          {"schema": 2}
  x/<numeric user id>/
    account.json
    sync.json
    assets/{avatar.<ext>, banner.<ext>}
    posts/<YYYY-MM-DD|undated>_<id>/
      post.json
      1.jpg, 2.mp4, …
  douyin/<sec_uid>/
    account.json
    sync.json
    posts/<YYYY-MM-DD|undated>_<id>/
      post.json
      1.mp4
```

**The account folder is the account's immutable id**, under a platform folder,
replacing the `x_<handle>` / `douyin_<抖音号>` prefixes. Finding an account's
folder is now a path lookup rather than a scan, and a renamed handle or a changed
抖音号 can no longer orphan an archive. `--name` is kept but is now a *label*
recorded inside `account.json`, never a folder name — so it cannot collide, and
a later run can still find the account by it.

**`post.json` replaces `text.txt`**, and carries the permalink, timestamp, full
caption, what the post replies to, and the media it holds. It is written
*before* the media rather than after, so it describes the post rather than
claiming it landed — the archive's rule is unchanged, that a post counts as
downloaded when every file it lists is on disk, and deleting any of them
re-fetches it.

- **douyin-archiver gains a completeness check it never had.** yt-dlp reports no
  file count for Douyin, so "downloaded" could previously only mean "the folder
  holds at least one file" — a post whose media failed after its text was
  written read as complete. Now it does not.
- **Captions are no longer plain text.** They are JSON-escaped inside
  `post.json`, so `grep -r` across an archive no longer returns readable lines.

**`metadata.json` becomes `account.json`**, holding identity and provenance only:
the `root` and `updated_at` it used to carry were run history and have moved.
**`.plan.json` becomes `sync.json`** — unhidden, holding the plan awaiting
approval between `--plan` and `--go` plus a note of what the last run did.
Deleting `sync.json` loses no archive content. Neither file records progress;
that is still answered by the post folders alone.

**x-archiver keeps the account's avatar and banner** in `assets/`, overwritten
each run, at no extra request — the URLs already ride on the rows the listing
pass reads. Douyin has both concepts but nothing reads them out of the profile
page yet, so a Douyin account folder simply has no `assets/`.

**`archiver.json` at the root records the schema version.** A version this build
does not know stops the run before anything is read or written, rather than
silently re-downloading. A missing one reads as current, so a subtree copied to
another disk still works.
