# x-downloader scripts

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

**`text.txt` never counts toward completeness.** It is ours, not media. A post
whose images failed but whose text was written must still read as incomplete, or
the retry skips it forever.

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
not a reply. This is also why `text.txt` links a reply's parent by URL rather
than naming the account replied to, and why it carries no "quoting" line at all:
the quoted post's id is not exposed in the extractor's metadata.

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

**`--go` has no id at all, so it finds its folder by URL.** It enumerates
nothing by design, so `findAccountFolder` is unavailable to it. `findFolderByUrl`
matches the `url` recorded in `.plan.json` (then `cursor.json`), which is the
URL the plan was written from. The same URL is what `validatePlan` compares —
the numeric-id check in that function can never fire on the `--go` path.

**`text.txt` is written whatever happened to the media.** Returning early on a
failed fetch leaves a post that got three of its four images sitting in a folder
with nothing saying what it was. The text is written first, then the failure is
counted.

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

| File | Role |
| --- | --- |
| `download.sh` | Entry point. Preflights node and gallery-dl, then hands the run to `run.mjs`. Deliberately holds no logic. |
| `run.mjs` | The whole run: flags, target, session, root, folder, plan, go, and which block gets printed. |
| `collect.mjs` | Drives the listing pass, reads rows as they arrive, and decides when enough of the timeline has been seen. |
| `fetch.mjs` | Downloads a list of posts, one gallery-dl invocation each, and writes `text.txt`. |
| `gallerydl.mjs` | Everything said to gallery-dl and read back from it: policy, throttling, the print format, the row parser, failure classification. |
| `plan.mjs` | The diff, the plan's validation rules, and **every** block the skill prints. |
| `archive.mjs` | What is already on disk, read from the post folders. |
| `naming.mjs` | A post's `<date>_<id>` folder name, the id back out of one, and the `text.txt` body. |
| `cursor.mjs` | Resolves an account's folder by numeric identity; writes `cursor.json`. |
| `paths.mjs` | Single source of truth for the state directory and the downloads root. |
| `target.mjs` | Which of the two entry points a URL is, and refusal by name for everything else. |

## Why bash holds no logic

`download.sh` preflights and `exec`s. The sibling skill records what the
alternative costs: a shell function called under `||` runs with errexit switched
off for its whole body, and a refused plan there printed its refusal and then
kept going — through the state write and a summary telling the user to re-run
the `--go` that had just failed.

## Plan, then go

Nothing about an account can be reported before it is enumerated — not the
display name, not the post count, and certainly not how many are new. So the run
is split: `--plan` enumerates, diffs and reports; `--go` downloads what the
report described. In between, the list waits in `<folder>/.plan.json`, which is
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

`douyin-downloader` always scrolls a whole feed and refuses to stop early. That
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
nothing: `text.txt` holds the full untruncated text anyway.

The reverse direction has a matching rule, and `naming.mjs` carries the reason:
`tweetIdFromFolder` anchors to the *whole* folder name, never a suffix.

## Tests

The pure logic has unit tests, and no dependencies beyond Node:

```bash
node --test scripts/*.test.mjs
```

That covers the diff, plan validation and rendering, path normalisation,
argument parsing, cursor identity and merging, URL classification, failure
classification, the archive scan, the `text.txt` builder, and post folder
naming in both directions.

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

## Shared with douyin-downloader, on purpose

`archive.mjs` and `naming.mjs` here, and `archive.mjs` in **douyin-downloader**,
hold the same rules, written twice:

- `posts/<YYYY-MM-DD|undated>_<id>/`, one folder per post
- media numbered by position — `1.jpg`, `2.mp4`
- `text.txt`: permalink, timestamp, blank line, then the untruncated text
- a post counts as downloaded when its folder holds its media
- the account folder is prefixed — `x_<handle>` here, `douyin_<抖音号>` there —
  because both skills default to the same `<git root>/downloads` root, and a
  handle that matches a 抖音号 would otherwise interleave two accounts in one
  folder. `--name` renames the account part and keeps the prefix, so no name
  can be chosen that collides.

They are duplicated rather than shared. A skill is a self-contained folder under
`skills/`, distributed and symlinked on its own, so there is nowhere a shared
module could live that is still a skill. **Change a rule here and change it
there** — the two archives are meant to be readable with one mental model, and
the duplication is only worth its cost while they agree.

The one deliberate difference: gallery-dl tells this skill how many files a post
should hold, so `isPostComplete` can tell a half-fetched post from a complete
one. Douyin's collector yields ids and nothing else, so its check is "at least
one media file" — the fallback branch this one already has.
