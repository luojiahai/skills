---
"luojiahai-skills": patch
---

Tighten the `douyin-downloader` skill. `SKILL.md` no longer restates the design
constraints already held in `scripts/README.md`, and the throttling rationale
moves there too — both are read only when changing the scripts, not when
running one. The sign-in step is now framed as a handoff that says what to do,
rather than two prohibitions, and `.archive.txt` is described once as what makes
a run resumable.
