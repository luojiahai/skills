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

| Member | What it answers |
| --- | --- |
| `boxes(command)` | Which tool boxes this command needs, and no others. |
| `ensureEnv` | Building them. |
| `preflight` | Whether the downloader is reachable. |
| `session` | What the listing and the fetch run signed in as. |
| `collect` | The listing pass, given the run's stopping rule as a factory. |
| `fetch` | Downloading the posts the plan approved. |
| `commands` | Any command this platform answers that the others do not. |

`plan` and `go` default to the implementations in `shared/run.mjs`, which is
what the two gallery-dl platforms use. A platform whose listing is a different
shape supplies its own: Douyin resolves its folder before the browser opens,
counts against the profile header and drives yt-dlp, so it brings both halves
and shares everything around them.

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
