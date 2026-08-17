# The tool environment

Read this before changing anything here. What lives in this directory is the
whole of what the archiver runs on: the versions, the lock, and the shell that
turns them into directories on disk.

## Why the skill owns it

`yt-dlp` and `gallery-dl` ship extractor fixes constantly, because Douyin and X
keep changing. A copy of either that happens to be on somebody's machine is a
failure that cannot be diagnosed from here — nothing says which version ran, and
"reinstall your yt-dlp" is not a support answer. Owning the environment means
one known configuration to reason about, and one place to bump when a platform
breaks.

Not polluting somebody's machine is a consequence rather than the driver. The
boxes *are* a mutation of their disk; what they buy is that it is one
clearly-owned, self-labelled directory that can be deleted whole.

## Three boxes, partitioned by volatility

Under `${XDG_CACHE_HOME:-~/.cache}/archiver/`:

| Box | Holds | Character |
| --- | --- | --- |
| `runtime` | `uv`, CPython, Node | stable, ~100MB to fetch, ~300MB on disk |
| `tools` | `yt-dlp`, `gallery-dl` | volatile, small |
| `browser` | Playwright, Chromium | stable, ~250MB to fetch, ~570MB on disk |

**Not by platform.** `gallery-dl` already serves X and would serve Instagram;
`yt-dlp` serves Douyin and would serve others. A platform-keyed partition would
force every new platform to either duplicate a tool or trigger a re-partition. A
new platform declares which boxes it needs and adds none.

The partition is what makes `setup.sh refresh` seconds and a few megabytes
rather than a re-download of an interpreter and a browser that did not change.

Only `browser` is lazy: somebody who only ever archives X never downloads
Chromium.

Playwright installs a full Chromium and a headless shell, and both are needed:
every run but `--login` is headless, and `--login` is a visible browser a human
signs in to. That is most of what the browser box weighs.

### Cache, not state

Boxes are re-derivable from this directory, so they live in cache. Sessions and
cookies are not, so they stay in `${XDG_STATE_HOME:-~/.local/state}/archiver/`.
That is what makes `rm -rf ~/.cache/archiver` unconditionally safe, and means no
support interaction ever has to warn somebody they are about to lose a Douyin
login that cost them a QR scan.

## Keying

Each box directory is `<box>-<key>`, where the key is the first twelve hex
characters of a SHA-256 over:

- the box's own `[section]` in `manifest`, as `key=value` lines with comments,
  blank lines and the whitespace around `=` dropped; and
- for `tools` only, the `python` pin from `[runtime]`, then `pyproject.toml`,
  then `uv.lock`, verbatim.

The lock belongs to `tools` alone. Folding it into every key would re-download a
hundred megabytes of interpreter and browser for a `yt-dlp` patch, which is the
exact cost the partition exists to avoid.

Comments are normalised away before hashing so that the prose in `manifest` can
be rewritten freely. A comment that costs somebody a re-download is a comment
nobody edits.

A hand-bumped integer was rejected: forgetting to bump it silently reuses a stale
box at the exact moment you believe you have shipped a fix. Keying on the
package version was rejected: it churns the directory on releases that do not
touch a box.

The rule is written twice — `ensure-env` in shell and `scripts/shared/paths.mjs`
in JavaScript — because one builds the box and the other has to find the same
box again. `paths.test.mjs` runs both and asserts they agree; that test is what
keeps them one rule.

Each box holds a copy of `manifest`, so `cat`ting it says exactly what is in
there.

## Bootstrap and integrity

The floor is **`curl` and a POSIX shell**. Nothing else may be assumed, and
nothing here shells out to `brew`, `pip` or `pipx`.

`uv` is the root of trust: it is the one download nothing but us verifies, so its
version and its archive's SHA-256 are both pinned in `manifest` and the hash is
checked before the binary is ever executed. Never `curl | sh` an unpinned
installer here — everything else chains off this link.

Below it, trust what the tools already do. `uv.lock` carries hashes for the whole
Python tree, Node's tarball is checked against the `SHASUMS256.txt` published
beside it, and Playwright verifies its own browser downloads. Reimplementing any
of that is wasted effort.

## Pinning

`manifest` pins `uv`, CPython, Node and Playwright. `pyproject.toml` pins
`yt-dlp` and `gallery-dl` as ordinary Python dependencies and `uv.lock` fixes
their transitive tree; the manifest names those two files rather than repeating a
version that could then disagree with them, and `uv sync --frozen` fails loudly
if the two ever drift.

Bump a Python tool by editing `pyproject.toml` and running `uv lock` in this
directory. Bump anything else by editing `manifest`. Both are what a changeset
diff shows.

Pinning is deliberately chosen over auto-updating. An auto-updating component
reintroduces exactly the "which version does this user have" problem, except as
*our* silent drift instead of theirs. The cost — a user is broken between a
platform change and our bump — is bought back by `setup.sh refresh`, which
rebuilds `tools` at latest and sticks until a shipped bump passes it.

## Atomicity

Every box is built into a temp sibling and renamed into place on success, so a
keyed path either exists complete or does not exist at all. A Ctrl-C, a dropped
connection, or a second archive starting mid-build cannot leave a half-built box
behind; two builds racing each build their own temp directory and one rename
wins harmlessly, wasting bandwidth and never corrupting.

No lockfile serialises builds. Stale-lock handling is its own source of bugs, and
would buy only bandwidth. Add one if duplicated downloads become a real
complaint. A completion sentinel was rejected as strictly worse than a rename —
the same idea with a window where it is wrong.

The `tools` venv is created with `uv venv --relocatable` before anything is
installed into it, and the interpreter is named by its pinned version rather than
by the path it was installed to: uv writes the relative shebang only for a venv
it knows is on a Python it manages. Pass a path there and every console script
in the box carries an absolute shebang into a temp directory that no longer
exists.

## Known limits

**Chromium's shared libraries are not ours to install.** They are a root-owned
change to the machine, and the skill only ever writes to directories it owns, so
`ensure-env` downloads the browser and stops there. A Linux desktop with a
browser on it already has them; a bare container does not, and Playwright's own
`install-deps` is the remedy there. CI does exactly that on its Linux runners.

**X still needs a browser the skill does not own.** `scripts/x/run.mjs` reads a
session out of the user's own signed-in Chrome, Firefox, Safari, Edge or Brave,
and no box can supply one. "The environment is ours" is true of every tool the
skill executes and false of that one prerequisite.

## Keep `ensure-env` small

It is invoked lazily, immediately before the point of need, and never at
dispatch — `--help` and an argument error must go on answering without touching
the network. If it outgrows what a single integration job can meaningfully
validate, that is the signal that shell was the wrong choice and the design
needs revisiting.
