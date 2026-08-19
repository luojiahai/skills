---
'luojiahai-skills': patch
---

archiver: an approved run records who an account folder belongs to before it
starts downloading rather than after, so a download that is interrupted — rate
limited, or stopped by the user — leaves a folder that still says whose it is.
Where the run was also asked to rename the folder, the rename and both records
it owes now land together; before, an interrupted download left the folder moved
while `account.json` named the folder it had come from and `archiver.json` still
mapped the account to it, so the next run had to repair the archive before it
could find it. `--unalias` no longer writes those records twice.
