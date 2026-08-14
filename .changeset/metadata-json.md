---
"luojiahai-skills": patch
---

douyin-downloader, x-downloader: `cursor.json` is now `metadata.json`

**Existing archives are not carried over.** An account folder is found by the
identity written inside it, so a folder still holding a `cursor.json` is no
longer recognised: the next run treats the account as new, creates a second
folder and downloads it again from scratch. Nothing reads `cursor.json` any
more, in either skill.

To keep an existing folder, replace its `cursor.json` with a `metadata.json`
carrying the same identity in the new shape. Renaming the file is enough for
x-downloader, whose cursor already nested the account; douyin-downloader's was
flat, so its three identity fields have to move under `account`:

```jsonc
// x_someone/metadata.json          // douyin_someone/metadata.json
{ "version": 1,                     { "version": 1,
  "account": {                        "account": {
    "id": "…",                          "sec_uid": "…",     // from the old file
    "handle": "…",                      "douyin_id": "…",   // from the old file
    "nickname": "…" } }                 "nickname": "…" } } // from the old file
```

`url`, `root` and `updated_at` fill themselves in on the next run; `version` is
what marks the file as one this release can read.

The file now holds identity and nothing else — the account (`sec_uid` /
`douyin_id` / `nickname`, or `id` / `handle` / `nickname`), the URL it was
archived from, the downloads root the last run used, and a timestamp. The
last-run bookkeeping is gone: `newest_post_id`, `newest_upload_date`,
`collected_count`, `reported_works_count`, the folder name and the run mode.
Every one of them was a second answer to a question the post folders under
`posts/` already answer correctly, and none of them gated anything — resuming a
run has always worked by diffing the collected list against the files on disk,
and still does.

It is now written as soon as an account's folder is resolved, before anything
is downloaded, rather than after a download finishes. A single-post download
records it too. So a folder that exists always says whose it is, which is what
lets a later full run find a folder a single post created instead of starting a
second one for the same account. Folder lookup reads `metadata.json` and only
that; `.plan.json` still carries identity, but purely as the guard that refuses
a plan made for another account.

x-downloader also gains the note douyin-downloader already had: when the
downloads root has moved since the last run, the plan block says which root that
run used, so `on disk 0` cannot be mistaken for a lost archive.
