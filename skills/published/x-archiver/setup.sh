#!/usr/bin/env bash
#
# setup.sh — check what the x-downloader skill needs, and say how to get it.
#
# It installs nothing. Both dependencies are system packages, there is no
# portable way to install them from here, and putting software on somebody's
# machine is not a thing a skill should do on its own. So this reports, and the
# person running it decides.
#
# There is nothing else to set up: this skill has no npm dependencies, no
# browser to download, and no per-project state. The only thing it keeps is the
# cached X session, written on first use to
# ${XDG_STATE_HOME:-~/.local/state}/x-downloader/, so that reading the browser
# happens once per user rather than once per project. The skill directory itself
# stays pure source and can be installed read-only.
#
# Safe to re-run.

set -euo pipefail

STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/x-downloader"

ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }

echo "Checking x-downloader…"
echo "  state: ${STATE_DIR}"
echo

missing=0

if command -v gallery-dl >/dev/null 2>&1; then
  ok "gallery-dl $(gallery-dl --version 2>/dev/null || echo '(version unknown)')"
else
  warn "gallery-dl not found — this is what enumerates and downloads"
  if [[ "$(uname -s)" == "Darwin" ]] && command -v brew >/dev/null 2>&1; then
    echo "      Install it with:  brew install gallery-dl"
  else
    echo "      Install it with:  pipx install gallery-dl"
    echo "      or see https://github.com/mikf/gallery-dl#installation"
  fi
  missing=1
fi

if command -v node >/dev/null 2>&1; then
  ok "node $(node --version)"
else
  warn "node not found"
  echo "      Install it from https://nodejs.org, or:  brew install node"
  missing=1
fi

echo
if [[ -f "${STATE_DIR}/cookies.txt" ]]; then
  ok "an X session is cached"
else
  warn "no X session cached yet"
  echo "      The first run reads one from your browser. Sign in to X there, then:"
  echo "        <skill-dir>/scripts/download.sh <url> --browser chrome --plan"
fi

echo
if [[ "$missing" -eq 0 ]]; then
  echo "Ready."
else
  echo "Install what is missing above, then re-run this."
  exit 1
fi
