#!/usr/bin/env bash
#
# download.sh — entry point for the douyin-downloader skill.
#
# Owns folder and cursor policy; delegates the actual fetching to
# download-douyin.sh and the ID collection to collect-douyin-ids.mjs.
#
#   download.sh https://www.douyin.com/user/MS4w...     all of an account
#   download.sh https://www.douyin.com/video/711...     one video
#
# Runs are resumable: yt-dlp's .archive.txt in the account folder is the sole
# record of what has landed, so a re-run fetches only what is missing.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# The skill directory is pure source and may live anywhere — a plugin dir, a
# read-only checkout — so nothing mutable hangs off it. Session state is
# user-level (log in once, not once per project); downloads are project-level
# (an archive belongs beside the work it is part of).
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/douyin-downloader"
PROFILE_DIR="${STATE_DIR}/profile"
COOKIE_FILE="${STATE_DIR}/cookies.txt"

GIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
DOWNLOADS="${GIT_ROOT:-$PWD}/downloads"

NAME=""
URL=""

usage() {
  cat <<'EOF'
download.sh — download a Douyin account's videos, or a single video.

Usage: download.sh <url> [--name NAME]

  <url>   https://www.douyin.com/user/MS4w...   every video from the account
          https://www.douyin.com/video/711...   one video

Options:
      --name NAME       Folder name for this account (default: its 抖音号).
                        Only needed once; later runs find the folder by
                        matching the account identity in cursor.json.
      --user URL        Accepted as an alias for a positional profile URL.
      --downloads DIR   Root download directory
                        (default: <git root, else cwd>/downloads)
      --profile DIR     Playwright session profile
                        (default: ~/.local/state/douyin-downloader/profile)
  -h, --help            Show this help

Videos land in <downloads>/<folder>/videos/, alongside cursor.json (identity
and last-run state) and .archive.txt (yt-dlp's record of what is downloaded).
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --name)      NAME="$2"; shift 2 ;;
    --user)      URL="$2"; shift 2 ;;
    --downloads) DOWNLOADS="$2"; shift 2 ;;
    --profile)   PROFILE_DIR="$2"; shift 2 ;;
    -h | --help) usage; exit 0 ;;
    -*) echo "error: unknown option '$1' (try --help)" >&2; exit 2 ;;
    *)  URL="$1"; shift ;;
  esac
done

if [[ -z "$URL" ]]; then
  usage
  echo >&2
  echo "error: no URL given" >&2
  exit 2
fi

# ---- preflight -------------------------------------------------------------
# Three cheap checks with a one-line remedy each. Session expiry is the fourth
# failure mode and needs a browser, so it surfaces from the collector instead.

if ! command -v yt-dlp >/dev/null 2>&1; then
  echo "error: yt-dlp not found — install it with: brew install yt-dlp" >&2
  echo "Or run ${SKILL_DIR}/setup.sh, which checks everything at once." >&2
  exit 1
fi

# Dependencies live in the state directory, not the skill directory, so a
# plugin update replacing the skill cannot delete them. A skill-local
# node_modules is still accepted, for running straight from a checkout.
if [[ ! -d "${STATE_DIR}/node_modules/playwright" && ! -d "${SKILL_DIR}/node_modules/playwright" ]]; then
  echo "error: playwright not installed — run: ${SKILL_DIR}/setup.sh" >&2
  exit 1
fi

if [[ ! -d "$PROFILE_DIR" ]]; then
  echo "error: no Douyin session at ${PROFILE_DIR}" >&2
  echo "Establish one with:" >&2
  echo "  node ${SCRIPT_DIR}/collect-douyin-ids.mjs --login <profile-url>" >&2
  exit 1
fi

TMP_URLS=""
TMP_META=""
cleanup() { rm -f ${TMP_URLS:+"$TMP_URLS"} ${TMP_META:+"$TMP_META"}; }
trap cleanup EXIT

# Cookies are cached and reused; they are only re-minted when yt-dlp actually
# rejects them, so the common path costs no browser launch.
mint_cookies() {
  node "${SCRIPT_DIR}/export-cookies.mjs" -o "$COOKIE_FILE" --profile "$PROFILE_DIR"
}

# Runs download-douyin.sh, re-minting cookies and retrying once if the session
# was the problem. Returns download-douyin.sh's exit status.
download_list() {
  local list="$1" folder="$2" log status
  log="$(mktemp -t douyin-dl-log)"

  [[ -f "$COOKIE_FILE" ]] || mint_cookies

  # Videos go in videos/; the archive stays at the folder root next to
  # cursor.json, so state is not buried among 282 media files.
  set +e
  "${SCRIPT_DIR}/download-douyin.sh" -i "$list" -o "${folder}/videos" --flat \
    --archive "${folder}/.archive.txt" --cookies "$COOKIE_FILE" 2>&1 | tee "$log"
  status="${PIPESTATUS[0]}"
  set -e

  if [[ "$status" != 0 ]] && grep -q "Fresh cookies" "$log"; then
    echo
    echo "[douyin] session cookies rejected — re-minting and retrying once…"
    mint_cookies
    set +e
    "${SCRIPT_DIR}/download-douyin.sh" -i "$list" -o "${folder}/videos" --flat \
      --archive "${folder}/.archive.txt" --cookies "$COOKIE_FILE" 2>&1 | tee "$log"
    status="${PIPESTATUS[0]}"
    set -e
  fi

  rm -f "$log"
  return "$status"
}

resolve_folder() {
  node "${SCRIPT_DIR}/cursor.mjs" resolve --downloads "$DOWNLOADS" "$@"
}

# ---- single video ----------------------------------------------------------
if [[ "$URL" =~ /video/([0-9]+) ]]; then
  VIDEO_ID="${BASH_REMATCH[1]}"
  echo "[douyin] single video ${VIDEO_ID}"

  [[ -f "$COOKIE_FILE" ]] || mint_cookies

  # yt-dlp's `uploader` field is the 抖音号 — enough to file the video under the
  # right account without opening a browser.
  DOUYIN_ID="$(yt-dlp --cookies "$COOKIE_FILE" --print "%(uploader)s" \
    --skip-download "https://www.douyin.com/video/${VIDEO_ID}" 2>/dev/null | head -1)"

  if [[ -z "$DOUYIN_ID" ]]; then
    echo "[douyin] cookies rejected — re-minting and retrying once…"
    mint_cookies
    DOUYIN_ID="$(yt-dlp --cookies "$COOKIE_FILE" --print "%(uploader)s" \
      --skip-download "https://www.douyin.com/video/${VIDEO_ID}" 2>/dev/null | head -1)"
  fi

  if [[ -z "$DOUYIN_ID" ]]; then
    echo "error: could not read video metadata — the session may be dead." >&2
    echo "Re-establish it with: node ${SCRIPT_DIR}/collect-douyin-ids.mjs --login <profile-url>" >&2
    exit 1
  fi

  FOLDER="$(resolve_folder --douyin-id "$DOUYIN_ID" ${NAME:+--name "$NAME"})"
  mkdir -p "${FOLDER}/videos"

  TMP_URLS="$(mktemp -t douyin-single)"
  echo "https://www.douyin.com/video/${VIDEO_ID}" >"$TMP_URLS"

  # cursor.json is deliberately not written here: a single video does not mean
  # the account has been scanned up to that point.
  download_list "$TMP_URLS" "$FOLDER"
  echo
  echo "[douyin] ${FOLDER}/videos"
  exit 0
fi

# ---- whole account ---------------------------------------------------------
if [[ ! "$URL" =~ douyin\.com/user/ ]]; then
  echo "error: not a Douyin profile or video URL: $URL" >&2
  echo "Expected .../user/MS4wLjABAAAA... or .../video/<id>" >&2
  exit 2
fi

TMP_URLS="$(mktemp -t douyin-urls)"
TMP_META="$(mktemp -t douyin-meta)"

echo "[1/3] Collecting video IDs…"
node "${SCRIPT_DIR}/collect-douyin-ids.mjs" "$URL" \
  -o "$TMP_URLS" --meta "$TMP_META" --headless --profile "$PROFILE_DIR"

DOUYIN_ID="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$TMP_META','utf8')).douyin_id ?? '')")"
SEC_UID="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$TMP_META','utf8')).sec_uid ?? '')")"

if [[ -z "$DOUYIN_ID" ]]; then
  echo "error: could not read 抖音号 from the profile page." >&2
  exit 1
fi

FOLDER="$(resolve_folder --douyin-id "$DOUYIN_ID" --sec-uid "$SEC_UID" ${NAME:+--name "$NAME"})"
mkdir -p "${FOLDER}/videos"

# Write identity now, not just at the end. cursor.json is what ties this
# account to a --name folder, so a run interrupted mid-download would otherwise
# leave the folder anonymous — and the next run would resolve to a fresh
# <抖音号> folder, split the archive, and re-download everything.
node "${SCRIPT_DIR}/cursor.mjs" write --folder "$FOLDER" --meta "$TMP_META"

# Count what is already downloaded, so the summary can report what is new.
# Guarded with `if` rather than `[[ ]] &&`: under set -e a failing && list
# aborts the script, which is precisely the first-run case (no archive yet).
BEFORE=0
if [[ -f "${FOLDER}/.archive.txt" ]]; then
  BEFORE="$(wc -l <"${FOLDER}/.archive.txt" | tr -d ' ')"
fi

echo "[2/3] Downloading to ${FOLDER}/videos…"
DL_STATUS=0
download_list "$TMP_URLS" "$FOLDER" || DL_STATUS=$?

echo "[3/3] Updating cursor…"
node "${SCRIPT_DIR}/cursor.mjs" write --folder "$FOLDER" --meta "$TMP_META"

AFTER=0
if [[ -f "${FOLDER}/.archive.txt" ]]; then
  AFTER="$(wc -l <"${FOLDER}/.archive.txt" | tr -d ' ')"
fi
COLLECTED="$(wc -l <"$TMP_URLS" | tr -d ' ')"
REPORTED="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$TMP_META','utf8')).reported_works_count ?? '?')")"
NICKNAME="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$TMP_META','utf8')).nickname ?? '?')")"

echo
echo "──────────────────────────────────────────"
echo " ${NICKNAME} (抖音号 ${DOUYIN_ID})"
echo " folder      ${FOLDER}"
echo " collected   ${COLLECTED} of ${REPORTED} reported"
echo " downloaded  $((AFTER - BEFORE)) new, ${AFTER} total"
if [[ "$REPORTED" != "?" && "$COLLECTED" -lt "$REPORTED" ]]; then
  echo " note        $((REPORTED - COLLECTED)) post(s) counted but not shown"
  echo "             (private, deleted, or region-locked)"
fi
if [[ "$DL_STATUS" != 0 ]]; then
  echo " warning     some downloads failed — re-run to retry only those"
fi
echo "──────────────────────────────────────────"

exit "$DL_STATUS"
