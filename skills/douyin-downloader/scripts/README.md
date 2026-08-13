# douyin-downloader scripts

Read this before changing anything here. The constraints below are why the
design looks the way it does; each was verified against the live site, and
several of the obvious simplifications do not work.

## Constraints

**yt-dlp cannot enumerate an account.** It ships exactly one Douyin extractor,
matching only `https://www.douyin.com/video/<id>`. There is no `douyin:user`
(unlike TikTok, which has `tiktok:user`), so a `/user/...` URL yields nothing —
IDs have to be collected separately.

**The feed API cannot be called directly.** `/aweme/v1/web/aweme/post/` requires
an `a_bogus` signature computed by obfuscated page JS. Without it the endpoint
returns **HTTP 200 with a zero-byte body** — a silent block, not an error. That
is why collection drives a real browser: the page signs its own requests.

**Your everyday Chrome cannot be automated.** Since Chrome 136,
`--remote-debugging-port` is refused on the default profile. Hence a dedicated
Playwright Chromium against its own profile directory (see *Where things live*).

**The profile grid requires a login.** Anonymously, the header still reports the
video count while the grid renders zero cards. `--login` establishes the session
once; it persists, and later runs work headless.

**Footer links are other people's videos.** The page footer carries SEO
recommendations tagged `?source=Baiduspider`. Harvesting all `/video/` links
without filtering collects strangers' uploads — an early version did exactly
that, returning 7 videos, none of them the account's.

**Grid class names are obfuscated and rotate** (`a.RZuwF26I`, `div.gsF4XxDR`).
Filter structurally — exclude `footer`, exclude the SEO marker — never by class.

**The pauses are what let a long run finish.** `download-douyin.sh` runs yt-dlp
with `--sleep-requests 2 --sleep-interval 3 --max-sleep-interval 8`. Douyin
rate-limits hard: an unthrottled batch starts failing partway through and can
get the session challenged. Tuning these down to make a run finish faster is
what stops it finishing.

## Files

| File | Role |
| --- | --- |
| `download.sh` | Entry point. Owns folder, plan and cursor policy. Everything else is called by it. |
| `download-douyin.sh` | General-purpose layer: a list of URLs/IDs in, files out, with throttling and a resumable archive. Knows nothing about accounts. |
| `collect-douyin-ids.mjs` | Drives Playwright, scrolls the profile, emits video URLs and profile metadata. |
| `export-cookies.mjs` | Exports the Playwright session as a Netscape `cookies.txt` for yt-dlp. |
| `plan.mjs` | The confirm step: diffs the collected list against the archive, renders the status block, owns `.plan.json`. |
| `cursor.mjs` | Resolves an account's folder by identity; writes `cursor.json`; answers what the downloads root is. |
| `paths.mjs` | Single source of truth for where state lives and how Playwright is found. |
| `collect-douyin-ids.js` | The same harvest as a DevTools console snippet — a no-dependency fallback if Playwright breaks. |

## State files, disjoint on purpose

`.archive.txt` (yt-dlp's) is the **sole** record of what has downloaded.
`cursor.json` holds identity and last-run metadata and **gates nothing**.

They deliberately do not both track downloads. If they did, a run that failed
between writing one and the other would leave the cursor claiming videos that
were never fetched, and the error would be silent and permanent.

`.plan.json` is a third file but not a third source of truth: it is a cache of
one collection pass, and every question it answers is re-derived from the
archive next time.

## Plan, then go

Nothing about an account can be reported before it is collected — not the
nickname, not the video count, and certainly not how many are new. So the run
is split: `--plan` collects, diffs and reports; `--go` downloads what the
report described. In between, the list waits in `<folder>/.plan.json`, which is
why confirming costs no second collection and why what is fetched is exactly
what was shown.

`--go` opens no browser at all. The `sec_uid` is in the profile URL, so the
folder is found by scanning the root for a matching `cursor.json` **or**
`.plan.json` — the second of those is what finds an account planned but never
downloaded, which by definition has no cursor yet.

A plan is refused rather than repaired when it is missing, older than 24h, or
written for another account, root or folder. The alternative to refusing is
downloading a list the user never approved. It is deleted once every video in
it has landed, and kept when a run stops partway, so a retry re-fetches only
what is missing.

`--yes` does both halves in one process, for using the scripts by hand. The
skill never uses it: an agent asks.

## The downloads root is computed once

`paths.mjs` owns it — `normalizeRoot` for an explicit `--downloads` (tilde
expanded, made absolute, symlinks resolved as far as the path exists) and
`downloadsRoot` for the default. `download.sh` asks for it through
`cursor.mjs root` rather than recomputing it in shell, because a root that
disagrees between the two languages splits `.archive.txt` and silently
re-downloads everything.

The symlink resolution is not fussiness: on macOS the default root comes back
as `/private/tmp/...` while a hand-typed `--downloads /tmp/...` would not, and
a plan made one way would then be refused the other.

## No early-stop

Collection always scrolls the whole feed. An earlier design stopped once it hit
already-downloaded IDs, which is unsafe — Douyin pins up to 3 posts at the top
regardless of age, so a stop-at-first-known rule halts immediately and collects
nothing, forever, silently.

It is also not worth defending against: a full scroll of a 284-video account
measures **~34 seconds**, while downloads take 30–40 minutes and are already
deduped by `.archive.txt`. If you ever point this at an account with thousands
of videos, revisit — a `--fast` opt-in would be the shape to add.

## Counts will not match

`作品 N` in the profile header counts posts that never render as cards: private,
deleted, region-locked. The 284-video account used in testing collects 282 on
every run, reproducibly. The summary reports the gap rather than treating it as
an error.

## Where things live

Nothing mutable hangs off the skill directory. It may be installed read-only,
sit inside a plugin directory that updates replace, or be moved anywhere — so
paths are never derived from its location.

| What | Where | Why |
| --- | --- | --- |
| session, cookies, `node_modules` | `${XDG_STATE_HOME:-~/.local/state}/douyin-downloader/` | user-level: sign in once, not once per project; survives skill reinstalls |
| downloads | `--downloads DIR`, else `<git root of cwd, else cwd>/downloads/` | project-level: an archive belongs beside the work it is part of, unless the user says otherwise |
| Chromium binaries | `~/Library/Caches/ms-playwright` | shared across every project, so the ~150MB is paid once |

**A cwd inside the skill is not a project.** Asked to run `scripts/download.sh`,
an agent tends to cd here first — and in a project that is not a git repository,
`cwd/downloads` was then the skill's own folder. Whole archives landed in
`<project>/.claude/skills/douyin-downloader/downloads/`, where the next update
deletes them. So a cwd under the skill directory is discarded: the project is
recovered from the install path (`<project>/.claude/skills/<skill>` or
`.agents/`), and where that names none, the run stops and asks for
`--downloads`. Guessing is the one thing it must not do — a wrong root splits
`.archive.txt` and silently re-downloads everything.

`paths.mjs` is the only place these rules are written, and `download.sh` asks
it rather than reimplementing them. `../setup.sh` installs into the state
directory and is safe to re-run — the skill's `package.json` is the version
manifest, copied in at install time.

Playwright is loaded from the state directory by explicit path, since that is
outside Node's upward module resolution. It is CommonJS, so an import by path
lands its exports on `.default` — `loadPlaywright()` normalises that.

## Tests

The pure logic — the diff, the plan validation rules, the status rendering,
path normalisation — has unit tests, and no dependencies beyond Node:

```bash
node --test scripts/plan.test.mjs scripts/paths.test.mjs
```

Everything else (a real grid, a real session, yt-dlp) is verified by running it
against a live account.

## Manual use

The scripts work standalone if you want them without the skill:

```bash
# establish or refresh the session (opens a window)
node collect-douyin-ids.mjs --login "https://www.douyin.com/user/MS4w..."

# an account, without the two-step confirm
./download.sh "https://www.douyin.com/user/MS4w..." --downloads ~/Videos/douyin --yes

# collect only
node collect-douyin-ids.mjs --headless "https://www.douyin.com/user/MS4w..." -o urls.txt

# download an arbitrary list
./download-douyin.sh -i urls.txt -o ~/Videos/douyin
```

`download-douyin.sh` accepts full `/video/` URLs, `/user/...?modal_id=...` URLs,
and bare numeric IDs interchangeably, and de-duplicates them. Use `-n` to see
the yt-dlp command without running it.
