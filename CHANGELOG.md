# luojiahai-skills

## 0.1.39

### Patch Changes

- [#107](https://github.com/luojiahai/skills/pull/107) [`5e5dadc`](https://github.com/luojiahai/skills/commit/5e5dadcfeef5e4b5eb1429ccab601587d6d763a2) Thanks [@luojiahai](https://github.com/luojiahai)! - archiver: an alias asked for on a run with nothing left to fetch is now applied, not just announced. `--alias NAME --yes` against an up-to-date archive reported the folder as moving and left it under its id, so the next run announced the same move again and the archive never took the name. All three platforms.

- [#107](https://github.com/luojiahai/skills/pull/107) [`277d64c`](https://github.com/luojiahai/skills/commit/277d64c9f28d6702d12863658f52f679b9181822) Thanks [@luojiahai](https://github.com/luojiahai)! - archiver: a rename on a run with nothing left to fetch now completes all three writes — the folder, `account.json` inside it, and `archiver.json`. Moving the folder alone left the archive naming the folder it had just left.

- [#107](https://github.com/luojiahai/skills/pull/107) [`3376674`](https://github.com/luojiahai/skills/commit/3376674252e00328616e8ddbcf9a70c872b1d218) Thanks [@luojiahai](https://github.com/luojiahai)! - archiver: the three platform runs are one run behind a platform adapter. Internal — the document every command answers with is unchanged.

## 0.1.38

### Patch Changes

- [#103](https://github.com/luojiahai/skills/pull/103) [`4bd6668`](https://github.com/luojiahai/skills/commit/4bd6668508ec0b88d5b9c97b4d0f438e172e98da) Thanks [@luojiahai](https://github.com/luojiahai)! - archiver (Douyin): a re-run stops scrolling once it recognises 20 consecutive posts it already has, instead of scrolling the whole profile every time. `--full` collects the whole profile anyway, and a listing that stopped early withholds the counts that can only be worked out from a complete one.

## 0.1.37

### Patch Changes

- [#101](https://github.com/luojiahai/skills/pull/101) [`cbdec69`](https://github.com/luojiahai/skills/commit/cbdec699441a92d9ee27b8f66a462075f0f39673) Thanks [@luojiahai](https://github.com/luojiahai)! - archiver (x, instagram): lower the early-stop threshold to 20, justified per platform

  A re-run stops once it has passed enough consecutive posts it already has. At 100
  that threshold was enumeration a re-run paid before it could stop, and the two
  platforms did not pay it at the same rate: X sleeps 2s a request over one feed,
  Instagram 6–12s over two, so Instagram paid roughly eight times what X did for
  the same number. Below 100 posts in a feed the stopper never fired at all, and a
  40-reel account re-swept its whole reels feed on every run, forever.

  The threshold's only job is to outlast how far a platform can reorder its own
  timeline, so the number is a claim about platform behaviour. X pins exactly one
  post regardless of age — Premium buys a Highlights tab, not a second pin, and
  that tab is not the timeline this sweep walks. Instagram pins up to three to the
  profile grid, and its reels tab is chronological with no pinning of its own. 20
  clears both blocks several times over, cuts Instagram's re-run enumeration from
  ~160s to ~35s, and fires on the short feeds 100 never reached.

  Two per-platform constants, not one shared constant: each carries its own
  platform's pinning in a comment and is bounded from both sides by tests of its
  own — that it outlasts that platform's pin block, and that it fires inside a feed
  of forty. Neither asserts what the other holds, so either can move without making
  the other's prose lie.

  `stopped_early` now means something milder than it did. At 20 it fires on nearly
  every re-run, and the guard that sends an unfinished download to a full sweep has
  removed what the old "'nothing new' is not proven" caveat was warning about.
  `SKILL.md` reports it plainly instead — a caveat repeated every run is one the
  user stops reading — without claiming in the other direction that nothing under
  the cut can ever be missing.

## 0.1.36

### Patch Changes

- [#99](https://github.com/luojiahai/skills/pull/99) [`3e9ae85`](https://github.com/luojiahai/skills/commit/3e9ae85d3fddcbc6c280860c5dda640895d3829a) Thanks [@luojiahai](https://github.com/luojiahai)! - archiver: a re-run after an interrupted download stops claiming you are up to date.

  Nothing you type changes and no archive is laid out differently. What changes is
  when a check on X or Instagram is allowed to stop scanning early.

  **A download that stopped partway could leave your archive permanently short.**
  The check on those two sites stops once it has passed enough consecutive posts
  you already have, which is safe only while what is on disk is an unbroken run of
  the newest ones. An interrupted download breaks that. Say a check found 405 posts
  and you approved them; the download got through 120 and hit a rate limit. A day
  later the approved list has expired, so the skill sends you back to check again —
  and that check saw its own 120 at the top of the timeline, stopped there, and
  reported nothing new. The 285 posts underneath were never offered again, on that
  run or any run after it.

  **The evidence was already on disk, and is now read.** An approved list is kept
  until every post in it has landed, precisely so an interrupted download can be
  resumed — so a list still sitting there with posts missing from it is proof the
  archive has holes below its newest posts. A check that finds one now scans the
  whole account instead of stopping early, and the missing posts come back in the
  count. It reads that list whether or not it has expired, because expiring is
  exactly what used to spring the trap.

  The same thing happens where the archive turns out to be fine: a check you
  looked at and never downloaded leaves a list sitting there too, and the next
  check on that account scans the whole thing. It is slower and it is never wrong,
  which is the trade — the alternative is an archive that stays short while every
  run tells you it is complete.

  **If a download of yours was ever interrupted before this, run `--full` once.**
  An archive already truncated this way cannot be spotted: the approved list that
  would have proved it is long gone. One full pass per account is enough, and after
  it the guard takes care of itself.

## 0.1.35

### Patch Changes

- [#93](https://github.com/luojiahai/skills/pull/93) [`9621e62`](https://github.com/luojiahai/skills/commit/9621e6265bf7e937e1610a98de1629af15fa0b5c) Thanks [@luojiahai](https://github.com/luojiahai)! - archiver: a sync no longer offers you posts it will not download.

  Nothing you type changes and no archive is laid out differently. What changes is
  which posts a run counts as new.

  **Instagram syncs were offering posts that were already archived.** The check
  would report a hundred-odd new posts, you would say yes, and the download would
  finish having fetched none of them — every one turned out to be on disk already.
  It came with an `under-described-posts` note claiming those posts' saved records
  were short, which they were not. Both were the same mistake: the check treated
  gallery-dl's own file tally as the number of files a post would land, and that
  tally includes a reel's soundtrack, which this skill does not archive and
  gallery-dl never writes. So every reel with music looked as though it were
  missing something, on every run, forever.

  Nothing was lost while that was happening and nothing on disk needs repairing:
  those posts were complete, and the runs that appeared to do nothing genuinely had
  nothing to do. What you lost was the ability to read the block — a sync that says
  "108 new" and then "0 downloaded" is indistinguishable from a broken download.

  **"Still to fetch" is now one question with one answer.** The half of a run that
  counts and the half that downloads were each deciding this for themselves, which
  is what let the two disagree; they now share the single definition the archive is
  built on — a post is done when its folder holds every file its `post.json` names.
  X was never wrong here in practice, but it was free to become so and is now held
  to the same rule.

## 0.1.34

### Patch Changes

- [#91](https://github.com/luojiahai/skills/pull/91) [`32acdcc`](https://github.com/luojiahai/skills/commit/32acdccbf390cbcd15a78b4256cf1850c2579262) Thanks [@luojiahai](https://github.com/luojiahai)! - archiver: archive Instagram accounts

  `/archiver <instagram profile url>` now archives an Instagram account's own posts — single images, carousels and videos — and its reels, alongside the Douyin and X accounts it already handled. The URL still decides the platform and you are never asked.

  Posts and reels are collected as two separate passes, so each can stop early on a re-run without cutting the other short, and every run says which of the two it reached the end of. Stories, highlights and tagged posts are out of scope, and a URL naming one is refused by name rather than attempted — a story is gone within a day, so "a re-run fetches only what's new" could never be true of one.

  Like X, it reads the session out of a browser you're already signed in to, once, and caches it separately. It adds no new downloads for anyone already set up for X. Instagram answers a client going too fast by holding your _account_ behind a challenge rather than by refusing the request, so the pauses between requests are deliberately longer, and a run that meets one now reports it as its own outcome — keeping the cached session, which still works, instead of throwing it away and sending you to sign in again.

  Also fixes a latent bug in the shared archive: post folder names were written with one charset rule and read back with a narrower, digits-only one. No shipped platform could reach it, but any post id that wasn't purely numeric would have been written to disk and then never recognised again, and re-downloaded on every run.

## 0.1.33

### Patch Changes

- [#89](https://github.com/luojiahai/skills/pull/89) [`eb69ce6`](https://github.com/luojiahai/skills/commit/eb69ce6f0fa0b52cdc99fc97a25fff82bd6fd069) Thanks [@luojiahai](https://github.com/luojiahai)! - archiver: the platform implementations move into `scripts/platforms/`, and two untested paths gain tests.

  Nothing you type changes, no output moves, and no archive is laid out differently. This is the skill's own source being filed differently, plus coverage for two things that had none.

  `scripts/x/` and `scripts/douyin/` are now `scripts/platforms/x/` and `scripts/platforms/douyin/`, with `shared/` staying where it is. The filesystem now says what the registry already implied: a platform is a folder you add, and `shared/` is what more than one of them needs. Doing it at two platforms rather than later is the whole point — the cost of the move grows with every platform added.

  Two paths no test reached now have them. The dispatcher's resolution of a platform folder — the one call that turns a registry entry into a path on disk — was replaced by a stub in every test, so a registry naming a folder that was not there would have surfaced only when somebody archived a URL for that platform; every registered platform is now resolved for real. Loading Playwright out of the browser box was exercised only by the integration job that imported it, so the refusal when a box holds no Playwright, and the unwrapping that reaches Chromium through a CommonJS default export, are now covered where the rest of the suite runs.

  If you are extending the skill: what a platform folder owes is stated in `scripts/platforms/README.md`, beside the folders it governs.

## 0.1.32

### Patch Changes

- [#85](https://github.com/luojiahai/skills/pull/85) [`aeae7e9`](https://github.com/luojiahai/skills/commit/aeae7e9d1faa16737b6e06f6809624ba2ba26a77) Thanks [@luojiahai](https://github.com/luojiahai)! - archiver: a deep review pass — correctness, security, and numbers you can trust.

  Nothing you type changes and no archive is laid out differently. Two things behave differently on purpose, both below.

  **Posts that were being lost, silently.** A Douyin post carrying several videos only ever had its _first_ file recorded, so once that one landed the post read as finished and the rest stayed missing forever. Every file is recorded now. Posts already on disk are not repaired by this — a post.json listing one file cannot be told apart from a post that only ever had one without refetching it — so this fixes the future, not the past.

  An X listing cut off mid-post had the same shape: two of a post's four images recorded, all four downloaded, and the post permanently under-describing itself. Those posts are now refetched and counted in a note.

  **Douyin could file a stranger's post under your account.** The page's recommendation links were excluded only if they sat in the footer or carried a search-engine marker; anything else was collected. Harvesting is now scoped to the account's own grid, and every id is checked against the profile feed's own responses before it is filed. A card that fails both is counted and reported rather than archived.

  **Numbers the run could not stand behind are now withheld rather than guessed.** A profile count Douyin abbreviates (`作品 1.2万`) explains no gap, because subtracting from a rounded number was wrong by up to five hundred. A listing that hit its scroll limit says so, so the counts beside it are read as comparisons against a partial list. A resumed X `--go` reports the archive's real total instead of just what that run fetched. Posts that could not be dated, ids found in two folders at once, and cards nothing could attribute all reach the document now instead of only stderr.

  **Refusals that were crashes.** A Douyin `--go` whose browser profile was locked, and a folder rename that hit a permissions error or a mount boundary, both used to surface as "the archiver crashed" with a stack. Both now say what happened and what to do. A Douyin download that meets a rate limit stops and says so rather than making hundreds more requests into the limiter with your own session.

  **An alias you could be locked out of.** `--alias NAME --go` on Douyin renamed the folder without recording the alias, and every later run then read your own alias as another account's id and refused it — permanently. Recording happens with the move now, and an account is never refused its own alias even if `archiver.json` is deleted or copied past.

  **Security.** The tool-environment builder's cleanup traps no longer re-parse their argument at fire time, so a cache path holding an apostrophe is neither a syntax error nor an injection point. `git rev-parse` is no longer executed inside whatever repository you happen to be standing in — the project root is found by walking up for a `.git`. Profile images are fetched only over HTTPS from Twitter's own CDN and are size-capped. Session cookie files and the directories holding them are forced to `0600`/`0700` even when they already existed. The `setup.sh` command an agent is told to run is shell-quoted, and is trusted only when it resolves to this skill's own `archive.sh`.

  **Two deliberate behaviour changes.**

  Consent is now remembered per box rather than once for everything. Agreeing to the ~115MB X needs was being read as agreeing to a quarter of a gigabyte of Chromium, so the first Douyin run after an X-only setup now asks once more. That is intended.

  A Douyin `--go` uses the cached `cookies.txt` when its session cookies are still live, and opens a browser only when they are missing or expired. Three separate places in the docs already described it working this way; now it does. An ordinary `--go` opens no browser at all.

  **Smaller things.** `--alias -foo` is a usage error instead of a run that quietly archives under the numeric id. An alias or archives path that looks like a hostname no longer dispatches the run into the wrong platform. A URL naming one post gets a message about that post on both platforms. `--downloads` is refused in one place instead of three, and only in flag position. Downloads in the environment builder carry connect and total timeouts, so a captive portal is no longer a skill that hangs with nothing on screen; an interrupted `--refresh` can no longer leave you believing you are on the latest downloaders while running the shipped pins; and abandoned build directories are swept.

## 0.1.31

### Patch Changes

- [#81](https://github.com/luojiahai/skills/pull/81) [`1046118`](https://github.com/luojiahai/skills/commit/1046118dfe2805722c58ab7b9a954b3e2cda5209) Thanks [@luojiahai](https://github.com/luojiahai)! - archiver: the skill now downloads and runs its own tools instead of asking you to install any.

  Nothing you type changes, no output moves, and no archive is laid out differently — but the first run after this update will stop and ask before fetching a few hundred megabytes, so it is worth knowing what it is asking for.

  `yt-dlp` and `gallery-dl` ship extractor fixes constantly, because Douyin and X keep changing. A copy of either that happened to be on your machine was a breakage nobody could diagnose from the other end of an issue: nothing said which version ran, and "reinstall your yt-dlp" is not a support answer. So the skill now pins its own `yt-dlp`, `gallery-dl`, Playwright, Chromium, CPython and Node, builds them itself, and uses them always — including when you already have those tools on your `PATH`.

  They go in three directories under `${XDG_CACHE_HOME:-~/.cache}/archiver`, keyed by the versions they were built from: the runtime, the downloaders, and the browser. Around 115MB of download for X and 365MB with Douyin's browser added; roughly 400MB and a little over a gigabyte on disk — Playwright needs both a full Chromium and a headless shell, since every run but the Douyin sign-in is headless and that one is a visible browser you sign in to. Only `curl` is assumed to exist — no Homebrew, no `pip`, no `pipx`, and `scripts/archive.sh` no longer tells a Linux user to run `brew install node`.

  The first time a platform needs them the run refuses, saying how much it will download and where it goes, so the agent can ask you before anything is fetched. Every run after that is silent. Somebody who only ever archives X still never downloads Chromium.

  That includes the Node the skill's own scripts run on, which now comes out of the box like everything else — a `node` on your `PATH` is never used and never consulted, so "which Node did this run on" has exactly one answer. Until the tools are built, every command says so and points at `setup.sh`, `--list` included. Nothing is ever built at dispatch: `--help` and a mistyped flag must not touch the network.

  Because they are re-derivable, they are cache rather than state: `rm -rf ~/.cache/archiver` is unconditionally safe and costs only a re-download. Your sessions and cookies stay in `~/.local/state/archiver` and are never touched — including by the first Douyin run after this update, which clears out the orphaned `node_modules` an earlier arrangement left beside them.

  `setup.sh` stops suggesting installs and pre-warms instead: `setup.sh douyin` or `setup.sh x` builds everything ahead of time, which is what you want before a flight or a long batch. `setup.sh refresh` is new — it rebuilds just the two downloaders at their latest release, for when a platform changes before a fix ships, and keeps them until a newer pin overtakes them. `setup.sh clean` deletes the lot.

  `ARCHIVER_SYSTEM_TOOLS=1` puts you back on whatever is on `PATH`. It is all-or-nothing and unsupported, and a build that fails never falls back to it on its own.

## 0.1.30

### Patch Changes

- [#76](https://github.com/luojiahai/skills/pull/76) [`890b15b`](https://github.com/luojiahai/skills/commit/890b15bb1f5e8ff4a6b669e9a4adc7ddc41b86ff) Thanks [@luojiahai](https://github.com/luojiahai)! - archiver: every command now answers in one structured JSON document

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

## 0.1.29

### Patch Changes

- [#73](https://github.com/luojiahai/skills/pull/73) [`dadb2ee`](https://github.com/luojiahai/skills/commit/dadb2ee06fead9f0db1db27f06e45a08e44f2cd5) Thanks [@luojiahai](https://github.com/luojiahai)! - archiver: invoked with no URL, offer the accounts already archived

  Typing `/archiver` with nothing after it left the skill with nothing to do but
  ask for a URL — including for someone whose only intent was to bring an archive
  they already have up to date, and who now had to go and find the profile URL
  they had used before.

  It now lists what is under the archives root and asks which to sync. The listing
  is read off the tree alone, so it works with no downloader installed and no
  session, and it reads without writing: no stamp, no folder, no repaired alias
  map. Each account shows its folder, who it is, how many post folders are on disk,
  and when it last ran; an account with a list already worked out shows how many of
  them are still to fetch, so saying yes resumes it rather than crawling the
  account again. Picking one takes the URL recorded in
  its `account.json` rather than rebuilding one from a handle, which changes hands.

  The skill writes the listing rather than the script printing it, so it comes in
  the language the conversation is in.

  With nothing archived yet, it says so and explains how the skill is invoked.

## 0.1.28

### Patch Changes

- [#71](https://github.com/luojiahai/skills/pull/71) [`e710d59`](https://github.com/luojiahai/skills/commit/e710d59b95fc814bda44ce9f71e5b5bac3082a51) Thanks [@luojiahai](https://github.com/luojiahai)! - archiver: run when the skill is installed by symlink

  Every command printed nothing and exited 0 — `--plan`, `--go`, even `--help` —
  so the skill reported success for a run that never happened. The dispatcher's
  entry guard compared `import.meta.url`, which node resolves to the module's real
  location, against an unresolved `process.argv[1]`; reached through a symlink the
  two never match and `main()` was never called. `npx skills@latest add` installs
  by symlink by default — it copies the skill to `~/.agents/skills/` and links the
  agent's own skill directory at that copy — so the default install of this skill
  did nothing at all. The dispatcher now uses the shared `isMainModule()`, which
  resolves both sides.

## 0.1.27

### Patch Changes

- [#68](https://github.com/luojiahai/skills/pull/68) [`d91fc98`](https://github.com/luojiahai/skills/commit/d91fc98d1852161796f4a06755675393ecc260d3) Thanks [@luojiahai](https://github.com/luojiahai)! - archiver (x): accept `--full`, `--browser` and `--cookies`

  All three were documented and none were reachable — X parsed its command line
  with the shared defaults, which name neither, so each was refused as an unknown
  option. `--browser NAME` additionally handed `NAME` to the URL slot, letting a
  flag decide which account got archived. X now declares its own flag sets, as
  Douyin does.

## 0.1.26

### Patch Changes

- [#65](https://github.com/luojiahai/skills/pull/65) [`b62cee4`](https://github.com/luojiahai/skills/commit/b62cee4e8bcbd245feb33feff15c63866104184c) Thanks [@luojiahai](https://github.com/luojiahai)! - archiver: `--go` fetches what the approved block counted, on both platforms

  X read its download list from every post the listing pass saw, Douyin from the
  posts the block counted as new. Both are then filtered against what is on disk,
  so the two only parted company when a post's media left the disk between
  `--plan` and `--go`: X re-fetched it, Douyin did not. Both now read the list
  through `approved()` in `shared/plan.mjs`, which is `pending` — a run cannot
  exceed the number the user said yes to, and a post that has gone missing since is
  offered again by the next `--plan` rather than fetched without being counted.

  Douyin also retires a plan by what is on disk rather than by the fetcher's
  report. A downloader that exits clean without writing the files now leaves the
  plan in place, so the retry costs no second listing.

## 0.1.25

### Patch Changes

- [#63](https://github.com/luojiahai/skills/pull/63) [`49c6ffa`](https://github.com/luojiahai/skills/commit/49c6ffa54e89eaf894d0c0e362b467d937ea1feb) Thanks [@luojiahai](https://github.com/luojiahai)! - archiver: correct the maintainer docs, which described files and functions that
  do not exist. `x/README.md` explained Douyin's `post.json` as the work of a
  `download-douyin.sh` that is not in the repo, and named a `--print-to-file` flag
  where the code passes `--print`; `shared/landed.mjs` and `shared/archiver.mjs`
  told a maintainer to keep per-platform copies of themselves in sync, and there
  are no such copies. Dead symbol names (`tweetIdFromFolder`, `load`) now name the
  functions that exist, and the documented test command runs the whole suite
  instead of one file. `SKILL.md` gains the `--cookies FILE` flag, which worked but
  appeared in no documentation.

## 0.1.24

### Patch Changes

- [#60](https://github.com/luojiahai/skills/pull/60) [`5198ecf`](https://github.com/luojiahai/skills/commit/5198ecfaba83eff4650fd6952ccd0a9c74f871bf) Thanks [@luojiahai](https://github.com/luojiahai)! - `douyin-archiver` and `x-archiver` are now one skill, **`archiver`**. This is a
  **breaking** change to what the skill is called; your archives are read exactly
  as they are.

  `/douyin-archiver` and `/x-archiver` no longer exist. `/archiver` takes the same
  URLs and the same flags:

  ```bash
  /archiver https://www.douyin.com/user/MS4w... --plan
  /archiver https://x.com/someone --plan
  ```

  The URL says which platform it is, and you are never asked. A URL from a
  platform this skill does not archive is refused by name, listing what it does —
  there is no generic fallback, because every promise the skill makes (the post
  folder, the `post.json`, the re-run that fetches only what is new) comes from
  platform code.

  **If you installed the old skills, delete the two stale symlinks by hand.**
  `scripts/link-skills.sh` only ever adds links, so `~/.claude/skills/x-archiver`
  and `~/.agents/skills/douyin-archiver` will go on resolving to nothing until you
  remove them, then re-run the script.

  **Your archives are untouched.** Same `archiver.json` schema 3, same
  `douyin/<account>/` and `x/<account>/` folders, same `post.json`. Point the new
  skill at the root you used before and it picks up where it left off.

  **Sessions move** to `~/.local/state/archiver/<platform>/`. Nothing migrates
  them, so the first run of each platform asks you to sign in again: `/archiver
<douyin-url> --login` for Douyin, and `--browser chrome` on the first X run.

  **A plan parked by an older build is refused**, so the first `--go` after this
  asks for a fresh `--plan` rather than acting on a list it half understands.
  Plans expire after a day anyway and `sync.json` may be deleted without losing
  any archive.

  Signing in to Douyin is now its own step and finishing it starts nothing:
  `--login` opens a browser, notices the session by itself rather than waiting for
  you to press Enter, and stops. A `--plan` with no session refuses instantly
  instead of spending half a minute on a grid that cannot render — the two states
  used to be indistinguishable, because pressing Enter a moment early looked
  exactly like an expired session.

  `setup.sh` takes a platform: a bare run checks everything and installs nothing,
  `setup.sh douyin` installs the browser that side needs. Someone who only ever
  archives X is never handed a Chromium download.

  Both platforms now print the same block, and Douyin's gained an `on disk` line
  it should always have had.

## 0.1.23

### Patch Changes

- [#57](https://github.com/luojiahai/skills/pull/57) [`b08ae3a`](https://github.com/luojiahai/skills/commit/b08ae3a45a1b2717b837df18b6aab6abc7d24f2e) Thanks [@luojiahai](https://github.com/luojiahai)! - `douyin-archiver` and `x-archiver` archive an account and nothing else.

  Both take a profile URL. A post URL — `x.com/<handle>/status/<id>`,
  `douyin.com/video/<id>` — is refused before anything is read or written, rather
  than resolved to the account that posted it.

  Downloading a single post is out of scope: use gallery-dl or yt-dlp directly.

  Archives already on disk are unaffected, and the schema is unchanged.

## 0.1.22

### Patch Changes

- [#55](https://github.com/luojiahai/skills/pull/55) [`3846b8b`](https://github.com/luojiahai/skills/commit/3846b8bdac79a6aa9ad4d37769153d0e53b28f88) Thanks [@luojiahai](https://github.com/luojiahai)! - Both archivers can now name an account's folder something you can read. This is
  a **breaking** change to the flag and to the archive layout, though nothing has
  to be migrated by hand.

  `--name` is gone and `--alias` replaces it. Where `--name` was a label filed
  inside `account.json`, `--alias` **names the folder**:

  ```
  archives/x/jia/          instead of  archives/x/1458023001234567890/
  archives/douyin/小明/     instead of  archives/douyin/MS4wLjABAAAAEKnfa654JAJ…/
  ```

  An account already archived is renamed on the next `--go`; a new one is created
  under that name straight away. `--plan` reports the move and never performs it,
  so a preview cannot reorganise your archive. `--unalias` puts a folder back
  under its id — an empty `--alias` means nothing at all, since that is how the
  flag is passed when it has no value.

  `archiver.json` is **schema 3** and now carries the mapping, keyed by the id and
  nested per platform, so the same file can serve both skills without an X `jia`
  and a Douyin `jia` colliding:

  ```json
  { "schema": 3, "accounts": { "x": { "1458023001234567890": "jia" } } }
  ```

  Existing archives are **upgraded in place on the next run** — every schema-2
  folder is already a legal un-aliased schema-3 one, so nothing moves.

  The mapping is a cache rather than an authority. Each folder's `account.json`
  carries the same alias, so a mapping entry pointing at nothing costs a directory
  scan and repairs itself. Rename a folder in Finder and the next run adopts the
  new name: where the folder and the records disagree, the folder wins. A file
  that cannot be _parsed_ still stops the run, since it may be a schema this build
  does not know.

  An alias may be letters in any script, digits, `.`, `_` and `-`. Spaces,
  separators and a leading dot are refused rather than rewritten, as is an alias
  that is another account's id or already another account's alias — all of it
  before anything is fetched.

  Also fixed: a failed single-post run parked a plan whose URL named the _post_,
  and the next account-level `--go` was then refused as "the plan is for another
  account" when it was for this one. `--go` now resolves the folder before reading
  the plan, so the plan is checked against the account's id rather than against a
  URL standing in for it.

## 0.1.21

### Patch Changes

- [#52](https://github.com/luojiahai/skills/pull/52) [`55c4486`](https://github.com/luojiahai/skills/commit/55c4486e0bb7ff8cfb5348c732edac53dbdc45e8) Thanks [@luojiahai](https://github.com/luojiahai)! - Both archivers now write a single shared **schema 2** layout. This is a breaking
  change to the on-disk shape: an archive made by an earlier version is invisible
  to this one, and running against it re-downloads the account in full.

  **Move your archive first.** There is no automatic migration and no detection of
  the old layout. Either start a fresh root, or convert the old one by hand.

  ```
  <archives root>/
    archiver.json                          {"schema": 2}
    x/<numeric user id>/
      account.json
      sync.json
      assets/{avatar.<ext>, banner.<ext>}
      posts/<YYYY-MM-DD|undated>_<id>/
        post.json
        1.jpg, 2.mp4, …
    douyin/<sec_uid>/
      account.json
      sync.json
      posts/<YYYY-MM-DD|undated>_<id>/
        post.json
        1.mp4
  ```

  **The account folder is the account's immutable id**, under a platform folder,
  replacing the `x_<handle>` / `douyin_<抖音号>` prefixes. Finding an account's
  folder is now a path lookup rather than a scan, and a renamed handle or a changed
  抖音号 can no longer orphan an archive. `--name` is kept but is now a _label_
  recorded inside `account.json`, never a folder name — so it cannot collide, and
  a later run can still find the account by it.

  **`post.json` replaces `text.txt`**, and carries the permalink, timestamp, full
  caption, what the post replies to, and the media it holds. It is written
  _before_ the media rather than after, so it describes the post rather than
  claiming it landed — the archive's rule is unchanged, that a post counts as
  downloaded when every file it lists is on disk, and deleting any of them
  re-fetches it.

  - **douyin-archiver gains a completeness check it never had.** yt-dlp reports no
    file count for Douyin, so "downloaded" could previously only mean "the folder
    holds at least one file" — a post whose media failed after its text was
    written read as complete. Now it does not.
  - **Captions are no longer plain text.** They are JSON-escaped inside
    `post.json`, so `grep -r` across an archive no longer returns readable lines.

  **`metadata.json` becomes `account.json`**, holding identity and provenance only:
  the `root` and `updated_at` it used to carry were run history and have moved.
  **`.plan.json` becomes `sync.json`** — unhidden, holding the plan awaiting
  approval between `--plan` and `--go` plus a note of what the last run did.
  Deleting `sync.json` loses no archive content. Neither file records progress;
  that is still answered by the post folders alone.

  **x-archiver keeps the account's avatar and banner** in `assets/`, overwritten
  each run, at no extra request — the URLs already ride on the rows the listing
  pass reads. Douyin has both concepts but nothing reads them out of the profile
  page yet, so a Douyin account folder simply has no `assets/`.

  **`archiver.json` at the root records the schema version.** A version this build
  does not know stops the run before anything is read or written, rather than
  silently re-downloading. A missing one reads as current, so a subtree copied to
  another disk still works.

## 0.1.20

### Patch Changes

- [#49](https://github.com/luojiahai/skills/pull/49) [`fc6ac77`](https://github.com/luojiahai/skills/commit/fc6ac776ed2183497235d5d015b3e8d9dcfb6b27) Thanks [@luojiahai](https://github.com/luojiahai)! - `douyin-downloader` is now **`douyin-archiver`**, and `x-downloader` is now
  **`x-archiver`**. The skills archive; the tools they drive still download.

  **Rename your folder.** The default root moved from `<git root>/downloads/` to
  `<git root>/archives/`, and `--downloads DIR` is now `--archives DIR`. An
  existing archive is not found at the old path — rename `downloads/` to
  `archives/`, or pass `--archives` pointing at it. The old flag is rejected with
  an error rather than ignored, so a stale command fails loudly instead of
  quietly re-fetching an account into the wrong place.

  **Both skills: your saved session is gone.** The state directory follows the
  skill's name, so `~/.local/state/douyin-downloader/` is now
  `~/.local/state/douyin-archiver/`, and `~/.local/state/x-downloader/` is now
  `~/.local/state/x-archiver/`.

  - **douyin-archiver** — that held the browser session, cookies and
    `node_modules`. Re-run `./setup.sh` and sign in once more. The Chromium
    download is cached separately, under `~/Library/Caches/ms-playwright`, and is
    not repaid.
  - **x-archiver** — that held the cached X cookies. The next run reads them from
    your browser again, so pass `--browser NAME` once, as on a first install.

  **If you installed with the skills.sh CLI**, the next `skills update` reports
  both skills as deleted upstream — update matches on the recorded path, and both
  paths changed. Decline the removal and re-add under the new names:

  ```bash
  npx skills@latest add luojiahai/skills --skill douyin-archiver
  npx skills@latest add luojiahai/skills --skill x-archiver
  ```

  Claude Code plugin installs pick up the new names on update; invoke
  `/douyin-archiver` and `/x-archiver`.

## 0.1.19

### Patch Changes

- [#46](https://github.com/luojiahai/skills/pull/46) [`c396aed`](https://github.com/luojiahai/skills/commit/c396aed8a98e58f556bcebec7eb0aeddea3bb2ee) Thanks [@luojiahai](https://github.com/luojiahai)! - Skills now live under a tier: `skills/published/<name>` for what ships, `skills/deprecated/<name>` for what used to. Retirement is no longer a matter of where a folder sits — a retired skill carries `metadata.internal: true` in its frontmatter, which is what actually stops the skills.sh CLI offering it, at any depth and under `--full-depth`.

  **If you installed with the skills.sh CLI, your next `skills update` will report `douyin-downloader` and `x-downloader` as deleted upstream, and offer to remove them.** They have not gone anywhere — update matches on the recorded path, and their paths changed. Decline the removal and re-add to heal the lock:

  ```bash
  npx skills@latest add luojiahai/skills --skill douyin-downloader
  npx skills@latest add luojiahai/skills --skill x-downloader
  ```

  Claude Code plugin installs are unaffected and need nothing.

## 0.1.18

### Patch Changes

- [#44](https://github.com/luojiahai/skills/pull/44) [`5bc0223`](https://github.com/luojiahai/skills/commit/5bc0223a274e2689706ef7f0a83d284279bd1acf) Thanks [@luojiahai](https://github.com/luojiahai)! - Split the skill write-ups out of the root README into a catalogue

  The root `README.md` now names each skill in one sentence, linked to its
  `SKILL.md`, and points at a new `skills/README.md` that carries the full entry
  for every skill — what it fetches, where it lands, what it needs installed, and
  what it costs you. The shop window stays skimmable; the depth is one click away
  and reachable directly on GitHub.

  One consent line stays in the root README regardless: both skills run on your
  own signed-in session and archive to your own disk.

  The `Why These Skills Exist` heading, which shipped with a `TODO` under it, is
  removed until there is something to put there. The Quickstart no longer lists
  the two skill names as examples — it says to type the skill's name, which stays
  true however many there are.

  Documentation only — no skill behaviour changes, and the frontmatter of both
  skills is untouched.

## 0.1.17

### Patch Changes

- [#42](https://github.com/luojiahai/skills/pull/42) [`ea4df03`](https://github.com/luojiahai/skills/commit/ea4df03f3513705ad31e2764702dc62819f17784) Thanks [@luojiahai](https://github.com/luojiahai)! - douyin-downloader, x-downloader: `cursor.json` is now `metadata.json`

  **Existing archives are not carried over.** An account folder is found by the
  identity written inside it, so a folder still holding a `cursor.json` is no
  longer recognised: the next run treats the account as new, creates a second
  folder and downloads it again from scratch. Nothing reads `cursor.json` any
  more, in either skill.

  To keep an existing folder, replace its `cursor.json` with a `metadata.json`
  carrying the same identity in the new shape. Renaming the file is enough for
  x-downloader, whose cursor already nested the account; douyin-downloader's was
  flat, so its three identity fields have to move under `account`:

  ```jsonc
  // x_someone/metadata.json          // douyin_someone/metadata.json
  { "version": 1,                     { "version": 1,
    "account": {                        "account": {
      "id": "…",                          "sec_uid": "…",     // from the old file
      "handle": "…",                      "douyin_id": "…",   // from the old file
      "nickname": "…" } }                 "nickname": "…" } } // from the old file
  ```

  `url`, `root` and `updated_at` fill themselves in on the next run; `version` is
  what marks the file as one this release can read.

  The file now holds identity and nothing else — the account (`sec_uid` /
  `douyin_id` / `nickname`, or `id` / `handle` / `nickname`), the URL it was
  archived from, the downloads root the last run used, and a timestamp. The
  last-run bookkeeping is gone: `newest_post_id`, `newest_upload_date`,
  `collected_count`, `reported_works_count`, the folder name and the run mode.
  Every one of them was a second answer to a question the post folders under
  `posts/` already answer correctly, and none of them gated anything — resuming a
  run has always worked by diffing the collected list against the files on disk,
  and still does.

  It is now written as soon as an account's folder is resolved, before anything
  is downloaded, rather than after a download finishes. A single-post download
  records it too. So a folder that exists always says whose it is, which is what
  lets a later full run find a folder a single post created instead of starting a
  second one for the same account. Folder lookup reads `metadata.json` and only
  that; `.plan.json` still carries identity, but purely as the guard that refuses
  a plan made for another account.

  x-downloader also gains the note douyin-downloader already had: when the
  downloads root has moved since the last run, the plan block says which root that
  run used, so `on disk 0` cannot be mistaken for a lost archive.

## 0.1.16

### Patch Changes

- [#40](https://github.com/luojiahai/skills/pull/40) [`3f1068e`](https://github.com/luojiahai/skills/commit/3f1068e2c7b50b0c8b175756a08840e0cc095dd4) Thanks [@luojiahai](https://github.com/luojiahai)! - douyin-downloader: one folder per post, and no more archive file

  Posts now land in `posts/<date>_<id>/`, holding their media as `1.mp4`, `2.jpg`…
  alongside a `text.txt` with the permalink, timestamp and full caption — the same
  layout `x-downloader` writes, so a shared downloads folder reads as one archive.
  The old `videos/<upload_date> - <title> [<id>].<ext>` naming is gone.

  `.archive.txt` is gone with it. Those post folders are now the sole record of
  what has downloaded: a post counts as done when its folder holds media, so
  deleting a folder is how you ask for it again. yt-dlp's `--download-archive`
  keyed on ids rather than paths, so it kept reporting a deleted post as
  downloaded and a user who removed a bad download got silence instead of a
  re-fetch.

  The account folder is now `douyin_<抖音号>` rather than `<抖音号>`, so it cannot
  collide with `x-downloader`'s in the downloads root both skills default to.
  `--name` renames the account part and keeps the prefix.

  **Image posts (图文) are now counted and reported rather than silently dropped.**
  They link as `/note/<id>` and the harvest only matched `/video/`, so they were
  being lost from every collection with nothing said — the profile's own post
  count was the only tell. They still cannot be downloaded (nothing can: yt-dlp's
  extractor has no image branch and gallery-dl has no Douyin extractor at all),
  but every block now says how many were skipped. Tracked in [#39](https://github.com/luojiahai/skills/issues/39).

  Also: printed output says "post" rather than "video" throughout; `--user` is
  removed from `download.sh` (a pure alias for the positional URL, which is what
  detection reads anyway); `--flat` and `--archive` are removed from
  `download-douyin.sh`, along with the `%(uploader)s` template that would have
  filed posts under `NA/` whenever a session expired.

  Existing archives are not migrated. The next run re-downloads the account into
  `posts/`, and the old `videos/` and `.archive.txt` are left untouched for you to
  delete by hand.

- [#40](https://github.com/luojiahai/skills/pull/40) [`3f1068e`](https://github.com/luojiahai/skills/commit/3f1068e2c7b50b0c8b175756a08840e0cc095dd4) Thanks [@luojiahai](https://github.com/luojiahai)! - x-downloader: prefix the account folder with `x_`

  The account folder is now `x_<handle>` rather than `<handle>`. Both this skill
  and `douyin-downloader` default to the same `<git root>/downloads` root, so an X
  handle that happened to match a 抖音号 would have interleaved two accounts in one
  folder; the prefix makes that impossible. `--name` renames the account part and
  keeps the prefix, so there is no name that can be chosen that collides.

  Existing folders keep working without being renamed — an account is found under
  the root by matching its numeric id inside `cursor.json`, never by folder name.

## 0.1.15

### Patch Changes

- [#37](https://github.com/luojiahai/skills/pull/37) [`262535e`](https://github.com/luojiahai/skills/commit/262535e7a8fc040a1cbf271f8d4698723d9834eb) Thanks [@luojiahai](https://github.com/luojiahai)! - Add `x-downloader`: archive the media an X (formerly Twitter) account has posted, or a single post.

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
