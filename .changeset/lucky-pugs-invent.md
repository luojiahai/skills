---
"luojiahai-skills": patch
---

archiver: an alias asked for on a run with nothing left to fetch is now applied, not just announced. `--alias NAME --yes` against an up-to-date archive reported the folder as moving and left it under its id, so the next run announced the same move again and the archive never took the name. All three platforms.
