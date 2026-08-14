---
"luojiahai-skills": patch
---

douyin-downloader now says when your archive holds posts the profile no longer lists.

An archive only grows, so a post that stops appearing on the account stays
yours — and from then on the folder outnumbers the profile, with nothing in a
run's output accounting for the difference. A run that collected 86 videos and
reported `87 total` read as a counting bug, and `collected_count: 86` in
`cursor.json` next to it read worse.

Both blocks now note the gap:

```
 collected   86 of 86 reported
 note        1 archived post no longer on the profile
 downloaded  1 new, 87 total
```

The note claims only what was observed — an id in the archive that the listing
no longer carries. Deleted, made private, region-locked, missed by a collection
that stopped short, or fetched by `/video/` id and never on the profile at all
are indistinguishable from the outside, so it names none of them.

Nothing new is recorded to make this work: no field is added to `cursor.json`,
and the count is derived from the collected list and the archive on every run,
so it cannot go stale or survive a run that failed halfway.
