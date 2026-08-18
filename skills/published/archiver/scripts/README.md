# archiver scripts

Read this before modifying anything here. Each platform folder carries its own
`README.md` with the constraints particular to it; this one covers the layout
they hang off.

## The shape

```
archive.sh          the entry point — find a node, then dispatch.mjs
dispatch.mjs        resolve the platform from the URL, call its main(argv)
testing.mjs         the seam every run-level test goes through — not a test
shared/             what more than one platform needs — README.md beside it
douyin/             the Douyin platform — README.md beside it
x/                  the X platform — README.md beside it
```

The tools these scripts run — yt-dlp, gallery-dl, Playwright, Chromium, and the
Node above them — are the skill's own, built by `../env/ensure-env` into keyed
directories under the cache root. `../env/README.md` is where that is specified;
`shared/paths.mjs` resolves them and `shared/env.mjs` builds them.

`shared/` holds the archive contract and the modules that write it, module by
module in [`shared/README.md`](./shared/README.md). Anything a platform owes the
archive is specified there, not here.

## The URL decides, and nothing else

`dispatch.mjs` is the only thing in the skill that knows more than one platform
exists. It scans the command line for an argument matching a registered
platform's host pattern, and calls that platform's `main(argv)` **in the same
process** — so exit codes and output need no plumbing and a platform owns its
whole command line.

Anything bound for a platform passes through untouched, including the URL, which
the platform parses again to work out what part of the site it names. That is
what lets a platform add a flag without this file changing, and it is what makes
the promise in `SKILL.md` true: whatever the user typed is the platform's usage
error to report, not the dispatcher's to guess at.

What it does parse is only what no platform will ever see: `--list` and the
`--archives` it takes, plus `--help` when there is no platform to answer it.

`--list` is the exception because it is the one command that belongs to no
platform: "which accounts are archived" is a question about the root both
platforms share, so there is nothing to dispatch it to. It is answered before a
platform is loaded, which is also what lets it work on a machine with no
downloader installed and no session — reading the tree is not archiving.

Its account entries are reported exactly as `listing.mjs` composes them. They
answer a different question from a run's counts and have no counterpart there,
so reshaping them to match would cost a rewrite of the largest section of
`SKILL.md` to buy a symmetry nothing consumes.

Every other flag beside it is refused rather than ignored, because `--list` and
`--plan` ask for different things and letting one quietly win is how somebody
who asked to archive an account ends up looking at a listing.

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

A module that runs as an entry point dispatches behind `isMainModule()` from
`shared/cli.mjs`, never a hand-written `import.meta.url` comparison. This skill
is installed by symlink, and node resolves the entry module to its real location
while `process.argv[1]` keeps the path it was handed — so comparing the two
unresolved is false on every installed copy, and the file exits 0 having run
nothing.

## Preflight sits where it can act

`archive.sh` works out which node to run on, plus the `--downloads` refusal. Both
are there because they must happen before node runs or before a platform is
reached: a platform refuses `--downloads` too, but only past its own tool
preflight, so that order would report a build instead of the flag that is
actually wrong.

**`archive.sh` runs on the runtime box's node and no other, and builds nothing.**
A `node` on PATH is never used: the interpreter running the scripts is as much
part of the environment this skill owns as the downloaders are, so "which node
did this run on" has exactly one answer. With no box there is no run — `--help`
and `--list` included — only a `node-missing` refusal naming `setup.sh`.
Building here instead would mean `--help` and a mistyped flag touching the
network, which is the one thing dispatch must never do.

`ARCHIVER_SYSTEM_TOOLS=1` is the exception and is not a fallback: it is set
deliberately, all-or-nothing, and puts the whole run back on PATH — which is
also how the one test that spawns a real `archive.sh` stays hermetic.

Building belongs to the platform that needs it, after its URL is found valid and
immediately before the first tool is reached — a refusable URL should be refused
on any machine, before a byte is downloaded. Each platform names the boxes it
needs and no others, which is what keeps Chromium off the disk of somebody who
only archives X.

Both refusals happen before node exists to compose one, so they write their
envelope by hand. See [`shared/README.md`](./shared/README.md) for the contract
they are writing.

## Every command answers in one document

Stdout carries exactly one JSON document, composed by `shared/output.mjs`;
progress goes to stderr; `--help` and `setup.sh` are the documented exceptions
and stay prose. The envelope, the refusal codes, the note codes and the streams
rule are specified in [`shared/README.md`](./shared/README.md), and the schema is
`shared/output.schema.json`.

## Tests assert what a command returns

`testing.mjs` runs a command's `main(argv, deps)` in-process, takes the one
document off stdout, and validates it against that schema before handing it back.
Every run-level test goes through it, so schema conformance is asserted on every
document every test produces — there is no separate conformance test, and no way
to add an emission path that skips validation by being forgotten.

Assert on the document's fields, not on how it was assembled. A test reaching
into an intermediate object is a test of an implementation detail; the document
is the whole interface `SKILL.md` consumes.
