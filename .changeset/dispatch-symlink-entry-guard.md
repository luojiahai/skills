---
'luojiahai-skills': patch
---

archiver: run when the skill is installed by symlink

Every command printed nothing and exited 0 — `--plan`, `--go`, even `--help` —
so the skill reported success for a run that never happened. The dispatcher's
entry guard compared `import.meta.url`, which node resolves to the module's real
location, against an unresolved `process.argv[1]`; reached through a symlink the
two never match and `main()` was never called. `npx skills@latest add` installs
by symlink by default — it copies the skill to `~/.agents/skills/` and links the
agent's own skill directory at that copy — so the default install of this skill
did nothing at all. The dispatcher now uses the shared `isMainModule()`, which
resolves both sides.
