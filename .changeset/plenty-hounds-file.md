---
'luojiahai-skills': patch
---

archiver: a `--go` that renames the account folder records the rename before it
starts downloading rather than after. A download that was interrupted — rate
limited, or stopped by the user — left the folder moved while `account.json`
still named the folder it had come from and `archiver.json` still mapped the
account to it, so the next run had to repair the archive before it could find it.
