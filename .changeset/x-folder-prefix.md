---
"luojiahai-skills": patch
---

x-downloader: prefix the account folder with `x_`

The account folder is now `x_<handle>` rather than `<handle>`. Both this skill
and `douyin-downloader` default to the same `<git root>/downloads` root, so an X
handle that happened to match a 抖音号 would have interleaved two accounts in one
folder; the prefix makes that impossible. `--name` renames the account part and
keeps the prefix, so there is no name that can be chosen that collides.

Existing folders keep working without being renamed — an account is found under
the root by matching its numeric id inside `cursor.json`, never by folder name.
