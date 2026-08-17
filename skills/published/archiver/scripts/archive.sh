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
# because it must happen before node runs. Each platform preflights its own
# tools once it has been dispatched to.
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

if ! command -v node >/dev/null 2>&1; then
  cat <<'JSON'
{
  "schema": 1,
  "ok": false,
  "command": null,
  "platform": null,
  "exit": 4,
  "error": {
    "code": "node-missing",
    "message": "node is not installed",
    "remedy": {
      "message": "install Node from https://nodejs.org",
      "command": "brew install node",
      "run_by": "user"
    }
  }
}
JSON
  exit 4
fi

# Named so the refusal messages can print a command the user can actually run.
export ARCHIVE_SELF="${SCRIPT_DIR}/archive.sh"

exec node "${SCRIPT_DIR}/dispatch.mjs" "$@"
