---
"luojiahai-skills": patch
---

archiver: correct the maintainer docs, which described files and functions that
do not exist. `x/README.md` explained Douyin's `post.json` as the work of a
`download-douyin.sh` that is not in the repo, and named a `--print-to-file` flag
where the code passes `--print`; `shared/landed.mjs` and `shared/archiver.mjs`
told a maintainer to keep per-platform copies of themselves in sync, and there
are no such copies. Dead symbol names (`tweetIdFromFolder`, `load`) now name the
functions that exist, and the documented test command runs the whole suite
instead of one file. `SKILL.md` gains the `--cookies FILE` flag, which worked but
appeared in no documentation.
