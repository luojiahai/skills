---
"luojiahai-skills": minor
---

archiver: every command now answers in one structured JSON document

The block-drawn report `--plan` and `--go` printed is gone. Every command —
`--plan`, `--go`, `--yes`, `--list` and `--login` — writes a single JSON document
to stdout and nothing else, under one envelope, and the skill words it for the
user. Progress moves to stderr, and the in-place counter of a long Douyin run is
suppressed when nothing is watching.

Counts are raw integers rather than pre-formatted English. Notes are codes with
their numbers beside them. A refusal is a stable code with typed details and,
where one exists, a remedy that says whether it is the agent's to run or the
user's — so the fifty-odd refusals behind five exit codes can finally be told
apart. A crash produces a document too. `--help` and `setup.sh` stay prose.

The exit codes are unchanged, and so is what gets fetched, where it lands, and
when a question is asked. What the user sees is the same archiver described in
their own language and vocabulary. A list parked by an earlier version is not
read by this one; a fresh collection is the whole remedy.
