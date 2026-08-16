# x-archiver scripts

Read this before changing anything here. The constraints below are why the
design looks the way it does; several of the obvious simplifications do not
work, and two of them were found the hard way.

## Constraints

**X's login cannot be scripted.** gallery-dl's Twitter extractor raises
outright on username/password — "not supported. Use browser cookies instead."
Authentication is the `auth_token` cookie on `.x.com`, plus `ct0` for CSRF.
There is no automated sign-in to write, for any tool, so the session has to come
out of a browser a human already signed in to.

**gallery-dl's `--download-archive` is SQLite, not a text file.** Using it as
the record of what has landed would mean either a SQLite dependency in every
counting path, or a second bookkeeping file maintained beside it. So there is
**no archive file at all**: the post folders *are* the record. A post is on disk
when `posts/<date>_<id>/` exists, and complete when it holds as many media files
as the post has. A record derived from the files cannot drift from the files, which
is the failure a second record invites — a run that dies between two writes
leaves them disagreeing, silently and permanently.

**Completeness is a named list, not a count.** `post.json` says which files the
post carries, and every one of them has to be present. A count would have been
satisfied by the wrong files; the list also makes `1.jpg.part` fail by
construction, since a half-transferred file is not the file. `post.json` itself
is ours rather than media and is never in the list, so a post whose images failed
but whose description was written still reads as incomplete — which it is.

**gallery-dl's skip-and-abort does not run in a listing pass.** `skip:
"abort:N"` lives in `DownloadJob.handle_url`, and `SimulationJob` overrides that
method; `--print` keeps the archive path but only emits rows for files it did
*not* skip. Either way a listing pass driven by gallery-dl's own machinery
cannot report both "how much exists" and "how much you already have" — so the
diff and the stopping rule are ours, in `collect.mjs`, and no archive is passed
to the listing invocation.

**`--print` needs its `prepare:` prefix.** gallery-dl partitions the `--print`
value on its *first* colon to find an event name. A bare format string
containing `{date:%Y-%m-%d}` is therefore read as an event called `{date`, and
the run fails. The prefix is load-bearing, not decoration.

**Only unconditional extractor fields may appear in the print format.**
`_transform_tweet` sets `reply_to` and `pinned` only on the posts that have them,
and naming a missing key is a formatting error on every other post. Replies are
identified by `reply_id`, which is always present and is `0` when the post is
not a reply. This is also why `post.json` links a reply's parent by URL rather
than naming the account replied to, and why it carries nothing about a quoted
post: the quoted post's id is not exposed in the extractor's metadata.

The optional fields added for `post.json` — `filename`, `type`, `url` and the
two profile-image URLs — carry an explicit `|''` fallback for the same reason
turned inside out. gallery-dl's formatter does not raise on a key it cannot
find; it renders the literal string `None`, which would be indistinguishable
from a value and would land in `post.json` as a media URL.

**Free text must be `!j`-encoded.** A post body containing a newline or a tab
would otherwise be indistinguishable from several rows of a tab-separated
listing. `{content!j}` and `{user[nick]!j}` come back as JSON strings and are
decoded in `parseRow`.

**An 'exit' listener attached after the read loop is attached too late.**
gallery-dl can finish before its stdout has been drained — a short timeline, a
cached response — and the event then fires before anything is listening, so the
run hangs forever on a promise nothing can settle. It was intermittent: it
passed the unit tests and failed roughly one invocation in three by hand. The
listener is created immediately after `spawn`, and awaited later.

It is `exit` rather than `close` for a second reason: `close` additionally waits
for every stdio pipe to be closed, and a killed process's children can inherit
stdout and hold it open after the process itself is gone.

**A failed spawn leaves a stream that never ends.** `spawn` of a missing binary
emits `error`, but its stdout emits neither data nor `end`, so a read loop over
it waits forever — a missing gallery-dl would hang rather than say so. The
`spawn`/`error` race is settled *before* any reading starts.

**The folder cannot be known before the first row is read.** X handles are
mutable and the numeric id is not, so a renamed account is already archived
under its old handle — and the id is not in the URL, unlike Douyin's `sec_uid`.
Resolving the folder from the URL's handle looks in the wrong place: it finds an
empty directory, reports `on disk 0`, silently downgrades the incremental sweep
to a full one because there is nothing to recognise, and writes the plan
somewhere `--go` then cannot find. So `collect` takes an `onAccount` callback,
fired on the first row that names the account, and the folder, the archive and
the stopping rule are all settled inside it.

**`--go` has no id at all, so it finds its folder by scanning.** It enumerates
nothing by design, so it cannot go straight to `x/<id>/` the way a plan can.
`findAccountDir` makes one pass over the account folders and matches, in order
of how much each proves: the `url` recorded in `account.json` (the very URL the
archive was made from), the user's own `--name`, then the handle. The URL is
also what `validatePlan` compares — the numeric-id check in that function can
never fire on the `--go` path.

**`account.json` is authoritative for identity, and never for progress.** It
says nothing about what has been downloaded: that is answered by the post
folders alone, and a count or a newest-post id kept here would be a second
record free to disagree with them. It is written the moment the folder is
resolved — before the download, not after — so a folder that exists always says
whose it is, and the parked plan is never asked who an account is. The plan
carries identity only as a guard, for `validatePlan` to refuse a plan made for
someone else. What the last run *did* is run history and lives in `sync.json`.

**Deleting `sync.json` loses no archive content.** That sentence is the whole
specification of the file, and every field in it has to keep the sentence true.
It holds the plan awaiting approval and a record of the last run, and nothing
that a run consults to decide what to fetch. A resumption cursor was considered
and rejected: it would make a run *shorter in result*, not just cheaper, and the
sibling skill deleted exactly that mechanism for missing posts a reordered feed
had pushed below it.

**`post.json` is written before the media, not after.** It is the post's
description, not a receipt. A marker written last would be a second record, free
to go on claiming a post had landed after its media was deleted by hand — the
failure that got `--download-archive` removed from the sibling skill. Writing it
first also means a post that got three of its four images sits in a folder that
still says what it was, and its media list is what makes the fourth read as
missing. A folder whose `post.json` could not be written counts the post as
failed rather than downloading into a folder that can never satisfy the
completeness check.

**The archives root carries a schema version.** `archiver.json` holds
`{"schema": 2}` and is checked before the session, before the first API call and
before anything is written. Absent is an ordinary answer and reads as the
current schema, so a subtree copied to another disk still works; a version this
build does not know stops the run. It is not a guard against the old flat
`x_<handle>` layout — that layout had no root file either, so it is invisible to
this build by construction, and moving an old archive across is a one-off the
user does by hand.

**The pauses are what let a long run finish.** X rate-limits the timeline
endpoints hard, and the failure is not a slow run but a stopped one — and, with
the user's own session doing the asking, a stopped one that can escalate to a
challenged account. `--retries` is deliberately low for the same reason: a 429
should surface as a clean stop a later `--go` resumes, not as a client hammering
its way into a longer lockout. The numbers in `THROTTLE` are a conservative
starting point and want measuring against a real account.

**`--config-ignore` on every invocation.** A user's own
`~/.config/gallery-dl/config.json` is loaded first otherwise, and it can quietly
change what this skill archives — retweets on, replies off, a different
filename format.

## Files

**This skill archives; gallery-dl downloads.** `archive.sh` and `run.mjs` own
the account — folder, plan, what is already on disk — and `gallerydl.mjs` owns
the fetch. `download` surviving in the lower layer is deliberate: it names what
the tool actually does, and it is the only marker of which layer you are in.

| File | Role |
| --- | --- |
| `archive.sh` | Entry point. Preflights node and gallery-dl, then hands the run to `run.mjs`. Deliberately holds no logic. |
| `run.mjs` | The whole run: flags, target, session, root, folder, plan, go, and which block gets printed. |
| `collect.mjs` | Drives the listing pass, reads rows as they arrive, and decides when enough of the timeline has been seen. |
| `fetch.mjs` | Downloads a list of posts, one gallery-dl invocation each, writing each post's `post.json` before its media. |
| `gallerydl.mjs` | Everything said to gallery-dl and read back from it: policy, throttling, the print format, the row parser, failure classification. |
| `plan.mjs` | The diff, the plan's validation rules, and **every** block the skill prints. |
| `landed.mjs` | What is already on disk, read from the post folders. |
| `naming.mjs` | A post's `<date>_<id>` folder name, the id back out of one, and a post's permalink. |
| `post.mjs` | The shape of `post.json`, and whether a post holds every file it lists. |
| `account.mjs` | Where an account's folder is (`x/<id>`), and the identity written in `account.json`. |
| `sync.mjs` | `sync.json`: the parked plan and the last run's history. Deletable without loss. |
| `archiver.mjs` | The archives root's schema version, and the refusal when it is one this build cannot read. |
| `assets.mjs` | The account's current avatar and banner, fetched from the URLs the listing pass already carried. |
| `paths.mjs` | Single source of truth for the state directory and the archives root. |
| `target.mjs` | Which of the two entry points a URL is, and refusal by name for everything else. |

## Why bash holds no logic

`archive.sh` preflights and `exec`s. The sibling skill records what the
alternative costs: a shell function called under `||` runs with errexit switched
off for its whole body, and a refused plan there printed its refusal and then
kept going — through the state write and a summary telling the user to re-run
the `--go` that had just failed.

## Plan, then go

Nothing about an account can be reported before it is enumerated — not the
display name, not the post count, and certainly not how many are new. So the run
is split: `--plan` enumerates, diffs and reports; `--go` downloads what the
report described. In between, the list waits in `<folder>/sync.json`, which is
why confirming costs no second enumeration and why what is fetched is exactly
what was shown.

`--go` runs no enumeration pass. It fetches each approved post by permalink,
which is the second reason for one invocation per post: re-walking the timeline
would also pull in anything published since the plan, which nobody approved.
That costs an API call per post where pagination costs one per page. It is the
price of the guarantee, and the media downloads dominate the wall clock anyway.

A plan is refused rather than repaired when it is missing, older than 24h, or
written for another account, root or folder. The alternative to refusing is
downloading a list the user never approved. It is deleted once every post in it
has landed, and kept when a run stops partway, so a retry re-fetches only what
is missing.

`--yes` does both halves in one process, for using the scripts by hand. The
skill never reaches for it — an agent asks — but it outranks a `--plan` or
`--go` that comes after it on the command line, so a user who typed it keeps
their pre-authorisation when the skill appends its own mode flag.

## The sweep stops early, unlike the sibling's

`douyin-archiver` always scrolls a whole feed and refuses to stop early. That
rule is evidence, not principle: a 284-video account measures ~34 seconds. The
evidence does not transfer. An X timeline is paginated API calls against a rate
limiter and a decade-old account is tens of thousands of posts, so re-enumerating
all of it every time somebody checks their status would make the confirm step
cost more than the download.

So a re-run stops after **100 consecutive** already-complete posts. Generous on
purpose: X pins a post to the top of a timeline regardless of age, and a
stop-at-the-first-thing-you-recognise rule would halt immediately and forever.
A first run has nothing to recognise and sweeps the lot; `--full` forces a
complete pass; and the block always names which mode ran, so `to fetch 0` can
never be confused with "gave up before reaching anything new".

## Zero posts is never "up to date"

An account that is protected, or a session that has quietly expired, produces
exactly the same silence as an account that has posted no media. Reporting that
silence as "you already have everything" would be a lie the user acts on, so it
is its own outcome with its own message, and `classifyFailure` exists to keep
protected, suspended, missing, rate-limited and unauthorized apart from each
other and from success.

## No post text reaches a path

A post folder is `<date>_<id>`: a date gallery-dl formatted and a numeric id,
with none of the post's body in it. That is deliberate. Putting arbitrary user
text into a *directory* name is a sharper edge than a filename — a stray
separator does not produce a badly named file, it produces a tree in the wrong
place — and it previously needed a sanitiser stripping path separators, control
characters, bidi overrides and Windows-hostile trailing dots, truncating by
grapheme so a name never ended mid-surrogate. Keeping the body out of the path
retires that whole class of bug instead of defending against it, and costs
nothing: `post.json` holds the full untruncated text anyway.

The reverse direction has a matching rule, and `naming.mjs` carries the reason:
`tweetIdFromFolder` anchors to the *whole* folder name, never a suffix.

## Tests

The pure logic has unit tests, and no dependencies beyond Node:

```bash
node --test scripts/*.test.mjs
```

That covers the diff, plan validation and rendering, path normalisation,
argument parsing, account identity and merging, URL classification, failure
classification, the archive scan, the `post.json` shape and its completeness
rule, `sync.json`'s merge and lifetimes, the schema check, avatar sniffing, and
post folder naming in both directions.

`collect.mjs` is tested against a fake `gallery-dl` shell script, which is what
covers the streaming, the early-stop kill and the two process-lifecycle races
above.

One fixture detail worth keeping: the blocking fake uses `exec sleep`, not
`sleep`. Without `exec`, the shell forks sleep as a child, killing the shell
leaves that child holding the inherited stdout pipe, and the suite sits for the
full sleep after every assertion has already passed.

**Everything touching real gallery-dl and real X is unverified by these tests.**
It wants a run against a live account: the print format's field names, the
policy keys, the throttling numbers, and every string `classifyFailure` matches
on.

## Shared with douyin-archiver, on purpose

`landed.mjs`, `post.mjs`, `account.mjs`, `sync.mjs` and `archiver.mjs` here have
counterparts of the same name in **douyin-archiver**, holding the same rules
written twice. The layout both produce:

```
<archives root>/
  archiver.json                 {"schema": 2}
  x/<numeric user id>/          douyin/<sec_uid>/
    account.json
    sync.json
    assets/                     (x only — see below)
    posts/<YYYY-MM-DD|undated>_<id>/
      post.json
      1.jpg, 2.mp4, …
```

- `posts/<YYYY-MM-DD|undated>_<id>/`, one folder per post, `undated` a literal
- media numbered by position — `1.jpg`, `2.mp4`
- `post.json`: `version`, `id`, `permalink`, `timestamp`, `text`, `reply_to`,
  `media`, in that order and holding nothing else. Written **before** the media.
  `media[].url` and `media[].id` are optional and often absent.
- a post counts as downloaded when every file its `post.json` lists is present
- the account folder is the account's immutable id, under a platform folder —
  `x/<numeric user id>` here, `douyin/<sec_uid>` there — because both skills
  default to the same `<git root>/archives` root. `--name` is a label recorded
  inside `account.json`, never a folder name, so no name can collide.
- `account.json` beside `posts/`, holding `version`, `platform`, `account` and
  `url` and nothing else — authoritative for identity, never for progress. Both
  write it when the folder is resolved, both merge into what is already there,
  and both treat a blank as silence rather than an erasure.
- `sync.json` beside it, holding `version`, `plan` and `last_run`. Deleting it
  loses no archive content.
- `archiver.json` at the root, holding the schema version. Absent reads as
  current; unknown stops the run.

They are duplicated rather than shared. A skill is a self-contained folder under
`skills/`, distributed and symlinked on its own, so there is nowhere a shared
module could live that is still a skill. **Change a rule here and change it
there** — the two archives are meant to be readable with one mental model, and
the duplication is only worth its cost while they agree. The specification lives
in the issue tracker; these two blocks are what ships.

Three deliberate differences:

- **`assets/` is x-only.** gallery-dl puts the avatar and banner URLs on every
  row the listing pass already reads, so they cost nothing here. Nothing reads
  Douyin's out of the profile page yet, so the directory is simply absent there
  — the layout allows it to be.
- **This skill builds `post.json` in JS; Douyin's is written by yt-dlp.** There
  the JSON is assembled by an output template in `download-douyin.sh`, because
  `--print-to-file` fires after extraction and before the download, which is
  exactly when the file has to appear — and doing it any other way would cost a
  second metadata request per post against a hard rate limiter. So the two
  `post.mjs` modules agree on the *file* and differ in their API: this one owns
  `toTimestamp` and `mediaEntry` and takes media as `{num, ext, …}`, because it
  is the thing turning gallery-dl's rows into filenames; Douyin's has neither and
  takes `{file, …}`, because by the time anything in Node sees a media entry the
  name has already been decided by the template.
- **`media[].id` exists here and never there.** For an image it is the
  pbs.twimg.com media token; yt-dlp exposes no per-item identifier for Douyin at
  all. It is also absent for X videos, whose only candidate is a variant name a
  re-encode can change.
