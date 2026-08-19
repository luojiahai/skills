---
'luojiahai-skills': patch
---

archiver: a Douyin run that finished but lost posts to the downloader now exits
0, as X and Instagram already did. A post the downloader cannot have is counted
and stepped over rather than treated as a stop, and the exit went non-zero for
one — which it would then have done on every run of that account from then on.
What was lost is in `run.failed`, and the plan is kept so the retry is cheap.
