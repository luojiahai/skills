#!/usr/bin/env bash
#
# archive.sh — entry point for the archiver skill.
#
#   archive.sh <url> --plan     report what would be fetched
#   archive.sh <url> --go       download what that plan listed
#   archive.sh <url> --yes      both, without stopping to confirm
#   archive.sh --list           report what is already archived
#
# The URL says which platform this is; dispatch.mjs resolves it and hands the
# whole command line over. An account is never downloaded without an explicit
# --go or --yes: the list is collected, reported, and parked in sync.json until
# somebody approves it.
#
# This script deliberately does almost nothing, and what little it does it does
# because it must happen before node runs — including working out which node
# that is. Each platform builds and preflights its own tools once it has been
# dispatched to.
#
# Every command answers with one JSON document on stdout. These two refusals
# happen before node exists to compose one, so they are written out by hand —
# both are fixed strings needing no interpolation, and a command this skill
# invokes must never leave stdout empty.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Refused here rather than after dispatch because of where the platforms refuse
# it: past their own tool preflight. On a machine missing gallery-dl or yt-dlp
# that order reports the missing tool, which sends the user to install something
# when the flag is what is wrong. This check runs before any tool is looked for.
for arg in "$@"; do
  if [[ "$arg" == "--downloads" ]]; then
    cat <<'JSON'
{
  "schema": 1,
  "ok": false,
  "command": null,
  "platform": null,
  "exit": 2,
  "error": {
    "code": "downloads-renamed",
    "message": "--downloads was renamed to --archives, and the default root is now archives/",
    "remedy": {
      "message": "the old root is not read: rename downloads/ to archives/, or name the root explicitly",
      "run_by": "user"
    }
  }
}
JSON
    exit 2
  fi
done

# The Node this skill runs on is the one in the runtime box, and only that one.
# A `node` on PATH is never used and never consulted: the version that runs the
# scripts is as much a part of the environment this skill owns as the downloaders
# are, and "which node did this run on" must have exactly one answer.
#
# Nothing is built here. Building at dispatch would mean `--help` and a mistyped
# flag touching the network, so a box that is not there yet is a refusal naming
# setup.sh, and building stays each platform's to do once it knows it is going to
# download. Every command needs the box, `--list` and `--help` included.
#
# `ARCHIVER_SYSTEM_TOOLS=1` is the documented escape hatch, and the one thing
# that is not a fallback: it is set deliberately, all-or-nothing, and it puts the
# whole run back on PATH-resolved tools including this one.
if [[ "${ARCHIVER_SYSTEM_TOOLS:-}" == "1" ]]; then
  NODE="node"
  command -v node >/dev/null 2>&1 || NODE=""
else
  # `|| true` because errexit would kill an assignment whose substitution failed,
  # and this script must never exit with nothing on stdout. A builder that cannot
  # even say where the box would be simply means there is no box.
  RUNTIME_BOX="$("${SCRIPT_DIR}/../env/ensure-env" --print runtime 2>/dev/null || true)"
  NODE="${RUNTIME_BOX:-/nonexistent}/node/bin/node"
  [[ -x "$NODE" ]] || NODE=""
fi

if [[ -z "$NODE" ]]; then
  cat <<'JSON'
{
  "schema": 1,
  "ok": false,
  "command": null,
  "platform": null,
  "exit": 4,
  "error": {
    "code": "node-missing",
    "message": "the skill has not built the tools it runs on yet, and runs on no others",
    "remedy": {
      "message": "run the skill's setup.sh — it downloads a Node of its own, and everything else this skill runs, with nothing but curl",
      "run_by": "user"
    }
  }
}
JSON
  exit 4
fi

# Named so the refusal messages can print a command the user can actually run.
export ARCHIVE_SELF="${SCRIPT_DIR}/archive.sh"

exec "$NODE" "${SCRIPT_DIR}/dispatch.mjs" "$@"
