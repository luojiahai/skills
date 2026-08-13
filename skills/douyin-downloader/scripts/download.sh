#!/usr/bin/env bash
#
# download.sh — entry point for the douyin-downloader skill.
#
# Owns folder, plan and cursor policy; delegates the actual fetching to
# download-douyin.sh, the ID collection to collect-douyin-ids.mjs, and the
# diff-and-confirm step to plan.mjs.
#
#   download.sh <profile-url> --plan     collect, report what would be fetched
#   download.sh <profile-url> --go       download what that plan listed
#   download.sh <profile-url> --yes      both, without stopping to confirm
#   download.sh <video-url>              one video, straight away
#
# An account is never downloaded without an explicit --go or --yes: the list is
# collected first and reported, so the account, the folder and the number of
# videos are all known before anything is fetched. A bare profile URL therefore
# behaves as --plan.
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

NAME=""
URL=""
DOWNLOADS_ARG=""
MODE=""

usage() {
  cat <<'EOF'
download.sh — download a Douyin account's videos, or a single video.

Usage: download.sh <url> [--downloads DIR] [--name NAME] [--plan|--go|--yes]

  <url>   https://www.douyin.com/user/MS4w...   every video from the account
          https://www.douyin.com/video/711...   one video

Modes (profile URLs):
      --plan            Collect the video list, report what would be fetched,
                        and stop. The default: nothing is downloaded until a
                        plan has been made and approved.
      --go              Download the videos the last --plan listed. Needs a
                        plan made within the last 24h for this account and
                        this downloads root.
      --yes, -y         Plan and download in one run, without stopping.

Options:
      --downloads DIR   Root download directory. The account folder is
                        DIR/<抖音号 or --name>.
                        (default: <git root, else cwd>/downloads — required
                        when run from inside the skill directory)
      --name NAME       Folder name for this account (default: its 抖音号).
                        Only needed once; later runs find the folder by
                        matching the account identity in cursor.json.
      --user URL        Accepted as an alias for a positional profile URL.
      --profile DIR     Playwright session profile
                        (default: ~/.local/state/douyin-downloader/profile)
  -h, --help            Show this help

Videos land in <downloads>/<folder>/videos/, alongside cursor.json (identity
and last-run state), .archive.txt (yt-dlp's record of what is downloaded) and,
between --plan and --go, .plan.json (the list awaiting approval).
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --name)      NAME="$2"; shift 2 ;;
    --user)      URL="$2"; shift 2 ;;
    --downloads) DOWNLOADS_ARG="$2"; shift 2 ;;
    --profile)   PROFILE_DIR="$2"; shift 2 ;;
    --plan)      MODE="plan"; shift ;;
    --go)        MODE="go"; shift ;;
    -y | --yes)  MODE="yes"; shift ;;
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

# Where downloads live is decided in one place, paths.mjs, rather than being
# recomputed here: a root that disagrees with the one the Node scripts use
# would split .archive.txt and silently re-download everything. It also expands
# ~ and makes the path absolute, since the agent passes the user's flag through
# as typed and a quoted ~/data never reaches the shell's expansion.
DOWNLOADS="$(node "${SCRIPT_DIR}/cursor.mjs" root --downloads "$DOWNLOADS_ARG")" || exit 2

# The command that makes a plan, quoted back to the user in every message that
# needs one to exist.
PLAN_HINT="${SCRIPT_DIR}/download.sh '${URL}'${DOWNLOADS_ARG:+ --downloads '${DOWNLOADS_ARG}'}${NAME:+ --name '${NAME}'} --plan"

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

TMP_COLLECTED=""
TMP_META=""
TMP_PENDING=""
cleanup() {
  rm -f ${TMP_COLLECTED:+"$TMP_COLLECTED"} ${TMP_META:+"$TMP_META"} ${TMP_PENDING:+"$TMP_PENDING"}
}
trap cleanup EXIT

# Reads one field out of a JSON file. The path goes through argv rather than
# into the script source, so a folder name with a quote in it cannot break it.
json_field() {
  node -e 'let o={};try{o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))}catch{}
           const v=o[process.argv[2]];console.log(v===undefined||v===null?"":v)' "$1" "$2"
}

archive_count() {
  if [[ -f "$1/.archive.txt" ]]; then
    wc -l <"$1/.archive.txt" | tr -d ' '
  else
    echo 0
  fi
}

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

  [[ -f "$COOKIE_FILE" ]] || mint_cookies

  # yt-dlp's `uploader` field is the 抖音号 — enough to file the video under the
  # right account without opening a browser.
  #
  # `|| true` is load-bearing: under `set -e -o pipefail` a yt-dlp that exits
  # non-zero would take the whole script down here, with its stderr already sent
  # to /dev/null — a silent exit 1, and the retry and diagnosis below would
  # never be reached.
  uploader_of() {
    yt-dlp --cookies "$COOKIE_FILE" --print "%(uploader)s" \
      --skip-download "https://www.douyin.com/video/$1" 2>/dev/null | head -1 || true
  }

  DOUYIN_ID="$(uploader_of "$VIDEO_ID")"

  if [[ -z "$DOUYIN_ID" ]]; then
    echo "[douyin] no metadata — re-minting cookies and retrying once…"
    mint_cookies
    DOUYIN_ID="$(uploader_of "$VIDEO_ID")"
  fi

  if [[ -z "$DOUYIN_ID" ]]; then
    echo "error: could not read metadata for video ${VIDEO_ID}." >&2
    echo "The video may be private, deleted or region-locked; failing that, the" >&2
    echo "session is dead — re-establish it with:" >&2
    echo "  node ${SCRIPT_DIR}/collect-douyin-ids.mjs --login <profile-url>" >&2
    exit 1
  fi

  FOLDER="$(resolve_folder --douyin-id "$DOUYIN_ID" --name "$NAME")"

  # A single video is already as specific as an instruction gets, so it is not
  # planned or confirmed — but --plan still answers where it would land.
  if [[ "$MODE" == "plan" ]]; then
    echo "──────────────────────────────────────────"
    echo " 抖音号 ${DOUYIN_ID}"
    echo " folder      ${FOLDER}"
    echo " video       ${VIDEO_ID}"
    if [[ -f "${FOLDER}/.archive.txt" ]] && grep -qE "(^| )${VIDEO_ID}\$" "${FOLDER}/.archive.txt"; then
      echo " to fetch    0 — already downloaded"
    else
      echo " to fetch    1 new"
    fi
    echo "──────────────────────────────────────────"
    exit 0
  fi

  echo "[douyin] single video ${VIDEO_ID}"
  mkdir -p "${FOLDER}/videos"

  TMP_PENDING="$(mktemp -t douyin-single)"
  echo "https://www.douyin.com/video/${VIDEO_ID}" >"$TMP_PENDING"

  # cursor.json is deliberately not written here: a single video does not mean
  # the account has been scanned up to that point.
  download_list "$TMP_PENDING" "$FOLDER"
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

# The sec_uid is in the URL, so --go can find the account's folder without
# opening a browser at all.
SEC_UID=""
if [[ "$URL" =~ /user/([^/?#]+) ]]; then
  SEC_UID="${BASH_REMATCH[1]}"
fi

# Downloads the plan sitting in $1, which --plan wrote and the user approved.
run_plan() {
  local folder="$1" before after downloaded pending nickname douyin_id collected reported status=0

  TMP_PENDING="$(mktemp -t douyin-pending)"
  node "${SCRIPT_DIR}/plan.mjs" load --folder "$folder" --downloads "$DOWNLOADS" \
    --sec-uid "$SEC_UID" --out "$TMP_PENDING" --remedy "$PLAN_HINT"

  pending="$(wc -l <"$TMP_PENDING" | tr -d ' ')"
  nickname="$(json_field "${folder}/.plan.json" nickname)"
  douyin_id="$(json_field "${folder}/.plan.json" douyin_id)"
  collected="$(json_field "${folder}/.plan.json" collected_count)"
  reported="$(json_field "${folder}/.plan.json" reported_works_count)"
  before="$(archive_count "$folder")"

  mkdir -p "${folder}/videos"
  echo "[douyin] downloading ${pending} video(s) to ${folder}/videos…"
  download_list "$TMP_PENDING" "$folder" || status=$?

  echo "[douyin] updating cursor…"
  node "${SCRIPT_DIR}/cursor.mjs" write --folder "$folder" --meta "${folder}/.plan.json" \
    --downloads "$DOWNLOADS"

  after="$(archive_count "$folder")"
  downloaded=$((after - before))

  # Kept after a partial run, so a retry re-fetches only what is missing
  # without paying for another collection; removed once it has all landed.
  if [[ "$status" == 0 ]]; then
    node "${SCRIPT_DIR}/plan.mjs" clear --folder "$folder"
  fi

  echo
  echo "──────────────────────────────────────────"
  echo " ${nickname:-?} (抖音号 ${douyin_id:-?})"
  echo " folder      ${folder}"
  echo " collected   ${collected:-?} of ${reported:-?} reported"
  echo " downloaded  ${downloaded} new, ${after} total"
  if [[ "$status" != 0 ]]; then
    echo " warning     some downloads failed — re-run --go to retry only those"
  fi
  echo "──────────────────────────────────────────"

  return "$status"
}

# ---- --go: download an approved plan, no browser involved -------------------
if [[ "$MODE" == "go" ]]; then
  if ! FOLDER="$(resolve_folder --sec-uid "$SEC_UID" --require-match)"; then
    echo "error: no folder for this account under ${DOWNLOADS}, so there is no plan to run." >&2
    echo "  run: ${PLAN_HINT}" >&2
    exit 2
  fi
  run_plan "$FOLDER"
  exit $?
fi

# ---- --plan / --yes: collect, diff, report ---------------------------------
TMP_COLLECTED="$(mktemp -t douyin-urls)"
TMP_META="$(mktemp -t douyin-meta)"

echo "[douyin] collecting video IDs…"
node "${SCRIPT_DIR}/collect-douyin-ids.mjs" "$URL" \
  -o "$TMP_COLLECTED" --meta "$TMP_META" --headless --profile "$PROFILE_DIR"

DOUYIN_ID="$(json_field "$TMP_META" douyin_id)"
[[ -n "$SEC_UID" ]] || SEC_UID="$(json_field "$TMP_META" sec_uid)"

if [[ -z "$DOUYIN_ID" ]]; then
  echo "error: could not read 抖音号 from the profile page." >&2
  exit 1
fi

FOLDER="$(resolve_folder --douyin-id "$DOUYIN_ID" --sec-uid "$SEC_UID" --name "$NAME")"

echo
node "${SCRIPT_DIR}/plan.mjs" build --meta "$TMP_META" --urls "$TMP_COLLECTED" \
  --folder "$FOLDER" --downloads "$DOWNLOADS"

# No plan file means nothing to fetch. The scan was then the whole run, so the
# cursor is brought up to date and there is nothing to confirm.
if [[ ! -f "${FOLDER}/.plan.json" ]]; then
  node "${SCRIPT_DIR}/cursor.mjs" write --folder "$FOLDER" --meta "$TMP_META" \
    --downloads "$DOWNLOADS"
  exit 0
fi

if [[ "$MODE" != "yes" ]]; then
  echo
  echo "Nothing has been downloaded. To fetch the videos above:"
  echo "  ${PLAN_HINT% --plan} --go"
  exit 0
fi

echo
run_plan "$FOLDER"
