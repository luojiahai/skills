# luojiahai-skills

## 0.2.0

### Minor Changes

- [#35](https://github.com/luojiahai/skills/pull/35) [`1ba14d9`](https://github.com/luojiahai/skills/commit/1ba14d9fb951e5faec734f5b60f804f1322575eb) Thanks [@luojiahai](https://github.com/luojiahai)! - Add `x-downloader`: archive the media an X (formerly Twitter) account has posted, or a single post.

  It follows `douyin-downloader`'s shape — it enumerates first, reports whose account it is, where the files would go, how many posts exist and how many you don't already have, and waits for your yes before fetching anything. Re-runs pick up only what's new.

  Images, videos and GIFs, from the account's own posts and its replies to itself. Each post gets its own date-named folder holding its media and a `text.txt` with the full post text, so a post stays a self-contained unit and the archive still sorts as a timeline. Retweets, quoted posts and text-only posts are left alone; likes and bookmarks are out of scope.

  It runs on gallery-dl, and on your own signed-in X session — read out of your browser once and cached after that, because X's login cannot be scripted. Worth knowing before the first run: bulk archiving is what X's automation rules exist to catch, and the realistic failure is your account being rate-limited or locked rather than a download failing.

## 0.1.14

### Patch Changes

- [#33](https://github.com/luojiahai/skills/pull/33) [`d11af39`](https://github.com/luojiahai/skills/commit/d11af3961146791bd882aeafe378bafdfe9ca215) Thanks [@luojiahai](https://github.com/luojiahai)! - douyin-downloader: a refused plan now actually stops `--go`.

  The refusal contract — a plan that is missing, stale, or made for a different
  account or root is refused rather than downloaded — printed its refusal and
  then kept going: bash disables `set -e` inside a function invoked under `||`,
  so the run fell through to "downloading 0 video(s)", wrote the cursor anyway
  (merging a foreign plan's identity into `cursor.json` in the worst case), and
  printed a summary telling the user to re-run the very `--go` that had just
  failed. `run_plan` is now invoked plainly with an explicit guard on the plan
  load, and the lesson is recorded in `scripts/README.md`.

  Also in this hardening pass, verified against a live account:

  - A single-video run now ends with the same rendered summary block as every
    other run, on failure as well as success, instead of a bare folder path (or,
    on failure, nothing).
  - The profile-header read is polled instead of one fixed 3-second attempt, so
    a slow header no longer discards a whole collection pass.
  - The cookie-export domain filter is anchored (`notdouyin.com` no longer
    matches), `setup.sh` no longer swallows a failed Chromium install silently,
    the download log tempfile is cleaned up on interrupt, and `v.douyin.com`
    share links get a pointed error instead of a generic one.
  - `--meta` is documented in `collect-douyin-ids.mjs`, SKILL.md's setup/login
    handoffs use full `<skill-dir>` paths, and `cursor.mjs` imports
    `.plan.json`'s filename from `plan.mjs` instead of duplicating it (the one
    spelling left in `download.sh` is shell, which cannot import).
  - New unit tests for `cli.mjs` (including the valueless-flag regression its
    header warns about) and `cursor.mjs`'s merge and newest-upload rules, plus
    the previously untested `validatePlan` folder-mismatch and hour/minute age
    branches — 63 tests, up from 45.

## 0.1.13

### Patch Changes

- [#31](https://github.com/luojiahai/skills/pull/31) [`fd19d77`](https://github.com/luojiahai/skills/commit/fd19d771f22090ae8bbc2fe756aa12714f131b5e) Thanks [@luojiahai](https://github.com/luojiahai)! - Retire `preparing-tax-return`. It is no longer shipped as part of the plugin and is no longer maintained. Retired skills now live in `deprecated/` at the repo root, outside `skills/`, so nothing in them is distributed.

## 0.1.12

### Patch Changes

- [#29](https://github.com/luojiahai/skills/pull/29) [`2c3841d`](https://github.com/luojiahai/skills/commit/2c3841da250c7921b9717f5be199d70aca27042b) Thanks [@luojiahai](https://github.com/luojiahai)! - douyin-downloader now says when your archive holds posts the profile no longer lists.

  An archive only grows, so a post that stops appearing on the account stays
  yours — and from then on the folder outnumbers the profile, with nothing in a
  run's output accounting for the difference. A run that collected 86 videos and
  reported `87 total` read as a counting bug, and `collected_count: 86` in
  `cursor.json` next to it read worse.

  Both blocks now note the gap:

  ```
   collected   86 of 86 reported
   note        1 archived post no longer on the profile
   downloaded  1 new, 87 total
  ```

  The note claims only what was observed — an id in the archive that the listing
  no longer carries. Deleted, made private, region-locked, missed by a collection
  that stopped short, or fetched by `/video/` id and never on the profile at all
  are indistinguishable from the outside, so it names none of them.

  Nothing new is recorded to make this work: no field is added to `cursor.json`,
  and the count is derived from the collected list and the archive on every run,
  so it cannot go stale or survive a run that failed halfway.

## 0.1.11

### Patch Changes

- [#27](https://github.com/luojiahai/skills/pull/27) [`e577d42`](https://github.com/luojiahai/skills/commit/e577d428f8ac67343e4b7196a7f882437a61576e) Thanks [@luojiahai](https://github.com/luojiahai)! - douyin-downloader now asks before it downloads, and lets you choose where videos land.

  A run on an account is in two halves. The first collects the account's video list and reports it — whose account it is, the folder it would use, how many videos it found and how many of those you don't already have — and downloads nothing. Only after you say yes does the second half fetch exactly that list, without collecting again. Nothing new to fetch means nothing to approve: it says the account is up to date and stops. A single `/video/` URL still downloads straight away, being as specific as an instruction gets already.

  `--downloads DIR` now reaches the skill, so `/douyin-downloader <url> --downloads ~/data` archives into `~/data/<抖音号>` instead of `./downloads/`. Passing the same folder again resumes that archive from wherever you run it; the folder is found by matching the account, whatever it is named. The default is unchanged, and each account's `cursor.json` now records the root it last used, so a run that finds it somewhere else says so.

  If you type `--yes` yourself, that counts as the confirmation and the run goes straight through — the skill will not ask you again.

  Also fixes a long-standing bug where downloading a single unavailable video exited silently with no message, taking the cookie-refresh retry down with it.

## 0.1.10

### Patch Changes

- [#25](https://github.com/luojiahai/skills/pull/25) [`75a1324`](https://github.com/luojiahai/skills/commit/75a1324146230840d2f0e93420bbca7b1b3b7d0d) Thanks [@luojiahai](https://github.com/luojiahai)! - douyin-downloader: stop downloads landing inside the skill folder. Told to run
  `scripts/download.sh`, an agent tends to cd into the skill first, and in a
  project that is not a git repository the download root was then the skill's own
  directory — where the next update deletes the archive. A cwd inside the skill is
  now discarded: the project is recovered from the install path, and where that
  names none the run stops and asks for `--downloads DIR` rather than guessing.

## 0.1.9

### Patch Changes

- [#22](https://github.com/luojiahai/skills/pull/22) [`fff08e3`](https://github.com/luojiahai/skills/commit/fff08e3aceb8431f0a15775b62f3d959cdcaa52f) Thanks [@luojiahai](https://github.com/luojiahai)! - Tighten the `douyin-downloader` skill. `SKILL.md` no longer restates the design
  constraints already held in `scripts/README.md`, and the throttling rationale
  moves there too — both are read only when changing the scripts, not when
  running one. The sign-in step is now framed as a handoff that says what to do,
  rather than two prohibitions, and `.archive.txt` is described once as what makes
  a run resumable.

## 0.1.8

### Patch Changes

- [#20](https://github.com/luojiahai/skills/pull/20) [`c116179`](https://github.com/luojiahai/skills/commit/c1161794b2641edf14403608e6aa5d49dfd9fd36) Thanks [@luojiahai](https://github.com/luojiahai)! - Add **`douyin-downloader`** — download every video from a Douyin account, or a single video, into `./downloads/`. Re-running an account fetches only what is new, so you can point it at the same profile months later without pulling down what you already have.

  **It needs two things installed, and one thing from you.** [yt-dlp](https://github.com/yt-dlp/yt-dlp) and Node, both checked by the skill's `setup.sh`, which tells you what is missing rather than installing it behind your back. Then a one-off Douyin sign-in: a browser opens, you sign in, and the session is reused from then on — every later run is headless. Only a human can pass that login, so the skill never tries.

  **This is the first skill in the set that ships executable scripts and a dependency.** Everything before it was Markdown the agent reads. This one bundles bash and Node and installs Playwright, because there is no prose-only way to do the job: yt-dlp has no Douyin account extractor, and Douyin's feed API rejects unsigned requests, so the list of an account's videos can only be read out of a real browser page. Nothing mutable is written into the skill directory — the session, the cookies and the dependency all live in `~/.local/state/douyin-downloader/`, so a plugin update replacing the skill leaves them alone and you never sign in twice.

  **It fetches; it doesn't publish.** Videos land in a folder in your project and nothing is uploaded anywhere. What you may keep and what you may do with it is between you, Douyin's terms and the uploader's copyright. The pauses between requests are deliberate — a run with them stripped out gets cut off partway.

- [#20](https://github.com/luojiahai/skills/pull/20) [`649cac3`](https://github.com/luojiahai/skills/commit/649cac3722ca6ff39ab97dee48d374265253a5f3) Thanks [@luojiahai](https://github.com/luojiahai)! - Skills now live directly under `skills/`, not in category folders: `skills/preparing-tax-return` and `skills/douyin-downloader`.

  The skills keep their names, so nothing changes if you install through the plugin or `skills@latest`. If you have this repo checked out and linked with `scripts/link-skills.sh`, re-run it.

## 0.1.7

### Patch Changes

- [#18](https://github.com/luojiahai/skills/pull/18) [`41f2356`](https://github.com/luojiahai/skills/commit/41f2356dfc2ebe7833bdff8b7236cd60595f7be9) Thanks [@luojiahai](https://github.com/luojiahai)! - Cut the bookkeeping out of `preparing-tax-return`. A real run spent 46 file edits on 8 documents before it finished gathering them; most of that was the skill tracking the same state in four places.

  **Steps 2 and 3 are now one step, and the rest renumber 3–8.** Marking the sections and gathering the documents always happened together — a user answering _what did you have income from_ hands over the statement in the same breath — so the skill now says so, and the **Documents** table is a gap list rather than a worklist written up front.

  **Where a document came from is no longer recorded.** The `Original name` column in the index and `Arrived as` in the worksheet held the same fact — that the file arrived from the user's Downloads folder — and nothing read either one. A paste, a path, a link and a photograph of paper all go the same way now.

  **The `document`/`copy` distinction is gone.** It cost a column, two explainer paragraphs and a done-when clause to carry one consequence, which is now a single line: an entry whose figure has already been read keeps that figure; one with nothing read leaves the label at `TBC`.

  **The worksheet's Bundle table is gone**, along with the joint one in `SHARED.md`. Every column was derivable from `ls bundle/` and the section indexes, it was hand-maintained on every document, and its summary drifted into restating the index.

  **A section index records confirmed figures only.** Rows used to carry a _confirmed_ / _awaiting confirmation_ flag that needed a bulk update after each round — the run corrupted its own index doing exactly that. A row is now written when the user confirms it.

  **Section indexes gain a `Working` section.** The run invented its own heading for the reconciliations that proved no dividend statement was missing and that a salary-sacrifice figure tied to the share plan — the most valuable thing it produced, with nowhere to live.

  **`inbox/` is dropped**, and the worksheet template sheds the agent instructions it was shipping into the user's own file.

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
