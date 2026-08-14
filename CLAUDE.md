These rules govern the skills in `skills/`, which ship. The repo's own dev skills in `.claude/skills/` are tooling and follow none of them.

Every skill is a folder directly under `skills/` — one flat level, no categories. `skills/` holds only skills that ship, and a skill that isn't ready to ship doesn't live here yet.

A retired skill moves to `deprecated/` at the repo root. It sits outside `skills/` deliberately: the skills.sh CLI walks `skills/` up to three levels deep and offers whatever it finds there, whatever the manifests declare — so a `deprecated/` *inside* `skills/` would keep distributing the very skills it marks as not-for-distribution. Verified with `npx skills@latest add . --list`, which offered a skill parked in `skills/deprecated/` and did not offer the same skill at the repo root; re-test that way before moving the folder back. Nothing in `deprecated/` is shipped, listed, or linked.

A skill folder is named for the work it does — either a **gerund phrase naming the activity** (`preparing-tax-return`) or an **agent noun naming the tool** (`douyin-downloader`) where the skill is a wrapper over one — never a bare verb (`prepare-…`). Scope qualifiers — jurisdiction, product, platform — live in the **description** rather than the name, unless the scope *is* the skill's identity and the name reads as generic without it (`douyin-downloader`, not `downloader`); the description is human-facing and appears beside the name wherever the skill is listed, so that is where a reader meets the scope. A skill whose name is generic owes its scope a stated line in `SKILL.md` and in the top-level `README.md`, and a sentence the agent says out loud on the first run.

Every skill in `skills/` must have a reference in the top-level `README.md` and an entry in `.claude-plugin/plugin.json`'s `skills` array — the Claude Code plugin ships exactly what's in `skills/`, and nothing in `deprecated/` appears in either place.

The repo is its own single-plugin Claude Code marketplace: `.claude-plugin/marketplace.json` lists the one `luojiahai-skills` plugin, sourced from `./`. Run `claude plugin validate . --strict` after touching either manifest.

`.claude-plugin/plugin.json`'s `version` is what Claude Code reads to decide when installed users see an update, and `scripts/sync-plugin-version.mjs` keeps it equal to `package.json`'s. It runs as part of `npm run version`, which the release workflow calls instead of `changeset version` — so never edit either `version` by hand.

Every change that users should hear about carries a changeset: `npx changeset`, then commit the generated `.changeset/*.md`. Merging to `main` opens a `chore: version skills` PR; merging that cuts `CHANGELOG.md` and the git tag.

The top-level `README.md` names every skill in `skills/`, one sentence each, linked to its `SKILL.md`. `skills/README.md` is the catalogue: the full entry for every skill.

Every skill is invoked by the human typing its name: set `disable-model-invocation: true` in the `SKILL.md` frontmatter and `policy.allow_implicit_invocation: false` in `agents/openai.yaml`. Nothing here starts on its own.

Every skill carries an `agents/openai.yaml` beside its `SKILL.md`, holding the Codex UI metadata — `interface.display_name` and `interface.short_description` — that names it in the skill picker.

To (re)link every skill into the local harness skill directories (`~/.claude/skills`, `~/.agents/skills`), run `scripts/link-skills.sh`. It links every skill in `skills/`, and never links anything in `deprecated/`. Each entry is a symlink into this repo, so a `git pull` keeps installed skills current; re-run the script after adding, removing, renaming, or changing the status of a skill. It only ever adds links — after a rename, a removal, or a retirement, delete the stale symlink in each destination by hand, or the old name keeps resolving to a dangling target.

## Agent skills

### Issue tracker

Issues live as GitHub issues in `luojiahai/skills`, driven by the `gh` CLI. See [docs/agents/issue-tracker.md](./docs/agents/issue-tracker.md).

### Triage labels

The five canonical triage roles, each label string equal to its role name. See [docs/agents/triage-labels.md](./docs/agents/triage-labels.md).

### Domain docs

Single-context — one `CONTEXT.md` and one `docs/adr/` at the repo root, both created lazily. See [docs/agents/domain.md](./docs/agents/domain.md).
