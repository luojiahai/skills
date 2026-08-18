# X platform scripts

Read this before changing anything here. The constraints below are why the
design looks the way it does; each is verified against the live site, and the
simplifications they rule out are named as they come up.

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
when `posts/<date>_<id>/` exists, and complete when it holds every file its
`post.json` names. A record derived from the files cannot drift from the files, which
is the failure a second record invites — a run that dies between two writes
leaves them disagreeing, silently and permanently.

**Completeness is a named list, not a count.** `post.json` says which files the
post carries, and every one of them has to be present — and it has to have been
written by a build that spells `post.json` the way this one does, which is what
`post.version` is checked for. A count would have been satisfied by the wrong
files; the list also makes `1.jpg.part` fail by construction, since a
half-transferred file is not the file. `post.json` itself is ours rather than
media and is never in the list, so a post whose images failed but whose
description was written still reads as incomplete — which it is.

A post listing *no* files is complete, because there is nothing to wait for. That
cannot arise from a collection pass, which only ever yields posts carrying files,
and treating it as incomplete would put such a post into an unending retry loop.
What it does mean is that a listing cut off mid-post — a rate limit landing
between two of one post's rows — would write a short list and then be satisfied
by it forever. That is why `diff` treats a post whose extractor count exceeds the
rows it saw as missing, and reports the count as an `under-described-posts`
note.

**gallery-dl's skip-and-abort does not run in a collection pass.** `skip:
"abort:N"` lives in `DownloadJob.handle_url`, and `SimulationJob` overrides that
method; `--print` keeps the archive path but only emits rows for files it did
*not* skip. Either way a collection pass driven by gallery-dl's own machinery
cannot report both "how much exists" and "how much you already have" — so the
diff and the stopping rule are ours, in `collect.mjs`, and no archive is passed
to the collection invocation.

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
run hangs forever on a promise nothing can settle. It is intermittent — the
unit tests pass and roughly one invocation in three fails by hand — so the
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

**`--go` has no id at all, so it finds its folder by scanning.** It collects
nothing by design, so it cannot go straight to `x/<id>/` the way a plan can. An
`--alias` is tried directly, as a path and then through the mapping; everything
else is settled in one pass over the account folders, matching in order of how
much each proves: the `url` recorded in `account.json` (the very URL the archive
was made from), the alias recorded there, then the handle. Once the folder is
open, its `account.json` yields the numeric id — and that id, not the URL, is
what `validatePlan` checks the plan against.

**`account.json` is authoritative for identity, and never for progress.** It
says nothing about what has been downloaded: that is answered by the post
folders alone, and a count or a newest-post id kept here would be a second
record free to disagree with them. A `--plan` writes it the moment the folder is
resolved, before anything is downloaded, so a folder that exists always says
whose it is.

A `--go` is the other way round: it collects nothing, so the parked plan is the
only thing that knows the account, and `account.json` is what `findAccountDir`
and `validatePlan` read to find the folder and refuse a plan made for somebody
else. It records identity again after the fetch, with the alias the run finished
under. What the last run *did* is run history and lives in `sync.json`.

**`sync.json`, `post.json`'s write order and the root's schema version are the
shared archive's rules,** specified in
[`../../shared/README.md`](../../shared/README.md). Two of them bite hardest
here. Deleting `sync.json` loses no archive content, so
no resumption cursor may go in it: that would make a run shorter in *result*
rather than merely cheaper, missing posts a reordered feed has pushed below the
mark. And a folder whose `post.json` could not be written counts the post as
failed, rather than downloading into a folder that can never satisfy the
completeness check.

**The pauses are what let a long run finish.** X rate-limits the timeline
endpoints hard, and the failure is not a slow run but a stopped one — and, with
the user's own session doing the asking, a stopped one that can escalate to a
challenged account. `--retries` is deliberately low for the same reason: a 429
should surface as a clean stop a later `--go` resumes, not as a client hammering
its way into a longer lockout. The numbers in `THROTTLE` are a conservative
starting point, unverified against a live account.

`THROTTLE` alone does not pace a download. `--sleep-request` and `--sleep` are
per-process state and the download loop spawns one gallery-dl per post, so every
post starts with its budget reset. `fetch.mjs`'s own `POST_INTERVAL_MS` is what
paces the loop; without it the effective interval between posts is however long
a process happened to take.

**`--config-ignore` on every invocation.** A user's own
`~/.config/gallery-dl/config.json` is loaded first otherwise, and it can quietly
change what this skill archives — retweets on, replies off, a different
filename format.

## Files

**This skill archives; gallery-dl downloads.** `archive.sh` and `run.mjs` own the
account — folder, plan, what is already on disk — and `gallerydl.mjs` owns what
is said to the tool and how its output is read back.

| File | Role |
| --- | --- |
| `run.mjs` | The whole run: flags, target, session, root, folder, plan, go, and the one document it answers with. |
| `target.mjs` | The account a URL names, and a post's permalink. Everything else on x.com — a single post included — is refused rather than read as an account. |
| `collect.mjs` | The collection pass: drives gallery-dl, reads rows as they arrive, decides when enough of the timeline has been seen, and folds per-file rows into posts. |
| `fetch.mjs` | Downloads a list of posts, one gallery-dl invocation each, writing each post's `post.json` before its media. |
| `gallerydl.mjs` | Everything said to gallery-dl and read back from it: policy, throttling, the print format, the row parser, failure classification. |
| `assets.mjs` | The account's current avatar and banner, fetched from the URLs the collection pass already carried. |

The archive itself — `account.json`, `post.json`, `sync.json`, `archiver.json`,
the post folders and the envelope every command answers in — is
[`../../shared/`](../../shared/README.md).

## Why bash holds no logic

`archive.sh` preflights and `exec`s. The Douyin platform records what the
alternative costs: a shell function called under `||` runs with errexit switched
off for its whole body, so a refused plan prints its refusal and then keeps
going — through the state write and a summary telling the user to re-run the
`--go` that just failed.

## Plan, then go

The split run, what `sync.json` parks between the halves, when a plan is refused
and why `--yes` outranks a later mode flag are the same on every platform, and
are specified in [`../../shared/README.md`](../../shared/README.md).

What is particular here: `--go` runs no collection pass. It fetches each approved
post by permalink, which is the second reason for one invocation per post —
re-walking the timeline would also pull in anything published since the plan,
which nobody approved. That costs an API call per post where pagination costs one
per page. It is the price of the guarantee, and the media downloads dominate the
wall clock anyway.

## The sweep stops early, unlike Douyin's

Douyin always scrolls a whole feed and refuses to stop early. That rule rests on
evidence, not principle: a full scroll of a few hundred posts measures ~34
seconds. The evidence does not transfer. An X timeline is paginated API calls
against a rate limiter and a decade-old account is thousands of posts, so
re-collecting all of it every time somebody checks their status would make the
confirm step cost more than the download.

So a re-run stops after **100 consecutive** already-complete posts. Generous on
purpose: X pins a post to the top of a timeline regardless of age, and a
stop-at-the-first-thing-you-recognise rule would halt immediately and forever.
A first run has nothing to recognise and sweeps the lot; `--full` forces a
complete pass; and every run that *collects* carries a `sweep` note naming which
mode ran and whether it stopped early, so `to_fetch: 0` can never be confused
with "gave up before reaching anything new". A bare `--go` collects nothing and
repeats the note its plan recorded, which is up to a day old; a refusal carries
none.

## Zero posts is never "up to date"

An account that is protected, or a session that has quietly expired, produces
exactly the same silence as an account that has posted no media. Reporting that
silence as "you already have everything" would be a lie the user acts on, so it
is its own refusal under its own code, and `classifyFailure` exists to keep
`protected`, `suspended`, `no-such-account`, `rate-limited`, `session-rejected`
and `post-gone` apart from each other and from success. It returns those codes
directly: a name that meant one thing here and another in the envelope would be a
translation step, and a translation step is somewhere the distinction can be lost.

An HTTP status only counts where the line is about a response. gallery-dl writes
downloaded paths, media URLs and byte counts to the same streams an error goes
to, so `Gx401abc.jpg` and `1401 bytes` must not read as a rejected session — that
would stop the run *and* throw away a working login. `post-gone` is the one code
here that is about a post rather than an account, and a 404 during an account
listing is not one: it reaches the run as `collect-failed` rather than as an
answer about a post nobody asked about.

## No post text reaches a path

A post folder is `<date>_<id>`: a date gallery-dl formatted and a numeric id,
with none of the post's body in it. That is deliberate. Putting arbitrary user
text into a *directory* name is a sharper edge than a filename — a stray
separator does not produce a badly named file, it produces a tree in the wrong
place. Defending against it means a sanitiser stripping path separators,
control characters, bidi overrides and Windows-hostile trailing dots, truncating
by grapheme so a name never ends mid-surrogate. Keeping the body out of the path
retires the whole class instead, and costs nothing: `post.json` holds the full
untruncated text anyway.

The reverse direction has a matching rule, and `naming.mjs` carries the reason:
`postIdFromFolder` anchors to the *whole* folder name, never a suffix.

## Tests

The pure logic has unit tests, and no dependencies beyond Node. From the repo
root, which runs every platform's suite as well as the shared one:

```bash
npm test
```

That covers the diff, plan validation and rendering, path normalisation,
argument parsing, account identity and merging, which URLs name an account and
which are refused, failure classification, the archive scan, the `post.json`
shape and its completeness rule, `sync.json`'s merge and lifetimes, the schema
check, avatar sniffing, and post folder naming in both directions.

`collect.mjs` and `fetch.mjs` both take a `spawnImpl`, the same seam Douyin's
downloader has, so what gets spawned can be asserted without anything being
installed on the machine running the tests.

`collect.mjs` is additionally tested against a fake `gallery-dl` shell script,
which is what covers the streaming, the early-stop kill and the two
process-lifecycle races above — those are real process behaviour, and a fake
emitter cannot reproduce them.

One fixture detail worth keeping: the blocking fake uses `exec sleep`, not
`sleep`. Without `exec`, the shell forks sleep as a child, killing the shell
leaves that child holding the inherited stdout pipe, and the suite sits for the
full sleep after every assertion has already passed.

**Everything touching real gallery-dl and real X is unverified by these tests.**
Verifying it takes a run against a live account: the print format's field names,
the policy keys, the throttling numbers, and every string `classifyFailure`
matches on.

## The archive this shares with the other platform

`account.json`, `post.json`, `sync.json`, `archiver.json` and the
`posts/<date>_<id>/` layout are written by `../../shared/`, and specified in
[`../../shared/README.md`](../../shared/README.md). Both platforms write into
one archives root, so those rules are not this platform's to change alone.

What is particular to this one:

- **`assets/` is X-only.** gallery-dl puts the avatar and banner URLs on every
  row the collection pass already reads, so they cost nothing here. Nothing reads
  Douyin's out of the profile page yet, so the directory is simply absent there
  — the layout allows it to be.
- **Where a media entry's name comes from.** Both platforms build `post.json`
  with `../../shared/post.mjs`, so the *file* is one shape. What differs is what
  each hands `mediaEntry`: this platform passes `{num, ext, …}`, because it is
  turning gallery-dl's rows into filenames itself, while Douyin passes `{file}`,
  yt-dlp having already printed the name it is about to write. Reading the name
  back out of yt-dlp is what makes the extension knowable — it is the thing that
  picks the container — without a second metadata request per post.
- **`media[].id` exists here and never there.** For an image it is the
  pbs.twimg.com media token; yt-dlp exposes no per-item identifier for Douyin at
  all. It is also absent for X videos, whose only candidate is a variant name a
  re-encode can change.
