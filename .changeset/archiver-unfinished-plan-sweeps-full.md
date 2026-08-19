---
"luojiahai-skills": patch
---

archiver: a re-run after an interrupted download stops claiming you are up to date.

Nothing you type changes and no archive is laid out differently. What changes is
when a check on X or Instagram is allowed to stop scanning early.

**A download that stopped partway could leave your archive permanently short.**
The check on those two sites stops once it has passed enough consecutive posts
you already have, which is safe only while what is on disk is an unbroken run of
the newest ones. An interrupted download breaks that. Say a check found 405 posts
and you approved them; the download got through 120 and hit a rate limit. A day
later the approved list has expired, so the skill sends you back to check again —
and that check saw its own 120 at the top of the timeline, stopped there, and
reported nothing new. The 285 posts underneath were never offered again, on that
run or any run after it.

**The evidence was already on disk, and is now read.** An approved list is kept
until every post in it has landed, precisely so an interrupted download can be
resumed — so a list still sitting there with posts missing from it is proof the
archive has holes below its newest posts. A check that finds one now scans the
whole account instead of stopping early, and the missing posts come back in the
count. It reads that list whether or not it has expired, because expiring is
exactly what used to spring the trap.

The same thing happens where the archive turns out to be fine: a check you
looked at and never downloaded leaves a list sitting there too, and the next
check on that account scans the whole thing. It is slower and it is never wrong,
which is the trade — the alternative is an archive that stays short while every
run tells you it is complete.

**If a download of yours was ever interrupted before this, run `--full` once.**
An archive already truncated this way cannot be spotted: the approved list that
would have proved it is long gone. One full pass per account is enough, and after
it the guard takes care of itself.
