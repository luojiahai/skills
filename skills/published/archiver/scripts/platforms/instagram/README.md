# Instagram platform scripts

Read this before changing anything here. The constraints below are why the
design looks the way it does, and each says whether it is verified.

**What is verified, and what is not.** Everything about *gallery-dl* below was
checked against the version `env/pyproject.toml` pins, by reading the installed
extractor: the option names, the keyword names, the URL patterns each extractor
answers for, and every string `classifyFailure` matches on. What is **not**
verified is any of it against a live Instagram account — the throttling numbers
above all, and whether the two feeds overlap as much as expected. That takes a
run against a real profile with a real session, and nothing here has had one.

## Constraints

**Instagram's login cannot be scripted into anything but a checkpoint.**
gallery-dl's own answer to a username and password is `Login with username &
password is no longer supported. Use browser cookies instead.` Authentication is
the `sessionid` cookie, and it has to come out of a browser a human already
signed in to. That makes this platform X's shape rather than Douyin's, and the
cookie machinery is [`../../shared/session.mjs`](../../shared/session.mjs),
threaded with this platform's name and label.

**Posts and reels are two passes, not one.** gallery-dl's Instagram user
extractor is a dispatcher: the bare profile URL fans out to whichever
sub-extractors its `include` option names, defaulting to posts alone. Asking it
for `["posts", "reels"]` would put both feeds down one stream — and the early
stop would land in the posts half, so **every reel would go uncollected on every
re-run**. So each pass names its feed's extractor outright,
`/<handle>/posts` and `/<handle>/reels`, and each gets a stopper of its own.
`include` is never passed: a URL that says which feed it means cannot disagree
with a config key that says the same thing.

The cost is that the feeds overlap — a reel appears in the profile grid too — so
a post arrives twice. That collapses in the fold: the shortcode already keys it,
the same way a carousel's rows collapse into one post.

**Each pass reports its own sweep.** The two stop independently, so one
`stopped_early` covering both could say the listing may be short without saying
short of *what*. Two notes cost a line and let the run say "everything up to the
end of your posts, but stopped partway through your reels".

**A pass that failed ends the collection.** A plan built from one feed and half
of another compares the archive against half an account and reports the rest as
up to date.

**The shortcode is the post's identity, not the numeric media id.** `--go`
fetches each approved post by permalink and the permalink is built from the
shortcode. A post id here is therefore base64ish rather than numeric, which is
the charset [`../../shared/naming.mjs`](../../shared/naming.mjs) has to write
*and* read: a folder name this archive writes and cannot read back is a post
counted as missing forever and re-downloaded on every run.

**The permalink carries no handle.** `/p/<shortcode>` resolves whoever owns the
post. Putting the handle in it would break the whole approved list the day an
account is renamed — between a plan and the `--go` that acts on it.

**The account folder is the numeric id.** Instagram handles are mutable and can
be taken by somebody else, and the id is not in the URL. So the folder is
settled from the first row of whichever pass names the account first — which is
not always the posts pass, because an account can have reels and no feed posts.

**Only the keys the extractor actually sets may appear in the print format.**
`post_shortcode`, `post_id`, `num`, `count`, `date`, `owner_id`, `username`,
`fullname` and `description` are set on every row. `media_id` and `typename`
are not always, so they carry `|''` — gallery-dl does not raise on a key it
cannot find, it renders the literal string `None`, which would be
indistinguishable from a value and would land in `post.json` as a media URL.

There is **no bare `url` key**. The URL gallery-dl downloads from is passed
beside the metadata rather than inside it, so the media URL is asked for as
`{video_url|display_url|''}` — the two keys the extractor does set, a video
carrying both and an image only the second.

**`count` is not asked for, and must not be added.** It looks like the field that
would make a truncated listing detectable, and it is not: the extractor sets it to
every file it *found* for the post, a reel's soundtrack included, while
`extractor.instagram.audio` being false means it prints no row for that soundtrack
and writes no file for it. So `count` exceeds the rows for every reel with music,
and a diff comparing the two marks a complete post as missing — then hands `--go` a
list whose every entry is already on disk, so the block promises a hundred posts and
the run downloads none. The rows are the record. They come from the same policy the
fetch runs under, so they are exactly the files a `--go` will write.

**Free text must be `!j`-encoded.** A caption containing a newline or a tab
would otherwise be indistinguishable from several rows of a tab-separated
listing. A key the extractor never set renders through `!j` as the JSON literal
`null`, so `parseRow` maps that to the empty string — a post whose caption is
the four letters "null" is worse than one with none.

**The pauses are slower than X's, and the reason is the failure mode.** X
answers a client going too fast with a 429 that a later `--go` resumes from.
Instagram answers by challenging the *user's own account*, which no amount of
waiting here clears and which the user has to go and clear in the app.
`--retries` is low for the same reason: hammering through a rate limit is what
escalates one into a checkpoint. The numbers are unverified against a live
account.

**A Cloudflare challenge is not an account checkpoint.** gallery-dl's shared
request path says `Cloudflare challenge` for bot protection, which says nothing
about this account. `classifyFailure` therefore anchors on the redirect
Instagram's own extractor writes — `HTTP redirect to challenge page` and the
`/challenge/` path — rather than on the word. Reading the wrong one as a
checkpoint would send the user into the app looking for a prompt that is not
there.

**A checkpoint keeps the cached session.** The cookies are fine; the account is
held. `session-rejected` discards them because they are genuinely dead, and
doing the same here would charge the user a Keychain-prompting browser read to
replace a login that works.

**`--config-ignore` on every invocation.** A user's own
`~/.config/gallery-dl/config.json` is loaded first otherwise, and it can quietly
change what this skill archives.

## What is out of scope, and why

Stories, highlights and tagged posts are not archived, and the URLs naming them
are refused rather than attempted.

**Stories** are the one worth arguing about, because they vanish in 24 hours and
that is exactly where an archive has value. They are excluded because they make
this skill's central promise false: "a re-run fetches only what is new" cannot
hold for content that disappears whether or not you ran yesterday, and an
archive silently missing everything from the days nobody ran is worse than one
that never claimed to have it.

**Tagged** posts are other people's uploads. **Highlights** are the account's
own permanent media and are the candidate for a later flag — not silence, but
not this change.

None of these is *counted* the way Douyin counts its unfetchable image posts.
That note exists because those are ordinary posts of the account which the skill
fails to fetch, so the archive is short of what it promised. A story is a
different product surface, and a per-run note counting them would read as an
error rather than as a boundary.

## No assets directory

X gets `assets/avatar.<ext>` free, because gallery-dl puts the profile-image URL
on every X row. Instagram's rows carry none — the avatar is its own extractor —
so having one would cost an extra request per run against the limiter that
challenges accounts. The shared layout allows a platform to have no `assets/`,
and this one has none.

## Files

**This skill archives; gallery-dl downloads.** `archive.sh` and `run.mjs` own the
account — folder, plan, what is already on disk — and `gallerydl.mjs` owns what
is said to the tool and how its output is read back.

| File | Role |
| --- | --- |
| `run.mjs` | The whole run: flags, target, session, root, folder, plan, go, and the one document it answers with. |
| `target.mjs` | The account a URL names, a post's permalink, and each feed's URL. Everything else on instagram.com — a single post, a story, the tagged tab — is refused rather than read as an account. |
| `collect.mjs` | The two listing passes: drives gallery-dl, reads rows as they arrive, decides when enough of each feed has been seen, and folds per-file rows into posts. |
| `fetch.mjs` | Downloads a list of posts, one gallery-dl invocation each, writing each post's `post.json` before its media. |
| `gallerydl.mjs` | What is particular to this extractor: its policy, its throttling, the row format it is asked for, the row parser and the failure classification. The two invocations those feed are [`../../shared/gallerydl.mjs`](../../shared/gallerydl.mjs), which every gallery-dl platform builds the same way. |

The archive itself — `account.json`, `post.json`, `sync.json`, `archiver.json`,
the post folders and the envelope every command answers in — is
[`../../shared/`](../../shared/README.md), and the session is
[`../../shared/session.mjs`](../../shared/session.mjs).

## Plan, then go

The split run, what `sync.json` parks between the halves, when a plan is refused
and why `--yes` outranks a later mode flag are the same on every platform, and
are specified in [`../../shared/README.md`](../../shared/README.md).

What is particular here: `--go` runs no collection pass. It fetches each
approved post by permalink, which is the second reason for one invocation per
post — re-walking the profile would also pull in anything published since the
plan, which nobody approved.

## The sweep stops early, like X's

A re-run stops after **100 consecutive** already-complete posts *per feed*.
Generous on purpose: Instagram pins up to three posts to the top of a profile
regardless of age, so a stop-at-the-first-thing-you-recognise rule would halt
immediately and forever. A first run has nothing to recognise and sweeps the
lot; `--full` forces a complete pass.

So does a re-run that finds a plan still parked with un-landed posts in it. That
is a download that never finished, which means the archive may have holes below
the posts at the top of it and the streak the stopper counts proves nothing about
what is under them. Both feeds ask the one shared rule, `sweepIsIncremental` in
`shared/run.mjs`, which is also X's.

## Zero posts is never "up to date"

A private account, and a session that has quietly expired, produce exactly the
same silence as an account that has posted nothing. Reporting that silence as
"you already have everything" would be a lie the user acts on, so it is its own
refusal under its own code. There is deliberately no `suspended`: Instagram does
not distinguish a suspended account from one that never existed, and emitting a
code for a state that cannot be told apart would be inventing a distinction.

## Tests

The pure logic has unit tests, and no dependencies beyond Node. From the repo
root, which runs every platform's suite as well as the shared one:

```bash
npm test
```

`collect.mjs` and `fetch.mjs` both take a `spawnImpl`, the same seam the other
platforms have, so what gets spawned can be asserted without anything being
installed. `collect.mjs` is additionally tested against a fake `gallery-dl`
shell script, which is what covers the streaming, the early-stop kill and the
two process-lifecycle races the X platform's README describes — those are real
process behaviour, and a fake emitter cannot reproduce them.

One fixture detail worth keeping: the blocking fake uses `exec sleep`, not
`sleep`. Without `exec`, the shell forks sleep as a child, killing the shell
leaves that child holding the inherited stdout pipe, and the suite sits for the
full sleep after every assertion has already passed.
