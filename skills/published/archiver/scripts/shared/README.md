# Shared modules

What more than one platform needs. A rule that drifts between two copies of
these corrupts an archive both platforms read, so there is one copy and the
platforms are threaded with a descriptor where they differ.

| File | Role |
| --- | --- |
| `platforms.mjs` | The registry: every platform this skill knows, the host patterns that resolve a URL to one, and each one's account descriptor. |
| `account.mjs` | Where an account's folder is, and the identity written inside it. Takes a descriptor, because the platform folder and the name of the readable handle are the only things that vary. |
| `landed.mjs` | What is already downloaded, answered from the post folders themselves. |
| `post.mjs` | The shape of `post.json`, and whether a post holds every file it lists. |
| `naming.mjs` | A post folder's name, and a moment as a string. Built and read back in one place. |
| `sync.mjs` | `sync.json`: the parked plan and the last run's history. Deletable without loss. |
| `archiver.mjs` | The archives root's schema version, the id → alias map, and the refusal when the schema is one this build cannot read. |
| `paths.mjs` | Where state lives, per platform, and where archives land. |
| `cli.mjs` | Argument parsing, file reading, atomic JSON writing, entry-point detection. |
| `exit.mjs` | One exit table, so a caller can tell "rate-limited" from "you typed the flag wrong" without knowing which platform ran. |
| `tools.mjs` | Whether the platform's downloader is installed, and what to say if not. |

## The archive both platforms write

One root, one shape. This is the contract the modules above implement, and the
reason they are shared rather than copied.

```
<archives root>/
  archiver.json                 {"schema": 3, "accounts": {…}}
  x/<alias, else user id>/      douyin/<alias, else sec_uid>/
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
- the account folder is the account's `--alias` if it has one and its immutable
  id if it does not, under a platform folder — because both skills default to the
  same `<git root>/archives` root, and an alias chosen on one platform must not
  be able to collide with one chosen on the other.
- an alias is refused if it is another account's id on that platform, or already
  another account's alias. Letters (`\p{L}`, so CJK), digits, `.`, `_`, `-`;
  no spaces, no separators, no leading dot, 128 chars.
- `account.json`'s `alias` is always `basename(dir)`, written from the folder
  rather than from the flag. That is the whole of "the folder's location wins":
  a directory renamed by hand is adopted by the next write, and the two cannot
  drift. An empty `--alias` is silence; `--unalias` is the removal.
- a rename is three writes in one order — the folder, then `account.json` inside
  it, then `archiver.json` — because the tree is the truth and the root file is
  a cache. A crash before the last one is repaired by the next scan. `--plan`
  never moves anything; `--go` does.
- `account.json` beside `posts/`, holding `version`, `platform`, `account` and
  `url` and nothing else — authoritative for identity, never for progress. The
  alias is a key *inside* `account`, beside the id, so the file stays four keys
  wide. Both
  write it when the folder is resolved, both merge into what is already there,
  and both treat a blank as silence rather than an erasure.
- `sync.json` beside it, holding `version`, `plan` and `last_run`. Deleting it
  loses no archive content.
- `archiver.json` at the root, holding the schema version and `accounts`, an
  id → alias map nested per platform. Absent reads as current; unknown stops the
  run; **schema 2 is readable and upgraded in place**, since every schema-2
  folder is a legal un-aliased schema-3 one. An account with no alias has no
  entry. A mapping entry pointing at a folder that is not there is a stale cache
  line and self-heals; a file that cannot be *parsed* stops the run, because it
  may be a schema from the future and rebuilding it would clobber it.

## The descriptor

`account.mjs` is threaded with `{ platform, handleKey }` — the folder a
platform's accounts live under, and what `account.json` calls the readable
handle (`douyin_id`, `handle`). Explicit rather than closed over, because a
descriptor in an argument list can be followed from the registry to the call.

Two things follow from the platform folder being part of the path: a sec_uid and
an X user id can never name the same directory, and an alias chosen on one
platform can never collide with one chosen on the other.

## Adding to these

Anything here is read by every platform. Before changing a rule, check what the
other platform does with it — the archive is meant to be readable with one
mental model, and these modules are what make that true rather than aspirational.
