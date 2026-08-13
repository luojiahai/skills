#!/usr/bin/env bash
#
# download-douyin.sh — batch-download Douyin videos with yt-dlp.
#
# Takes a file of Douyin video references, normalises them to the only URL
# shape yt-dlp's Douyin extractor accepts (https://www.douyin.com/video/<id>),
# and downloads them with throttling and a resumable archive.
#
# Accepted input lines (mixed freely; blank lines and #-comments ignored):
#   https://www.douyin.com/video/7118726305914326302
#   https://www.douyin.com/user/MS4wLjABAAAA...?modal_id=7118726305914326302
#   7118726305914326302
#
# Usage: scripts/download-douyin.sh [-i urls.txt] [-o outdir] [-b browser] [-n]
# Run with --help for options.

set -euo pipefail

INPUT="urls.txt"
OUTDIR="${HOME}/Downloads/douyin"
BROWSER="chrome"
COOKIE_FILE=""
DRY_RUN=0
FLAT=0
ARCHIVE=""

usage() {
  cat <<'EOF'
download-douyin.sh — batch-download Douyin videos with yt-dlp.

Normalises a list of Douyin video references to the only URL shape yt-dlp's
Douyin extractor accepts (https://www.douyin.com/video/<id>), then downloads
them with throttling and a resumable archive.

Accepted input lines (mixed freely; blank lines and #-comments ignored):
  https://www.douyin.com/video/7118726305914326302
  https://www.douyin.com/user/MS4wLjABAAAA...?modal_id=7118726305914326302
  7118726305914326302

This is the general-purpose layer: a list goes in, files come out. Folder and
cursor policy lives in download.sh, which calls this.

Usage: download-douyin.sh -i urls.txt [-o outdir] [--flat] [-n]

Options:
  -i, --input FILE      URL/ID list (default: urls.txt)
  -o, --output DIR      Download directory (default: ~/Downloads/douyin)
      --flat            Write straight into -o, with no %(uploader)s subdir.
                        Use when the caller already owns the folder layout.
      --archive FILE    Download archive path (default: <outdir>/.archive.txt)
  -b, --browser NAME    Browser to read cookies from (default: chrome)
                        chrome | firefox | safari | edge | brave
      --cookies FILE    Use a cookies.txt file instead of a browser
  -n, --dry-run         Print the yt-dlp command without running it
  -h, --help            Show this help

Cookies are required: Douyin's API rejects anonymous requests. Either point
--cookies at an exported file, or visit douyin.com in the browser named by -b.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -i | --input)   INPUT="$2"; shift 2 ;;
    -o | --output)  OUTDIR="$2"; shift 2 ;;
    -b | --browser) BROWSER="$2"; shift 2 ;;
    --cookies)      COOKIE_FILE="$2"; shift 2 ;;
    --flat)         FLAT=1; shift ;;
    --archive)      ARCHIVE="$2"; shift 2 ;;
    -n | --dry-run) DRY_RUN=1; shift ;;
    -h | --help)    usage; exit 0 ;;
    *) echo "error: unknown option '$1' (try --help)" >&2; exit 2 ;;
  esac
done

[[ -n "$ARCHIVE" ]] || ARCHIVE="${OUTDIR}/.archive.txt"

NORMALISED=""
cleanup() { rm -f ${NORMALISED:+"$NORMALISED"}; }
trap cleanup EXIT

if ! command -v yt-dlp >/dev/null 2>&1; then
  echo "error: yt-dlp not found. Install it with: brew install yt-dlp" >&2
  exit 1
fi

if [[ ! -f "$INPUT" ]]; then
  echo "error: input file '$INPUT' not found." >&2
  echo "Generate one with collect-douyin-ids.mjs, or use download.sh." >&2
  exit 1
fi

# Normalise every line to a canonical /video/<id> URL, dropping duplicates but
# keeping the original order. yt-dlp only matches this one URL shape.
NORMALISED="$(mktemp -t douyin-urls)"

declare -a SEEN=()
skipped=0
while IFS= read -r line || [[ -n "$line" ]]; do
  line="${line#"${line%%[![:space:]]*}"}" # ltrim
  line="${line%"${line##*[![:space:]]}"}" # rtrim
  [[ -z "$line" || "$line" == \#* ]] && continue

  if [[ "$line" =~ modal_id=([0-9]+) ]]; then
    id="${BASH_REMATCH[1]}"
  elif [[ "$line" =~ /video/([0-9]+) ]]; then
    id="${BASH_REMATCH[1]}"
  elif [[ "$line" =~ ^([0-9]+)$ ]]; then
    id="${BASH_REMATCH[1]}"
  else
    echo "warning: skipping unrecognised line: $line" >&2
    skipped=$((skipped + 1))
    continue
  fi

  duplicate=0
  for s in ${SEEN[@]+"${SEEN[@]}"}; do
    [[ "$s" == "$id" ]] && { duplicate=1; break; }
  done
  [[ "$duplicate" == 1 ]] && continue

  SEEN+=("$id")
  echo "https://www.douyin.com/video/${id}" >>"$NORMALISED"
done <"$INPUT"

count="${#SEEN[@]}"
if [[ "$count" -eq 0 ]]; then
  echo "error: no usable video IDs in '$INPUT'." >&2
  exit 1
fi

echo "Found ${count} unique video(s) in ${INPUT}$( ((skipped)) && echo " (${skipped} line(s) skipped)")"

if [[ -n "$COOKIE_FILE" ]]; then
  if [[ ! -f "$COOKIE_FILE" ]]; then
    echo "error: cookie file '$COOKIE_FILE' not found." >&2
    exit 1
  fi
  COOKIE_ARGS=(--cookies "$COOKIE_FILE")
else
  COOKIE_ARGS=(--cookies-from-browser "$BROWSER")
fi

# --sleep-*: Douyin rate-limits hard; an unthrottled batch starts failing
#   partway through and can get the session challenged.
# --download-archive: makes re-runs resume instead of redownloading.
# %(id)s in the template: titles collide and are sometimes empty.
if [[ "$FLAT" == 1 ]]; then
  TEMPLATE="${OUTDIR}/%(upload_date)s - %(title).80s [%(id)s].%(ext)s"
else
  TEMPLATE="${OUTDIR}/%(uploader)s/%(upload_date)s - %(title).80s [%(id)s].%(ext)s"
fi

CMD=(
  yt-dlp
  "${COOKIE_ARGS[@]}"
  -a "$NORMALISED"
  --download-archive "$ARCHIVE"
  --sleep-requests 2
  --sleep-interval 3
  --max-sleep-interval 8
  --retries 3
  --ignore-errors
  --no-overwrites
  --embed-metadata
  -o "$TEMPLATE"
)

if [[ "$DRY_RUN" == 1 ]]; then
  printf 'Would run:\n'
  printf '  %q' "${CMD[@]}"
  printf '\n\nNormalised URLs:\n'
  cat "$NORMALISED"
  exit 0
fi

mkdir -p "$OUTDIR" "$(dirname "$ARCHIVE")"
echo "Downloading to ${OUTDIR}"
# Not fatal: --ignore-errors makes yt-dlp exit non-zero if any single video
# failed, which is expected in a long batch. The archive records what landed.
if ! "${CMD[@]}"; then
  echo >&2
  echo "warning: yt-dlp exited non-zero — some videos failed." >&2
  echo "Re-run the same command to retry only the ones still missing." >&2
  exit 1
fi

echo "Done. Completed IDs recorded in ${ARCHIVE}"
