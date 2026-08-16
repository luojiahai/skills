#!/usr/bin/env bash
#
# archive.sh — entry point for the x-archiver skill.
#
#   archive.sh <url> --plan     enumerate, report what would be fetched
#   archive.sh <url> --go       download what that plan listed
#   archive.sh <url> --yes      both, without stopping to confirm
#
# An account is never downloaded without an explicit --go or --yes: the list is
# collected, reported, and parked in sync.json until somebody approves it. With
# no mode flag this behaves as --plan.
#
# This script deliberately does almost nothing. It checks that the tools are
# present and hands the whole run to run.mjs, because orchestration in bash is
# where the sibling skill's worst class of bug lives: a function called under
# `||` runs with errexit switched off for its entire body, so a refused plan
# prints its refusal and then carries on through the state write and a summary
# telling the user to re-run the command that just failed.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  node "${SCRIPT_DIR}/run.mjs" --help
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ $# -eq 0 ]]; then
  usage >&2
  exit 2
fi

# The one piece of argument handling this shell holds, and it is here because of
# where it sits. run.mjs refuses the old flag too, but it is only reached past
# the preflight below — so on a machine without gallery-dl a stale --downloads
# would report the missing tool instead of the rename that actually broke it.
for arg in "$@"; do
  if [[ "$arg" == "--downloads" ]]; then
    echo "error: --downloads was renamed to --archives (and the default root is now archives/)" >&2
    echo "  the old root is not read: rename downloads/ to archives/, or pass --archives DIR" >&2
    exit 2
  fi
done

# ---- preflight -------------------------------------------------------------
# Neither of these is installable from here in any portable way, so they are
# checked and the remedy is printed. Nothing is installed onto anyone's machine.

if ! command -v node >/dev/null 2>&1; then
  echo "error: node is not installed" >&2
  echo "  Install it from https://nodejs.org, or with:  brew install node" >&2
  exit 4
fi

if ! command -v gallery-dl >/dev/null 2>&1; then
  echo "error: gallery-dl is not installed" >&2
  if [[ "$(uname -s)" == "Darwin" ]] && command -v brew >/dev/null 2>&1; then
    echo "      Install it with:  brew install gallery-dl" >&2
  else
    echo "      Install it with:  pipx install gallery-dl" >&2
    echo "      or see https://github.com/mikf/gallery-dl#installation" >&2
  fi
  exit 4
fi

# Named so the refusal messages can print a command the user can actually run.
export ARCHIVE_SELF="${SCRIPT_DIR}/archive.sh"

exec node "${SCRIPT_DIR}/run.mjs" "$@"
