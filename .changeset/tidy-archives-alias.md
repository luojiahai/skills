---
"luojiahai-skills": patch
---

Both archivers can now name an account's folder something you can read. This is
a **breaking** change to the flag and to the archive layout, though nothing has
to be migrated by hand.

`--name` is gone and `--alias` replaces it. Where `--name` was a label filed
inside `account.json`, `--alias` **names the folder**:

```
archives/x/jia/          instead of  archives/x/1458023001234567890/
archives/douyin/小明/     instead of  archives/douyin/MS4wLjABAAAAEKnfa654JAJ…/
```

An account already archived is renamed on the next `--go`; a new one is created
under that name straight away. `--plan` reports the move and never performs it,
so a preview cannot reorganise your archive. `--unalias` puts a folder back
under its id — an empty `--alias` means nothing at all, since that is how the
flag is passed when it has no value.

`archiver.json` is **schema 3** and now carries the mapping, keyed by the id and
nested per platform, so the same file can serve both skills without an X `jia`
and a Douyin `jia` colliding:

```json
{ "schema": 3, "accounts": { "x": { "1458023001234567890": "jia" } } }
```

Existing archives are **upgraded in place on the next run** — every schema-2
folder is already a legal un-aliased schema-3 one, so nothing moves.

The mapping is a cache rather than an authority. Each folder's `account.json`
carries the same alias, so a mapping entry pointing at nothing costs a directory
scan and repairs itself. Rename a folder in Finder and the next run adopts the
new name: where the folder and the records disagree, the folder wins. A file
that cannot be *parsed* still stops the run, since it may be a schema this build
does not know.

An alias may be letters in any script, digits, `.`, `_` and `-`. Spaces,
separators and a leading dot are refused rather than rewritten, as is an alias
that is another account's id or already another account's alias — all of it
before anything is fetched.

Also fixed: a failed single-post run parked a plan whose URL named the *post*,
and the next account-level `--go` was then refused as "the plan is for another
account" when it was for this one. `--go` now resolves the folder before reading
the plan, so the plan is checked against the account's id rather than against a
URL standing in for it.
