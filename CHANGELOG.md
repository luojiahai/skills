# luojiahai-skills

## 0.1.1

### Patch Changes

- [#1](https://github.com/luojiahai/skills/pull/1) [`fa14e9a`](https://github.com/luojiahai/skills/commit/fa14e9a3a21acd4c2af5e4e0e542a5990da4b57c) Thanks [@luojiahai](https://github.com/luojiahai)! - Ship the repo as **one bundled Claude Code plugin** rather than one plugin per skill, and put a real release pipeline behind it.

  **The plugin is now a bundle.** `.claude-plugin/marketplace.json` lists a single `luojiahai-skills` plugin sourced from `./`, and `.claude-plugin/plugin.json` carries the promoted set as an explicit `skills` array. If you installed the old per-skill plugin, move across with:

  ```
  /plugin uninstall lodge-au-tax-return@luojiahai
  /plugin install luojiahai-skills@luojiahai
  ```

  **Skills live in buckets.** `lodge-au-tax-return` moves to `skills/finance/lodge-au-tax-return`. The promoted/non-promoted split (`finance/` ships; `in-progress/`, `deprecated/`, `misc/`, `personal/` do not) is documented in `CLAUDE.md`, with `AGENTS.md` symlinked to it so Codex reads the same rules.

  **Releases run on changesets.** A changeset per change, a `chore: version skills` PR on merge to `main`, then `CHANGELOG.md` and a git tag. `scripts/sync-plugin-version.mjs` writes the new version into `plugin.json` as part of `npm run version`, so the version Claude reads to offer users an update can't drift from `package.json`'s.

  **Codex parity.** Every skill gains an `agents/openai.yaml` with Codex UI metadata, and `policy.allow_implicit_invocation: false` where the skill is user-invoked — so `/lodge-au-tax-return` stays human-triggered in both harnesses.

  **Licence.** Apache-2.0 with a `NOTICE` becomes MIT. The not-tax-advice declaration is unchanged and still lives in the skill's `SKILL.md`, spoken aloud to you at step 1; the README now carries it as a callout above the install commands.
