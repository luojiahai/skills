---
'luojiahai-skills': patch
---

archiver: run when the skill is installed by symlink

Every command printed nothing and exited 0 — `--plan`, `--go`, even `--help` —
so the skill reported success for a run that never happened. The dispatcher's
entry guard compared `import.meta.url`, which node resolves to the module's real
location, against an unresolved `process.argv[1]`; reached through a symlink the
two never match and `main()` was never called. That is what the skills CLI does
by default, which made a default install of this skill do nothing at all. The
dispatcher now uses the shared `isMainModule()`, which resolves both sides.
