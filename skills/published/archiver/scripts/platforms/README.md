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
