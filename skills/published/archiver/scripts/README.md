# archiver scripts

Read this before modifying anything here. Each platform folder carries its own
`README.md` with the constraints particular to it; this one covers the layout
they hang off.

## The shape

```
archive.sh          the entry point — node preflight, then dispatch.mjs
dispatch.mjs        resolve the platform from the URL, call its main(argv)
shared/             what more than one platform needs — README.md beside it
douyin/             the Douyin platform — README.md beside it
x/                  the X platform — README.md beside it
```

`shared/` holds the archive contract and the modules that write it, module by
module in [`shared/README.md`](./shared/README.md). Anything a platform owes the
archive is specified there, not here.

## The URL decides, and nothing else

`dispatch.mjs` is the only thing in the skill that knows more than one platform
exists. It scans the command line for an argument matching a registered
platform's host pattern, and calls that platform's `main(argv)` **in the same
process** — so exit codes and output need no plumbing and a platform owns its
whole command line.

It parses no flags. Everything is passed through, including the URL, which the
platform parses again to work out what part of the site it names. That is what
lets a platform add a flag without this file changing, and it is what makes the
promise in `SKILL.md` true: whatever the user typed is the platform's usage error
to report, not the dispatcher's to guess at.

Because the URL may sit anywhere among the flags, **every** argument is scanned —
so the host patterns in `platforms.mjs` are anchored at the start and must end at
a path, query, fragment or the end of the string. Loosen them and `--archives
./douyin.com` starts dispatching.

Detection answers *which* platform, never whether the URL is archivable. A
single-post URL, a bookmarks page and a suspended account all belong to a
platform, and each is refused by name once dispatched. Refusing them in the
dispatcher would answer "unsupported platform", which is both wrong and
unhelpful.

Two platforms named in one command is a refusal rather than a choice: the run
archives one account into one folder, so picking either URL would silently ignore
the other.

## Adding a platform

A folder under `scripts/` exporting `main(argv)` from its `run.mjs`, and one
entry in `PLATFORMS`. There is nowhere else to remember. What the platform owes
the archive — the folder layout, the seven `post.json` keys, the alias rules — it
gets by using `shared/`, which is where that contract is written down once.

## Preflight sits where it can act

`archive.sh` checks only node, plus the `--downloads` refusal. Both are there
because they must happen before node runs or before a platform is reached: a
platform refuses `--downloads` too, but only past its own tool preflight, so on a
machine missing gallery-dl that order reports the missing tool instead of the
flag that is actually wrong.

Every other tool check belongs to the platform that needs it, after its URL is
found valid — a refusable URL should be refused on any machine, tools installed
or not.
