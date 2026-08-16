#!/usr/bin/env bash
#
# setup.sh — install what the douyin-downloader skill needs.
#
# Everything mutable goes to ${XDG_STATE_HOME:-~/.local/state}/douyin-downloader:
# the npm dependency, the browser session, the exported cookies. The skill
# directory itself stays pure source, so it can be installed read-only, live
# inside a plugin directory that updates replace, or be moved anywhere.
#
# Playwright's browser binaries are the exception — they go to a shared cache
# (~/Library/Caches/ms-playwright on macOS) reused by every project.
#
# Safe to re-run; each step is a no-op when already satisfied.

set -euo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/douyin-downloader"

ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }

echo "Setting up douyin-downloader…"
echo "  state: ${STATE_DIR}"
echo

mkdir -p "$STATE_DIR"

# ---- yt-dlp ----------------------------------------------------------------
# Not installable from here in any portable way, so check and instruct.
if command -v yt-dlp >/dev/null 2>&1; then
  ok "yt-dlp $(yt-dlp --version)"
else
  warn "yt-dlp not found"
  if [[ "$(uname -s)" == "Darwin" ]] && command -v brew >/dev/null 2>&1; then
    echo "      Install it with:  brew install yt-dlp"
  else
    echo "      Install it with:  pipx install yt-dlp"
    echo "      or see https://github.com/yt-dlp/yt-dlp#installation"
  fi
  MISSING=1
fi

# ---- node ------------------------------------------------------------------
if command -v node >/dev/null 2>&1; then
  ok "node $(node -v)"
else
  warn "node not found — install it with:  brew install node"
  MISSING=1
fi

# ---- playwright ------------------------------------------------------------
# Installed into the state dir. The skill's package.json is the manifest, so the
# pinned version stays under version control; it is copied in to install against.
if command -v npm >/dev/null 2>&1; then
  cp "${SKILL_DIR}/package.json" "${STATE_DIR}/package.json"

  echo "  … installing playwright into the state directory"
  npm install --prefix "$STATE_DIR" --silent

  ok "playwright $(node -e "console.log(require('${STATE_DIR}/node_modules/playwright/package.json').version)")"

  echo "  … fetching chromium (shared cache, skipped if present)"
  # Quiet on success, loud on failure: under `set -e` a swallowed stderr here
  # was a silent death in the middle of setup.
  if (cd "$STATE_DIR" && npx --yes playwright install chromium >"${STATE_DIR}/chromium-install.log" 2>&1); then
    ok "chromium ready"
  else
    warn "chromium install failed — the last of ${STATE_DIR}/chromium-install.log:"
    tail -n 10 "${STATE_DIR}/chromium-install.log" | sed 's/^/      /'
    MISSING=1
  fi
else
  warn "npm not found — install node, which bundles it"
  MISSING=1
fi

echo
if [[ -n "${MISSING:-}" ]]; then
  echo "Setup incomplete — install what is flagged above, then re-run this script."
  exit 1
fi

# ---- session ---------------------------------------------------------------
# Deliberately not automated: only a human can pass Douyin's login.
PROFILE_DIR="${STATE_DIR}/profile"

if [[ -d "$PROFILE_DIR" ]]; then
  ok "Douyin session present"
  echo
  echo "Ready. Try:  ${SKILL_DIR}/scripts/download.sh <douyin-url>"
else
  echo "One step left — establish a Douyin session (you have to sign in yourself):"
  echo
  echo "  node ${SKILL_DIR}/scripts/collect-douyin-ids.mjs --login <profile-url>"
  echo
  echo "A browser opens. Sign in, wait for the video grid, press Enter."
fi
