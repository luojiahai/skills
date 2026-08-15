Every skill is a folder one level under a tier: `skills/published/<name>` or `skills/deprecated/<name>`. Nothing else under `skills/` is a skill, and a skill that isn't ready to ship doesn't live here yet.

A skill is retired by adding `metadata.internal: true` to its `SKILL.md` frontmatter — an unquoted YAML boolean, because the skills.sh CLI tests `metadata?.internal === true` and a quoted `"true"` ships the skill. That flag is the only thing that stops distribution. Directory placement does not: the CLI treats `skills/` as a priority container walked three deep, and its fallback sweep (`findSkillDirs(dir, depth = 0, maxDepth = 5)`) recurses five levels through the whole tree, so it reaches `skills/deprecated/` and would reach a `deprecated/` at the repo root too. `INSTALL_INTERNAL_SKILLS=1` is the documented escape hatch for installing flagged skills.

Retiring is therefore two moves that must happen together — `git mv` the folder into `skills/deprecated/` and add the flag. `scripts/skill-manifest.mjs` enforces the pair: a skill outside a tier, a deprecated skill without the flag, or a published skill wearing one all fail `npm run check:skills`.

Re-test retirement after touching any of this. All three commands, in this order:

```bash
npx skills@latest add . --list                                        # published only
npx skills@latest add . --list --full-depth                           # still published only
INSTALL_INTERNAL_SKILLS=1 npx skills@latest add . --list --full-depth  # retired ones appear
```

The third is the one that matters: without it, a passing test cannot tell "the flag hid it" from "the walker didn't reach it".

A skill folder is named for the work it does — either a **gerund phrase naming the activity** (`preparing-tax-return`) or an **agent noun naming the tool** (`douyin-downloader`) where the skill is a wrapper over one — never a bare verb (`prepare-…`). Scope qualifiers — jurisdiction, product, platform — live in the **description** rather than the name, unless the scope *is* the skill's identity and the name reads as generic without it (`douyin-downloader`, not `downloader`); the description is human-facing and appears beside the name wherever the skill is listed, so that is where a reader meets the scope. A skill whose name is generic owes its scope a stated line in `SKILL.md` and in the top-level `README.md`, and a sentence the agent says out loud on the first run.

Every skill in `skills/published/` must have a reference in the top-level `README.md`. Its entry in `.claude-plugin/plugin.json`'s `skills` array is generated, never hand-edited: `npm run sync:skills` writes the array from `skills/published/` minus anything flagged, `npm run check:skills` fails on drift in CI, and `npm run version` regenerates it for the release PR. That array cannot hide anything — the CLI reads it only to add search paths and set the display heading, so listing a skill is the only thing it does.

The repo is its own single-plugin Claude Code marketplace: `.claude-plugin/marketplace.json` lists the one `luojiahai-skills` plugin, sourced from `./`. Run `claude plugin validate . --strict` after touching either manifest — but know its reach. Because `marketplace.json` exists, validate takes the marketplace route and checks the two JSON manifests only, never the skills; and a skill listed by a nested path is existence-checked, not validated. `npm run check:skills` is what actually holds skill frontmatter to account.

`.claude-plugin/plugin.json`'s `version` is what Claude Code reads to decide when installed users see an update, and `scripts/sync-plugin-version.mjs` keeps it equal to `package.json`'s. It runs as part of `npm run version`, which the release workflow calls instead of `changeset version` — so never edit either `version` by hand.

Every change that users should hear about carries a changeset: `npx changeset`, then commit the generated `.changeset/*.md`. Merging to `main` opens a `chore: version skills` PR; merging that cuts `CHANGELOG.md` and the git tag.

The top-level `README.md` names every skill in `skills/published/`, one sentence each, linked to its `SKILL.md`; it is the shop window and lists only what ships. `skills/README.md` is the catalogue: the full entry for every published skill, plus a Retired section naming each skill in `skills/deprecated/`, what it did and why it went.

Every skill is invoked by the human typing its name: set `disable-model-invocation: true` in the `SKILL.md` frontmatter and `policy.allow_implicit_invocation: false` in `agents/openai.yaml`. Nothing here starts on its own.

Every skill carries an `agents/openai.yaml` beside its `SKILL.md`, holding the Codex UI metadata — `interface.display_name` and `interface.short_description` — that names it in the skill picker.

To (re)link every skill into the local harness skill directories (`~/.claude/skills`, `~/.agents/skills`), run `scripts/link-skills.sh`. It links every skill in `skills/`, retired ones included — retirement governs what this repo distributes, not what you can run locally, and the flag keeps working once linked because `~/.claude/skills` is itself one of the CLI's search directories. Codex is the exception: its `agents/openai.yaml` schema has no hide or disable field and its frontmatter parser never reads `metadata.internal`, so a retired skill in `~/.agents/skills` is indistinguishable there from a live one. Each entry is a symlink into this repo, so a `git pull` keeps installed skills current; re-run the script after adding, removing, renaming, or changing the status of a skill. It only ever adds links — after a rename, a removal, or a retirement, delete the stale symlink in each destination by hand, or the old name keeps resolving to a dangling target.

## Agent skills

### Issue tracker

Issues live as GitHub issues in `luojiahai/skills`, driven by the `gh` CLI. See [docs/agents/issue-tracker.md](./docs/agents/issue-tracker.md).

### Triage labels

The five canonical triage roles, each label string equal to its role name. See [docs/agents/triage-labels.md](./docs/agents/triage-labels.md).

### Domain docs

Single-context — one `CONTEXT.md` and one `docs/adr/` at the repo root, both created lazily. See [docs/agents/domain.md](./docs/agents/domain.md).
