---
"luojiahai-skills": patch
---

douyin-downloader: one folder per post, and no more archive file

Posts now land in `posts/<date>_<id>/`, holding their media as `1.mp4`, `2.jpg`…
alongside a `text.txt` with the permalink, timestamp and full caption — the same
layout `x-downloader` writes, so a shared downloads folder reads as one archive.
The old `videos/<upload_date> - <title> [<id>].<ext>` naming is gone.

`.archive.txt` is gone with it. Those post folders are now the sole record of
what has downloaded: a post counts as done when its folder holds media, so
deleting a folder is how you ask for it again. yt-dlp's `--download-archive`
keyed on ids rather than paths, so it kept reporting a deleted post as
downloaded and a user who removed a bad download got silence instead of a
re-fetch.

The account folder is now `douyin_<抖音号>` rather than `<抖音号>`, so it cannot
collide with `x-downloader`'s in the downloads root both skills default to.
`--name` renames the account part and keeps the prefix.

**Image posts (图文) are now counted and reported rather than silently dropped.**
They link as `/note/<id>` and the harvest only matched `/video/`, so they were
being lost from every collection with nothing said — the profile's own post
count was the only tell. They still cannot be downloaded (nothing can: yt-dlp's
extractor has no image branch and gallery-dl has no Douyin extractor at all),
but every block now says how many were skipped. Tracked in #39.

Also: printed output says "post" rather than "video" throughout; `--user` is
removed from `download.sh` (a pure alias for the positional URL, which is what
detection reads anyway); `--flat` and `--archive` are removed from
`download-douyin.sh`, along with the `%(uploader)s` template that would have
filed posts under `NA/` whenever a session expired.

Existing archives are not migrated. The next run re-downloads the account into
`posts/`, and the old `videos/` and `.archive.txt` are left untouched for you to
delete by hand.
