---
"luojiahai-skills": patch
---

douyin-downloader: a refused plan now actually stops `--go`.

The refusal contract — a plan that is missing, stale, or made for a different
account or root is refused rather than downloaded — printed its refusal and
then kept going: bash disables `set -e` inside a function invoked under `||`,
so the run fell through to "downloading 0 video(s)", wrote the cursor anyway
(merging a foreign plan's identity into `cursor.json` in the worst case), and
printed a summary telling the user to re-run the very `--go` that had just
failed. `run_plan` is now invoked plainly with an explicit guard on the plan
load, and the lesson is recorded in `scripts/README.md`.

Also in this hardening pass, verified against a live account:

- A single-video run now ends with the same rendered summary block as every
  other run, on failure as well as success, instead of a bare folder path (or,
  on failure, nothing).
- The profile-header read is polled instead of one fixed 3-second attempt, so
  a slow header no longer discards a whole collection pass.
- The cookie-export domain filter is anchored (`notdouyin.com` no longer
  matches), `setup.sh` no longer swallows a failed Chromium install silently,
  the download log tempfile is cleaned up on interrupt, and `v.douyin.com`
  share links get a pointed error instead of a generic one.
- `--meta` is documented in `collect-douyin-ids.mjs`, SKILL.md's setup/login
  handoffs use full `<skill-dir>` paths, and `cursor.mjs` imports
  `.plan.json`'s filename from `plan.mjs` instead of duplicating it (the one
  spelling left in `download.sh` is shell, which cannot import).
- New unit tests for `cli.mjs` (including the valueless-flag regression its
  header warns about) and `cursor.mjs`'s merge and newest-upload rules, plus
  the previously untested `validatePlan` folder-mismatch and hour/minute age
  branches — 63 tests, up from 45.
