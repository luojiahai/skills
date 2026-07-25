Skills are organized into bucket folders under `skills/`:

- `finance/` — the money admin you do yourself
- `in-progress/` — drafts not yet ready to ship
- `deprecated/` — no longer used
- `misc/` — kept around but rarely used, not promoted
- `personal/` — tied to my own setup, not promoted

Only `finance/` exists today. Create a bucket the first time a skill belongs in it — an empty bucket with a `README.md` listing nothing is a doc that lies.

Every skill in a **promoted** bucket (`finance/`, and any future topical bucket) must have a reference in the top-level `README.md` and an entry in `.claude-plugin/plugin.json`'s `skills` array — the Claude Code plugin ships exactly the promoted set. Skills in `in-progress/`, `deprecated/`, `misc/` and `personal/` must not appear in either.

The repo is its own single-plugin Claude Code marketplace: `.claude-plugin/marketplace.json` lists the one `luojiahai-skills` plugin, sourced from `./`. Run `claude plugin validate . --strict` after touching either manifest.

`.claude-plugin/plugin.json`'s `version` is what Claude Code reads to decide when installed users see an update, and `scripts/sync-plugin-version.mjs` keeps it equal to `package.json`'s. It runs as part of `npm run version`, which the release workflow calls instead of `changeset version` — so never edit either `version` by hand.

Every change that users should hear about carries a changeset: `npx changeset`, then commit the generated `.changeset/*.md`. Merging to `main` opens a `chore: version skills` PR; merging that cuts `CHANGELOG.md` and the git tag.

Each skill entry in the top-level `README.md` must link the skill name to its `SKILL.md`.

Each bucket folder has a `README.md` that lists every skill in the bucket with a one-line description, with the skill name linked to its `SKILL.md`. Promoted buckets' `README.md`s and the top-level `README.md` group entries into **User-invoked** and **Model-invoked**; non-promoted bucket `README.md`s use a flat list.

Every `SKILL.md` is either user-invoked (`disable-model-invocation: true` plus `policy.allow_implicit_invocation: false` in `agents/openai.yaml`, reachable only by the human) or model-invoked (model- or user-reachable). See [.agents/invocation.md](./.agents/invocation.md).

To (re)link every skill into the local harness skill directories (`~/.claude/skills`, `~/.agents/skills`), run `scripts/link-skills.sh`. Each entry is a symlink into this repo, so a `git pull` keeps installed skills current; re-run the script after adding, removing, or renaming a skill.

## Agent skills

### Issue tracker

Issues live as GitHub issues in `luojiahai/skills`, driven by the `gh` CLI. See [docs/agents/issue-tracker.md](./docs/agents/issue-tracker.md).

### Triage labels

The five canonical triage roles, each label string equal to its role name. See [docs/agents/triage-labels.md](./docs/agents/triage-labels.md).

### Domain docs

Single-context — one `CONTEXT.md` and one `docs/adr/` at the repo root, both created lazily. See [docs/agents/domain.md](./docs/agents/domain.md).
