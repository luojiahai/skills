# luojiahai-skills

## 0.1.6

### Patch Changes

- [#16](https://github.com/luojiahai/skills/pull/16) [`7650fb4`](https://github.com/luojiahai/skills/commit/7650fb4ba61b9bb4b226d21ada624506a224a0ef) Thanks [@luojiahai](https://github.com/luojiahai)! - Simplify `preparing-tax-return`: cut duplicated instructions, and move the routes that are not a normal return into a new `process/lodging.md`.

  The skill said several things twice. The curl fetch technique was written out in full in both `SKILL.md` and `process/rates.md`; `rates.md` is now the only copy. Two places prescribed the statement the agent makes at step 1, and they disagreed on its length — that is now settled once, in step 1. A block of five "properties" restated five rules that each already had a home, and the _Timing_ section restated the prefill calendar and the five-year records rule already carried by steps 1, 4 and 9.

  Non-lodgment advice, amendments, objections, and how to apply for a private ruling only matter on runs that are not a normal return, so they now live in `process/lodging.md` and are reached from step 9. The `myTax lodges an individual return` scope gate moved from the preamble into step 2, where it is applied. No rule was dropped.

## 0.1.5

### Patch Changes

- [#14](https://github.com/luojiahai/skills/pull/14) [`c6eaa67`](https://github.com/luojiahai/skills/commit/c6eaa678c5b7731f6b7d8e8003ddf325c352846b) Thanks [@luojiahai](https://github.com/luojiahai)! - preparing-tax-return: simplify document gathering. The opening interview no longer asks where your records live — batch 0 is now just the spouse question. Step 3 instead walks the document list from step 2 and asks for one document at a time, taking it however you hand it over: pasted into the session, a file dragged in, a path, a link, or dropped into `inbox/`. A document that can be read but not copied, like a paste, has its figures read straight away and its missing bundle copy tracked as Outstanding.

## 0.1.4

### Patch Changes

- [#11](https://github.com/luojiahai/skills/pull/11) [`d4b7876`](https://github.com/luojiahai/skills/commit/d4b7876211e65929b260e3945dd7b086e6070daa) Thanks [@luojiahai](https://github.com/luojiahai)! - Fix the `preparing-tax-return` frontmatter so the skill installs.

  The `description` was an unquoted YAML scalar containing `myTax:` — a colon followed by a space, which YAML reads as the start of a nested mapping. Installers that parse the frontmatter strictly rejected the file ("Nested mappings are not allowed in compact mappings") and skipped the skill, so a fresh install of the plugin found no skills at all. The description is now quoted.

- [#11](https://github.com/luojiahai/skills/pull/11) [`813fb0f`](https://github.com/luojiahai/skills/commit/813fb0fd1e558af7bb731486772d84a76cd2261d) Thanks [@luojiahai](https://github.com/luojiahai)! - `preparing-tax-return` now gathers your documents instead of asking you to read them out.

  Until now the skill told you to download your prefill report and statements and then said nothing about how their contents were supposed to reach it — so every run improvised. There is now a step for it.

  **What it does.** You say where your records live — a folder, an app, email, or scattered — and it reads what is inside the places you name and nothing outside them. It copies each document into a **bundle** beside the worksheet, filed by what the document feeds (`bundle/income/`, `bundle/deductions/`, `bundle/rental/`), renamed so the folder is readable in five years, and indexed. Figures that land on a myTax label are read back to you field by field before they are written down; a pile of receipts is read back as a count and a total. Anything it cannot read, it asks you for — and anything it cannot open goes in the Outstanding register with the label reading `TBC`, so a guessed number cannot reach myTax.

  **Where a return now lives.** One folder per income year, one folder per person inside it:

  ```
  tax-2026/
    sam/
      worksheet.md              the deliverable, and the saved state
      inbox/                    arrived, not yet filed
      bundle/<section>/         the documents, filed by what they feed
    alex/                       a couple lodges two returns, never one joint one
    joint/                      a couple only
      shared.md                 the figures both returns share, worked once
      bundle/<section>/
  ```

  `tax-*/` is added to `.gitignore` when you are in a git working tree, because the folder now holds copies of your income statement and bank statements rather than one markdown file. Identity numbers stay on the documents that carry them and are never written into the worksheet.

  **Couples.** Combined income, family income for the surcharge and rebate tier, and every joint ownership split are worked once in `joint/shared.md`, and each return copies its share from there. It also carries a readiness gate: neither return is handed over until both taxable incomes are settled and both registers are empty, which stops one spouse lodging on the other's estimated income. Two couple figures were also corrected — the dependent-child uplift applies to the family _threshold_ rather than to family income, and SAPTO turns on rebate income rather than family income.

## 0.1.3

### Patch Changes

- [#7](https://github.com/luojiahai/skills/pull/7) [`5af80ac`](https://github.com/luojiahai/skills/commit/5af80ac8f8cb495cd892d58217eb11b6524a811d) Thanks [@luojiahai](https://github.com/luojiahai)! - Rename `prepare-au-tax-return` to **`preparing-tax-return`**. The previous rename fixed the verb but kept the shape: a bare command. Skills are named for the activity they are, so this one is a gerund. Its name has now changed twice in two releases, and it will not change again — the convention is written down in the repo rather than carried in someone's head, which is what caused the churn.

  **The command changes.** `/prepare-au-tax-return` becomes `/preparing-tax-return`. Plugin users need do nothing — the update carries the new name, and the old one stops resolving. If you installed with skills.sh, your existing copy stays where it is; re-add to pick the skill up under its new name. Anyone still on v0.1.1 is coming from `/lodge-au-tax-return` and lands in the same place.

  **The name no longer says Australia; everything around it does.** Jurisdiction now lives in the description rather than the name, so it reads "Australia only" wherever the skill is listed, the README callout leads with it, and the skill says it out loud in its opening statement on every run. This is still the Australian individual return through the ATO's myTax, and nothing in it transfers to another country's return.

  Nothing else about the skill changes — the interview, the nexus/apportionment/substantiation reasoning, the worksheet and the not-tax-advice declaration are all as they were.

## 0.1.2

### Patch Changes

- [#5](https://github.com/luojiahai/skills/pull/5) [`0fe85d8`](https://github.com/luojiahai/skills/commit/0fe85d8684aee2f2ebda7a09854a9e784b829bf2) Thanks [@luojiahai](https://github.com/luojiahai)! - Rename `lodge-au-tax-return` to **`prepare-au-tax-return`**. A skill's name is a promise about what it does, and this one named the single action the skill categorically refuses to perform: it lodges nothing and never touches your ATO account. It prepares; you lodge. The name now says so.

  **The command changes.** `/lodge-au-tax-return` becomes `/prepare-au-tax-return`. Plugin users need do nothing — the update carries the new name, and the old one stops resolving. If you installed with skills.sh, your existing copy stays where it is; re-add to pick the skill up under its new name.

  Nothing else about the skill changes — the interview, the nexus/apportionment/substantiation reasoning, the worksheet and the not-tax-advice declaration are all as they were.

  The README's migration note about the old per-skill plugin (`lodge-au-tax-return@luojiahai`) is removed; that record lives in the v0.1.1 entry below.

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
