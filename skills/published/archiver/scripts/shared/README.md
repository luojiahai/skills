# Shared modules

What more than one platform needs. A rule that drifts between two copies of
these corrupts an archive every platform reads, so there is one copy and the
platforms are threaded with a descriptor where they differ.

| File | Role |
| --- | --- |
| `platforms.mjs` | The registry: every platform this skill knows, the host patterns that resolve a URL to one, each one's account descriptor, and what its collected posts call their own id. |
| `plan.mjs` | The confirm step: what a plan means, and the rules that refuse a stale or foreign one. |
| `account.mjs` | Where an account's folder is, and the identity written inside it. Takes a descriptor, because the platform folder and the name of the readable handle are the only things that vary. |
| `landed.mjs` | What is already downloaded, answered from the post folders themselves. |
| `post.mjs` | The shape of `post.json`, and whether a post holds every file it lists. |
| `naming.mjs` | A post folder's name, and a moment as a string. Built and read back in one place. |
| `sync.mjs` | `sync.json`: the parked plan and the last run's history. Deletable without loss. |
| `listing.mjs` | What is already archived under a root, across every platform, as facts for `SKILL.md` to word. Reads and never writes. |
| `output.mjs` | **The one document every command answers with**, and the builders that fill it. Every command serialises through it. |
| `errors.mjs` | Every refusal this skill can make, as a code with an exit beside it, and the `Refusal` a module raises when it has no business emitting one. |
| `output.schema.json` | That document's JSON Schema. Every document a test produces is validated against it, so "did we change the contract" is a reviewable diff. |
| `archiver.mjs` | The archives root's schema version, the id → alias map, and the refusal when the schema is one this build cannot read. |
| `paths.mjs` | Where state lives, where the tool boxes are, and where archives land. |
| `env.mjs` | Building those boxes before they are needed, and the refusals when that cannot happen. |
| `cli.mjs` | Argument parsing, file reading, atomic JSON writing, entry-point detection. |
| `exit.mjs` | One exit table, so a shell caller can tell "rate-limited" from "you typed the flag wrong" without knowing which platform ran. |
| `gallerydl.mjs` | The two command lines every gallery-dl platform builds — one listing, one fetch. Takes a descriptor, because the extractor's config keys, its pauses and the rows it prints are the only things that vary. |
| `session.mjs` | The browser session a gallery-dl platform runs on, as a cookies.txt: where it is cached, how it is minted, and when it is thrown away. Takes a descriptor, because the platform's name and its label in a refusal are the only things that vary. |
| `tools.mjs` | Whether a downloader is on PATH, and the refusal when it is not. Reachable only through the `ARCHIVER_SYSTEM_TOOLS` escape hatch. |
| `subprocess.mjs` | Running a downloader and reading what it said, so every platform answers "what did it exit with" the same way — including for a process that never started. |
| `run.mjs` | The decisions every platform's run makes identically: which mode a command line asked for, so `--yes` outranks a `--plan` appended after it, whether a re-run may stop once it recognises enough posts and the streak rule it stops on, and the `sweep` note saying which of the two it did. Each platform's threshold stays with the platform, because it is a claim about that platform's reordering. |

## The archive every platform writes

One root, one shape. This is the contract the modules above implement, and the
reason they are shared rather than copied.

```
<archives root>/
  archiver.json                 {"schema": 3, "accounts": {…}}
  x/<alias, else user id>/      douyin/<alias, else sec_uid>/
  instagram/<alias, else user id>/
    account.json
    sync.json
    assets/                     (x only — see below)
    posts/<YYYY-MM-DD|undated>_<id>/
      post.json
      1.jpg, 2.mp4, …
```

### The post folders

- `posts/<YYYY-MM-DD|undated>_<id>/`, one folder per post, `undated` a literal.
  The id is whatever that platform calls a post: a numeric id on X and Douyin, a
  base64ish shortcode on Instagram. `naming.mjs` writes and reads it by one
  charset rule — a name written by one half and unreadable to the other is a
  post counted as missing forever and re-downloaded on every run
- media numbered by position — `1.jpg`, `2.mp4`
- `post.json`: `version`, `id`, `permalink`, `timestamp`, `text`, `reply_to`,
  `media`, in that order and holding nothing else. Written **before** the media.
  `media[].url` and `media[].id` are optional and often absent.
- a post counts as downloaded when every file its `post.json` lists is present

### The account folder

The account folder is the account's `--alias` if it has one and its immutable id
if it does not, under a platform folder. Every platform defaults to the same
`<git root>/archives` root, so without the platform folder an alias chosen on one
could collide with one chosen on another.

An alias is refused if it is another account's id on that platform, or already
another account's alias. Letters (`\p{L}`, so CJK), digits, `.`, `_`, `-`; no
spaces, no separators, no leading dot, 128 chars.

`account.json`'s `alias` is always `basename(dir)`, written from the folder
rather than from the flag. That is the whole of "the folder's location wins": a
directory renamed by hand is adopted by the next write, and the two cannot drift.
An empty `--alias` is silence; `--unalias` is the removal.

A rename is three writes in one order — the folder, then `account.json` inside
it, then `archiver.json` — because the tree is the truth and the root file is a
cache. A crash before the last one is repaired by the next scan. `--plan` never
moves anything; `--go` does.

### The three files

- `account.json` beside `posts/`, holding `version`, `platform`, `account` and
  `url` and nothing else — authoritative for identity, never for progress. The
  alias is a key *inside* `account`, beside the id, so the file stays four keys
  wide. Every platform writes it when the folder is resolved, merges into what is
  already there, and treats a blank as silence rather than an erasure.
- `sync.json` beside it, holding `version`, `plan` and `last_run`. **Deleting it
  loses no archive content.** That sentence is the whole specification of the
  file: every field in it has to keep the sentence true, and a field whose loss
  costs the user a post is the wrong field. Nothing a run consults to decide what
  to fetch belongs here — in particular no resumption cursor, which would make a
  run shorter in *result* rather than merely cheaper, missing posts a reordered
  feed has pushed below the mark.
- `archiver.json` at the root, holding the schema version and `accounts`, an
  id → alias map nested per platform. Absent reads as current; unknown stops the
  run; **schema 2 is readable and upgraded in place**, since every schema-2
  folder is a legal un-aliased schema-3 one. An account with no alias has no
  entry. A mapping entry pointing at a folder that is not there is a stale cache
  line and self-heals; a file that cannot be *parsed* stops the run, because it
  may be a schema from the future and rebuilding it would clobber it.

There is no fourth file, and there must not be one. The post folders are the
record of what has landed: a post is downloaded when every file its `post.json`
lists is on disk. Do not add a download archive, a done-marker, or any record
written *after* the media — each is a second record, free to go on claiming a
post has landed after its files are deleted by hand.

## Plan, then go

Nothing about an account can be reported before it is collected — not the name,
not the post count, and certainly not how many are new. So the run is split:
`--plan` collects, diffs and reports; `--go` downloads what the report described.
In between, the list waits in `<folder>/sync.json`, which is why confirming costs
no second collection and why what is fetched is exactly what was shown.

`validatePlan` refuses a plan rather than repairing it. It is refused when it is
missing, unreadable by this build, without a usable timestamp, older than 24h,
made for a different account or a different archives root, or left with nothing
still to download. The alternative to refusing is downloading a list the user
never approved. There is no folder check
and none is needed: a plan is read out of the account folder it was written into,
so "a plan for another folder" is not a state that can be reached. The identity
check compares account **ids**, not the URL the plan was made from, because
`--go` resolves the folder before it reads the plan.

A plan is deleted once every post in it has landed, and kept when a run stops
partway, so a retry re-fetches only what is missing.

`--yes` does both halves in one process, for using the scripts by hand. The skill
never reaches for it — an agent asks — but it outranks a `--plan` or `--go` that
comes after it on the command line, so a user who typed it keeps their
pre-authorisation when the skill appends its own mode flag. Last-one-wins would
take that back. `pickMode` here in `shared/run.mjs` is the one implementation,
and every platform imports it.

## One envelope

Every command writes exactly one JSON document to stdout and nothing else.
`output.mjs` composes it, and nothing in it branches on which platform is
running.

```json
{ "schema": 1, "ok": true, "command": "plan", "platform": "x",
  "exit": 0, "result": { … }, "error": { … } }
```

Its reader is `SKILL.md`, not a person. The skill words the outcome for somebody
who typed `/archiver`, has never seen this command line, and may not be reading
in English — so what leaves here is facts, in the user's own numbers rather than
in one fixed English layout for all of them.

- `command` is `null`, with `platform` null too, only where nothing was
  dispatched: a bare invocation, a URL naming no supported platform, two
  platforms at once.
- `exit` repeats the process exit code, because output gets captured and read
  away from the process that produced it.
- `error` is present exactly when `ok` is false. `result` is present whenever
  the run got far enough to have one, **independently of `ok`** — a `--go` that
  rate-limits mid-download carries both, because a run that fetched two hundred
  posts and then stopped is neither a success nor a nothing.
- `ok` answers "was this run refused or stopped", which is not "did the exit
  code say zero". A Douyin `--go` that lost three posts to the downloader
  finished as asked and still exits `FAILED`, because shell callers read a lost
  post as a non-zero exit. It is `ok`, with the posts it lost in
  `result.run.failed`.

The document a user approves and the one a finished run reports have to agree —
same counts, same rule for counting what is on disk — and they only reliably
agree by being the same code. That is why one module owns this and platforms
hand it facts rather than assembling their own object.

What genuinely differs arrives as data the platform supplied:

- `account` — the identity fields, with the readable handle named by the
  descriptor (`handle`, `douyin_id`)
- `counts.platform` — what only one platform knows, as counts: X's file totals
  and image/video split, Instagram's the same plus how many of the posts are
  reels, Douyin's header count and skipped image posts. A figure a short
  listing cannot stand behind goes out as `null`, which is unknown rather than
  zero. They
  nest inside `counts` because they *are* counts, which leaves `details` meaning
  one thing only — the facts behind a refusal.
- `notes` — anything one platform has to say and the others do not, each a
  `{ code, … }` with its numbers beside it: Douyin's unfetchable image posts,
  a sweep that stopped early, one such sweep per feed on Instagram

A rule keyed off wording is a rule that breaks the next time the wording
changes, which is the whole reason a note is a code and a count is an integer.

### Refusals

```json
{ "code": "plan-stale", "message": "…", "details": {},
  "remedy": { "message": "…", "command": "…", "run_by": "agent | user" } }
```

`errors.mjs` holds every code with the exit it pins to. The table is exhaustive:
`exitFor` throws for a code that is not in it, and every document a test produces
is validated against `output.schema.json`, whose enum is that same table.

**`message` is a fallback, not a user-facing string.** The agent branches on
`code` and words the outcome itself. The message exists so a refusal added to
these scripts after `SKILL.md` was written degrades to something sayable rather
than to silence, and it is reworded before it reaches anybody. The skill must
never relay it verbatim: the prose belongs in `SKILL.md`, and a message read out
as written is that prose back in the scripts.

`remedy` is present only where one exists, and `run_by` is load-bearing rather
than decorative: re-running a plan is the agent's to do, and so is asking the
user whether to download the tool environment, while signing in to X in a
browser and the `--login` handoff are the user's.

A module that cannot compose a document — it knows the archives root is inside
the skill, but not which command is running — throws a `Refusal` instead, and
the run that catches it fills in the envelope.

### Streams

Stdout carries the one document. Progress and any tool chatter go to stderr, so
the liveness chatter of a long Douyin run can never land in the middle of what is
being parsed. In-place progress rewriting is suppressed entirely when stderr is
not a terminal: those messages exist to show a human that something is still
happening, and off a terminal there is nobody watching.

`--help`, the usage text and `setup.sh` are the documented exceptions and stay
prose. Nobody parses them; they exist for a person typing the command. A usage
error still prints its prose to *stderr* while the document goes to stdout.

The two refusals in `archive.sh` happen before node runs and so cannot reach the
serialiser — they write their envelope by hand. Both are fixed strings needing no
interpolation. An uncaught exception anywhere else is caught in `dispatch.mjs`
and emitted as `internal-error` with the stack in `details`: a command this skill
invokes must never leave stdout empty, because from the agent's side that is
indistinguishable from a command with nothing to say.

## The descriptor

`account.mjs` is threaded with `{ platform, handleKey }` — the folder a
platform's accounts live under, and what `account.json` calls the readable
handle (`douyin_id`, `handle`, `username`). Explicit rather than closed over,
because a descriptor in an argument list can be followed from the registry to
the call. `session.mjs` is threaded the same way, with `{ platform, label }`:
the state directory it caches into, and what its refusals call the site.

Two things follow from the platform folder being part of the path: a sec_uid, an
X user id and an Instagram user id can never name the same directory, and an
alias chosen on one platform can never collide with one chosen on another.

## Adding to these

Anything here is read by every platform. Before changing a rule, check what the
others do with it: one archives root read with one mental model is what these
modules buy, and a rule that holds for one caller's shape and not the others'
corrupts an archive all of them read.

## The tools every platform runs on

Neither platform runs whatever downloader is on the machine. `env/ensure-env`
builds keyed directories under `${XDG_CACHE_HOME:-~/.cache}/archiver`,
`paths.mjs` resolves a tool to a path inside one, and `env.mjs` is what a
platform calls to have the missing ones built. `../../env/README.md` specifies
the boxes, the keying and the bootstrap; what belongs here is only what the
platforms share about reaching them.

- **Build lazily, immediately before the point of need.** Never at dispatch, and
  never before a URL has been found valid — a refusable URL should be refused on
  any machine, before a byte is downloaded.
- **Name only the boxes you need.** X and Instagram ask for `runtime` and
  `tools`; Douyin adds `browser`, and only when it is past the login. That is the whole of why
  somebody who archives X never downloads Chromium.
- **A build that failed is a refusal, never a fallback.** Quietly running the
  machine's own copy instead would reintroduce the version ambiguity owning the
  environment exists to remove, at the moment things are already going wrong.
  `ARCHIVER_SYSTEM_TOOLS=1` is the one way back to PATH, all-or-nothing and
  documented as unsupported, and `env-build-failed`'s remedy is the only place it
  will be discovered at the moment it is needed.
- **`tool-missing` and `playwright-missing` survive**, reachable only through
  that hatch. The instinct to give an unsupported path worse errors is backwards:
  that machine can never be reproduced from here, so the message is the entire
  diagnostic.
