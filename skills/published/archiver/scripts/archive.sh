#!/usr/bin/env bash
#
# archive.sh — entry point for the archiver skill.
#
#   archive.sh <url> --plan     report what would be fetched
#   archive.sh <url> --go       download what that plan listed
#   archive.sh <url> --yes      both, without stopping to confirm
#
# The URL says which platform this is; dispatch.mjs resolves it and hands the
# whole command line over. An account is never downloaded without an explicit
# --go or --yes: the list is collected, reported, and parked in sync.json until
# somebody approves it.
#
# This script deliberately does almost nothing, and what little it does it does
# because it must happen before node runs. Each platform preflights its own
# tools once it has been dispatched to.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Checked here rather than after dispatch because of where it sits. The old flag
# is the one thing likely to still be in a shell history, and a platform refuses
# it too — but only past its own tool preflight, so on a machine missing
# gallery-dl or yt-dlp a stale --downloads would report the missing tool instead
# of the rename that actually broke it.
for arg in "$@"; do
  if [[ "$arg" == "--downloads" ]]; then
    echo "error: --downloads was renamed to --archives (and the default root is now archives/)" >&2
    echo "  the old root is not read: rename downloads/ to archives/, or pass --archives DIR" >&2
    exit 2
  fi
done

if ! command -v node >/dev/null 2>&1; then
  echo "error: node is not installed" >&2
  echo "  Install it from https://nodejs.org, or with:  brew install node" >&2
  exit 4
fi

# Named so the refusal messages can print a command the user can actually run.
export ARCHIVE_SELF="${SCRIPT_DIR}/archive.sh"

exec node "${SCRIPT_DIR}/dispatch.mjs" "$@"
