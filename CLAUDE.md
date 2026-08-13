Every skill is a folder directly under `skills/` — one flat level, no categories. A skill that isn't ready to ship doesn't live here yet.

A skill folder is named as a **gerund phrase naming the activity** — `preparing-tax-return` — not a bare verb (`prepare-…`) and not a bare noun. Scope qualifiers — jurisdiction, product, platform — live in the **description**, not the name; for a user-invoked skill the description is human-facing and appears beside the name wherever the skill is listed, so that is where a reader meets the scope. A skill whose name is generic owes its scope a stated line in `SKILL.md` and in the top-level `README.md`, and a sentence the agent says out loud on the first run.

Every skill must have a reference in the top-level `README.md` and an entry in `.claude-plugin/plugin.json`'s `skills` array — the Claude Code plugin ships exactly what's in `skills/`.

The repo is its own single-plugin Claude Code marketplace: `.claude-plugin/marketplace.json` lists the one `luojiahai-skills` plugin, sourced from `./`. Run `claude plugin validate . --strict` after touching either manifest.

`.claude-plugin/plugin.json`'s `version` is what Claude Code reads to decide when installed users see an update, and `scripts/sync-plugin-version.mjs` keeps it equal to `package.json`'s. It runs as part of `npm run version`, which the release workflow calls instead of `changeset version` — so never edit either `version` by hand.

Every change that users should hear about carries a changeset: `npx changeset`, then commit the generated `.changeset/*.md`. Merging to `main` opens a `chore: version skills` PR; merging that cuts `CHANGELOG.md` and the git tag.

The top-level `README.md` lists every skill, with the skill name linked to its `SKILL.md`, grouped into **User-invoked** and **Model-invoked**.

Every `SKILL.md` is either user-invoked (`disable-model-invocation: true` plus `policy.allow_implicit_invocation: false` in `agents/openai.yaml`, reachable only by the human) or model-invoked (model- or user-reachable). See [.agents/invocation.md](./.agents/invocation.md).

To (re)link every skill into the local harness skill directories (`~/.claude/skills`, `~/.agents/skills`), run `scripts/link-skills.sh`. Each entry is a symlink into this repo, so a `git pull` keeps installed skills current; re-run the script after adding, removing, or renaming a skill. It only ever adds links — after a rename or removal, delete the stale symlink in each destination by hand, or the old name keeps resolving to a dangling target.

## Agent skills

### Issue tracker

Issues live as GitHub issues in `luojiahai/skills`, driven by the `gh` CLI. See [docs/agents/issue-tracker.md](./docs/agents/issue-tracker.md).

### Triage labels

The five canonical triage roles, each label string equal to its role name. See [docs/agents/triage-labels.md](./docs/agents/triage-labels.md).

### Domain docs

Single-context — one `CONTEXT.md` and one `docs/adr/` at the repo root, both created lazily. See [docs/agents/domain.md](./docs/agents/domain.md).
