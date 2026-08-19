---
'luojiahai-skills': patch
---

archiver: a `--go` that refuses the plan no longer renames the account folder.
The rename happened before the plan was read, so `--alias NAME --go` against a
stale plan moved the archive and then reported it had done nothing.
