# Platforms

One folder per platform, and nothing else. Each is reached only through
`dispatch.mjs`, which resolves it from the registry in
[`../shared/platforms.mjs`](../shared/platforms.mjs); nothing outside this
directory imports a module inside one.

## What a platform folder owes

A folder here exporting `main(argv)` from its `run.mjs`, and one entry in
`PLATFORMS`. There is nowhere else to remember: the entry names this folder and
`dispatch.mjs` composes the path, so the layout is known in one place. What the
platform owes the archive — the folder layout, the seven `post.json` keys, the
alias rules — it gets by using `../shared/`, which is where that contract is
written down once.

`main` is `runAccount(ADAPTER, argv)` and nothing else. The run belongs to
[`../shared/run.mjs`](../shared/run.mjs); what a folder here holds is the
adapter — the descriptor from the registry, the usage prose, the flags, and the
behaviour this platform does its own way:

**Data — what this platform is.**

| Member | What it holds |
| --- | --- |
| `platform`, `account`, `postIdKey` | From the registry. Never respelled here. |
| `usage` | The whole `--help` text, as prose. |
| `booleans`, `flags` | The command line this platform accepts. |
| `threshold` | The streak an incremental sweep stops on — a claim about this platform's reordering, so it stays with it. |
| `failures` | How this extractor's failures classify. |
| `refusals` | The wording of `empty`, `unidentified` and `bad-account-id`, which only this platform can phrase. `empty` is given the listing result and may answer `null`, for a platform that recognises the silence and would rather the plan described it. |
| `site` | What the cookie cache is keyed by, from the registry. Named apart from `session`, which is the step. |

**Behaviour — what this platform does its own way.**

| Member | What it answers |
| --- | --- |
| `boxes(command)` | Which tool boxes this command needs, and no others. |
| `ensureEnv` | Building them. |
| `preflight` | Whether the downloader is reachable. |
| `session` | What the listing and the fetch run signed in as. |
| `collect` | The listing pass, given the target, the adapter, the run's account callback and its stopping rule as a factory. The callback is what settles the account folder, so a platform whose URL already names the account fires it before opening anything. |
| `collectRefusal` | What a listing that did not answer means, given the whole result rather than its stderr. |
| `fetch` | Downloading the posts the plan approved, given the adapter. Anything only this downloader knows comes back under `platform`, which the run carries to `runNotes` without reading. |
| `commands` | Any command this platform answers that the others do not. |
| `parseTarget` | What a URL of this platform's names. |
| `groupFiles`, `diff` | Rows into posts, and posts against the archive. |
| `platformCounts`, `planNotes` | What only this platform can count, or has to say. `planNotes` is given the counts and the account folder as well as the listing. |
| `runNotes` | Rewriting the notes a finished run carries, for a platform with one that describes the folder rather than the listing pass — dropping the stale one as well as adding the fresh one. |
| `progressLabel` | The line a long download writes per post. |
| `afterFetch` | Anything refreshed on every approved run — X's avatar and banner. Not simply the tail of `fetch`, because a run with nothing to fetch still passes here. |
| `discardSession` | Throwing a rejected session away. |

A gallery-dl platform takes the boxes, the preflight, the session descriptor and
the failure classification from `galleryDlAdapter` in
[`../shared/gallerydl.mjs`](../shared/gallerydl.mjs), spread into its own
adapter, and names only what is its alone.

A member left `undefined` in a caller's overrides is absent rather than
overriding, so a test bench builds one bag of fakes for a whole file and names
the one member it wants the real implementation of.

There is one listing half and one download half, in `shared/run.mjs`, and every
platform goes through the whole of both. A platform brings hooks, never a stage:
a stage replaced is a stage whose order, writes and refusals are that platform's
to get right again, and what looks like a different shape is nearly always a
difference the hooks above already express. Douyin's account is named by its own
URL, so its `collect` fires the run's account callback before opening a browser
— which is what that callback always meant. This is recorded as
[ADR-0001](../../../../../docs/adr/0001-a-platform-brings-hooks-not-stages.md).

`collect` and `fetch` are handed the adapter, as `session` and `preflight` are,
so a hook can reach the platform's own members. A member that wraps something of
this platform's own is a member in its own right underneath — Douyin's `collect`
and `fetch` wrap `list` and `download` — so a test drives the real thing and the
wrapping still runs.

A command a platform declares in `commands` is dispatched by name, so the run
never learns what it is called — `--login` is Douyin's, and the other two carry
no trace of it.

A `README.md` beside `run.mjs`, carrying what is particular to that platform:
what the site refuses, what it needs signed in, which downloader it drives.

`run.mjs` is an entry point, so it dispatches behind `isMainModule()` under the
rule in [`../README.md`](../README.md) that governs every entry point here.

Every registered platform is resolved for real by `dispatch.test.mjs`, so an
entry naming a folder that is not here fails the suite rather than somebody's
run.

## What is not a platform's to hold

A tool more than one platform could want belongs in `../shared/`, threaded with
a descriptor where the platforms differ. A tool exactly one platform drives
belongs in that platform's folder: `douyin/playwright.mjs` names Douyin's state
directory and refuses with Douyin's remedy, and is a Douyin module for that
reason rather than shared infrastructure that happens to sit here.
