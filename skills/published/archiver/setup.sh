#!/usr/bin/env bash
#
# setup.sh — what the archiver skill needs, per platform.
#
#   setup.sh              check every platform, install nothing
#   setup.sh douyin       build everything Douyin needs, before it is needed
#   setup.sh x            build everything X needs, before it is needed
#   setup.sh instagram    build everything Instagram needs, before it is needed
#   setup.sh refresh      rebuild the downloaders at their latest release
#   setup.sh clean        delete the tools this skill built
#
# The skill builds and runs its own tools rather than asking anybody to install
# any, so there is nothing here to go and fetch by hand. What is left is
# pre-warming: this is what you run before a flight or a long batch, and it is
# the answer for anybody who would rather not be asked mid-run.
#
# A bare run reports and downloads nothing — somebody who only ever archives X
# should never be handed a Chromium download — and building is asked for by
# name. The platforms still cost very different things: X and Instagram need the
# downloaders, Douyin needs those plus a browser and an interactive sign-in.
#
# Everything re-derivable goes to ${XDG_CACHE_HOME:-~/.cache}/archiver, and
# everything that is not — sessions and cookies — to
# ${XDG_STATE_HOME:-~/.local/state}/archiver/<platform>. The skill directory
# itself stays pure source, so it can be installed read-only, live inside a
# plugin directory that updates replace, or be moved anywhere.
#
# Safe to re-run; each step is a no-op when already satisfied.

set -euo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENSURE="${SKILL_DIR}/env/ensure-env"
STATE_ROOT="${XDG_STATE_HOME:-$HOME/.local/state}/archiver"
CACHE_ROOT="${XDG_CACHE_HOME:-$HOME/.cache}/archiver"

ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }

# Whether a box is already built, without building it.
have_box() { [[ -d "$("$ENSURE" --print "$1")" ]]; }

report_box() {
  if have_box "$1"; then
    ok "$2 ready — $("$ENSURE" --print "$1")"
  else
    warn "$2 not built yet"
  fi
}

# ---- x ---------------------------------------------------------------------

check_x() {
  local state="${STATE_ROOT}/x"
  echo "X, formerly Twitter — state: ${state}"

  report_box runtime "the runtime"
  report_box tools "gallery-dl"

  if [[ -f "${state}/cookies.txt" ]]; then
    ok "an X session is cached"
  else
    warn "no X session cached yet"
    echo "      X's login cannot be scripted, by this or anything else, so the"
    echo "      session is read out of a browser you are already signed in to:"
    echo "        ${SKILL_DIR}/scripts/archive.sh <url> --browser chrome --plan"
  fi
  echo
}

build_x() {
  "$ENSURE" runtime tools
  check_x
}

# ---- instagram -------------------------------------------------------------

check_instagram() {
  local state="${STATE_ROOT}/instagram"
  echo "Instagram — state: ${state}"

  report_box runtime "the runtime"
  report_box tools "gallery-dl"

  if [[ -f "${state}/cookies.txt" ]]; then
    ok "an Instagram session is cached"
  else
    warn "no Instagram session cached yet"
    echo "      Instagram's login cannot be scripted into anything but a"
    echo "      checkpoint, so the session is read out of a browser you are"
    echo "      already signed in to:"
    echo "        ${SKILL_DIR}/scripts/archive.sh <url> --browser chrome --plan"
  fi
  echo
}

build_instagram() {
  "$ENSURE" runtime tools
  check_instagram
}

# ---- douyin ----------------------------------------------------------------

check_douyin() {
  local state="${STATE_ROOT}/douyin"
  echo "Douyin — state: ${state}"

  report_box runtime "the runtime"
  report_box tools "yt-dlp"
  report_box browser "the browser"

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

build_douyin() {
  "$ENSURE" runtime tools browser
  check_douyin
}

# ---- what was asked for ----------------------------------------------------

case "${1:-}" in
  '')
    echo "Checking every platform. Nothing will be installed."
    echo
    check_douyin
    check_x
    check_instagram
    echo "The skill builds the tools it runs on the first time it needs them,"
    echo "into ${CACHE_ROOT}. Name a platform here to build them now instead."
    exit 0
    ;;
  douyin)
    echo "Setting up Douyin…"
    echo
    build_douyin
    ;;
  x)
    echo "Setting up X…"
    echo
    build_x
    ;;
  instagram)
    echo "Setting up Instagram…"
    echo
    build_instagram
    ;;
  refresh)
    echo "Rebuilding the downloaders at their latest release…"
    echo
    "$ENSURE" --refresh
    echo "They stay in use until a shipped bump passes them, and are then dropped."
    exit 0
    ;;
  clean)
    "$ENSURE" --clean
    echo "Sessions and cookies under ${STATE_ROOT} are untouched."
    exit 0
    ;;
  -h|--help)
    sed -n '3,10p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    exit 0
    ;;
  *)
    echo "error: no platform called '$1' — try: douyin, x, instagram, refresh, clean, or no argument for all" >&2
    exit 2
    ;;
esac

echo "Ready. Try:  ${SKILL_DIR}/scripts/archive.sh <url> --plan"
