#!/usr/bin/env bash
#
# setup.sh — what the archiver skill needs, per platform.
#
#   setup.sh              check every platform, install nothing
#   setup.sh douyin       check Douyin, and install what can be installed
#   setup.sh x            check X
#
# The two platforms cost very different things. X needs gallery-dl and node, and
# nothing else: no npm dependency, no browser to download. Douyin needs yt-dlp,
# node, a Playwright browser and an interactive sign-in. So a bare run reports
# and installs nothing — somebody who only ever archives X should never be given
# a Chromium download — and installing is asked for by name.
#
# Everything mutable goes to ${XDG_STATE_HOME:-~/.local/state}/archiver/<platform>.
# The skill directory itself stays pure source, so it can be installed read-only,
# live inside a plugin directory that updates replace, or be moved anywhere.
#
# Safe to re-run; each step is a no-op when already satisfied.

set -euo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_ROOT="${XDG_STATE_HOME:-$HOME/.local/state}/archiver"

ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }

MISSING=0

# Whether a brew command is a remedy on this machine, or a second thing to
# install first.
has_brew() { [[ "$(uname -s)" == "Darwin" ]] && command -v brew >/dev/null 2>&1; }

check_node() {
  if command -v node >/dev/null 2>&1; then
    ok "node $(node --version)"
  else
    warn "node not found"
    echo "      Install it from https://nodejs.org, or:  brew install node"
    MISSING=1
  fi
}

# ---- x ---------------------------------------------------------------------

check_x() {
  local state="${STATE_ROOT}/x"
  echo "X, formerly Twitter — state: ${state}"

  if command -v gallery-dl >/dev/null 2>&1; then
    ok "gallery-dl $(gallery-dl --version 2>/dev/null || echo '(version unknown)')"
  else
    warn "gallery-dl not found — this is what enumerates and downloads"
    if has_brew; then
      echo "      Install it with:  brew install gallery-dl"
    else
      echo "      Install it with:  pipx install gallery-dl"
      echo "      or see https://github.com/mikf/gallery-dl#installation"
    fi
    MISSING=1
  fi

  check_node

  if [[ -f "${state}/cookies.txt" ]]; then
    ok "an X session is cached"
  else
    warn "no X session cached yet"
    echo "      The first run reads one from your browser. Sign in to X there, then:"
    echo "        ${SKILL_DIR}/scripts/archive.sh <url> --browser chrome --plan"
  fi
  echo
}

# ---- douyin ----------------------------------------------------------------

check_douyin() {
  local install="$1"
  local state="${STATE_ROOT}/douyin"
  echo "Douyin — state: ${state}"

  if command -v yt-dlp >/dev/null 2>&1; then
    ok "yt-dlp $(yt-dlp --version)"
  else
    warn "yt-dlp not found"
    if has_brew; then
      echo "      Install it with:  brew install yt-dlp"
    else
      echo "      Install it with:  pipx install yt-dlp"
      echo "      or see https://github.com/yt-dlp/yt-dlp#installation"
    fi
    MISSING=1
  fi

  check_node

  if [[ -d "${state}/node_modules/playwright" ]]; then
    ok "playwright $(node -e "console.log(require('${state}/node_modules/playwright/package.json').version)")"
  elif [[ "$install" != "install" ]]; then
    warn "playwright not installed"
    echo "      Install it with:  ${SKILL_DIR}/setup.sh douyin"
    MISSING=1
  else
    install_playwright "$state"
  fi

  if [[ -d "${state}/profile" ]]; then
    ok "Douyin session present"
  else
    warn "no Douyin session yet — only a human can pass Douyin's login"
    echo "      Sign in once with:"
    echo "        ${SKILL_DIR}/scripts/archive.sh <douyin-url> --login"
    echo "      A browser opens. Sign in; it notices by itself and stops there."
  fi
  echo
}

# The platform's package.json is the manifest, so the pinned version stays under
# version control; it is copied into the state directory to install against, and
# the dependency lives there rather than in the skill so a plugin update
# replacing the skill cannot delete it.
install_playwright() {
  local state="$1"
  if ! command -v npm >/dev/null 2>&1; then
    warn "npm not found — install node, which bundles it"
    MISSING=1
    return
  fi

  mkdir -p "$state"
  cp "${SKILL_DIR}/scripts/douyin/package.json" "${state}/package.json"

  echo "  … installing playwright into the state directory"
  npm install --prefix "$state" --silent
  ok "playwright $(node -e "console.log(require('${state}/node_modules/playwright/package.json').version)")"

  echo "  … fetching chromium (shared cache, skipped if present)"
  # Quiet on success, loud on failure: under `set -e` a swallowed stderr here
  # was a silent death in the middle of setup.
  if (cd "$state" && npx --yes playwright install chromium >"${state}/chromium-install.log" 2>&1); then
    ok "chromium ready"
  else
    warn "chromium install failed — the last of ${state}/chromium-install.log:"
    tail -n 10 "${state}/chromium-install.log" | sed 's/^/      /'
    MISSING=1
  fi
}

# ---- what was asked for ----------------------------------------------------

case "${1:-}" in
  '')
    echo "Checking every platform. Nothing will be installed."
    echo
    check_douyin check
    check_x
    ;;
  douyin)
    echo "Setting up Douyin…"
    echo
    check_douyin install
    ;;
  x)
    echo "Checking X…"
    echo
    check_x
    ;;
  -h|--help)
    sed -n '3,7p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    exit 0
    ;;
  *)
    echo "error: no platform called '$1' — try: douyin, x, or no argument for all" >&2
    exit 2
    ;;
esac

if [[ "$MISSING" -ne 0 ]]; then
  echo "Install what is flagged above, then re-run this."
  exit 1
fi

echo "Ready. Try:  ${SKILL_DIR}/scripts/archive.sh <url> --plan"
