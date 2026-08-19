---
"luojiahai-skills": patch
---

archiver: a sync no longer offers you posts it will not download.

Nothing you type changes and no archive is laid out differently. What changes is
which posts a run counts as new.

**Instagram syncs were offering posts that were already archived.** The check
would report a hundred-odd new posts, you would say yes, and the download would
finish having fetched none of them — every one turned out to be on disk already.
It came with an `under-described-posts` note claiming those posts' saved records
were short, which they were not. Both were the same mistake: the check treated
gallery-dl's own file tally as the number of files a post would land, and that
tally includes a reel's soundtrack, which this skill does not archive and
gallery-dl never writes. So every reel with music looked as though it were
missing something, on every run, forever.

Nothing was lost while that was happening and nothing on disk needs repairing:
those posts were complete, and the runs that appeared to do nothing genuinely had
nothing to do. What you lost was the ability to read the block — a sync that says
"108 new" and then "0 downloaded" is indistinguishable from a broken download.

**"Still to fetch" is now one question with one answer.** The half of a run that
counts and the half that downloads were each deciding this for themselves, which
is what let the two disagree; they now share the single definition the archive is
built on — a post is done when its folder holds every file its `post.json` names.
X was never wrong here in practice, but it was free to become so and is now held
to the same rule.
