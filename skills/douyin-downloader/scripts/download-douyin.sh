#!/usr/bin/env bash
#
# download-douyin.sh — batch-download Douyin posts with yt-dlp.
#
# Takes a file of Douyin post references, normalises them to the only URL
# shape yt-dlp's Douyin extractor accepts (https://www.douyin.com/video/<id>),
# and downloads each into a folder of its own with throttling.
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

usage() {
  cat <<'EOF'
download-douyin.sh — batch-download Douyin posts with yt-dlp.

Normalises a list of Douyin post references to the only URL shape yt-dlp's
Douyin extractor accepts (https://www.douyin.com/video/<id>), then downloads
each into a folder of its own under -o, with throttling.

Accepted input lines (mixed freely; blank lines and #-comments ignored):
  https://www.douyin.com/video/7118726305914326302
  https://www.douyin.com/user/MS4wLjABAAAA...?modal_id=7118726305914326302
  7118726305914326302

This is the general-purpose layer: a list goes in, files come out. Folder and
cursor policy lives in download.sh, which calls this.

Each post becomes <outdir>/<YYYY-MM-DD|undated>_<id>/ holding its media as
1.mp4, 2.jpg… and a text.txt with the permalink, timestamp and caption. There
is no archive file: a post counts as downloaded when its folder holds media,
so deleting a folder re-downloads it and nothing else has to be kept in step.

Usage: download-douyin.sh -i urls.txt [-o outdir] [-n]

Options:
  -i, --input FILE      URL/ID list (default: urls.txt)
  -o, --output DIR      Download directory (default: ~/Downloads/douyin)
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
    -n | --dry-run) DRY_RUN=1; shift ;;
    -h | --help)    usage; exit 0 ;;
    *) echo "error: unknown option '$1' (try --help)" >&2; exit 2 ;;
  esac
done

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
  echo "error: no usable post IDs in '$INPUT'." >&2
  exit 1
fi

echo "Found ${count} unique post(s) in ${INPUT}$( ((skipped)) && echo " (${skipped} line(s) skipped)")"

if [[ -n "$COOKIE_FILE" ]]; then
  if [[ ! -f "$COOKIE_FILE" ]]; then
    echo "error: cookie file '$COOKIE_FILE' not found." >&2
    exit 1
  fi
  COOKIE_ARGS=(--cookies "$COOKIE_FILE")
else
  COOKIE_ARGS=(--cookies-from-browser "$BROWSER")
fi

# One directory per post. The date sorts a listing as a timeline and the id
# identifies the post; `|undated` is a literal default, because a missing field
# otherwise renders as `NA` and every dateless post would share one folder.
#
# The caption is deliberately not in the path — it lives in text.txt in full,
# rather than truncated into a name that then has to be parsed back out.
POST_DIR="${OUTDIR}/%(upload_date>%Y-%m-%d|undated)s_%(id)s"

# `playlist_index` is unset for a lone video, so the default is what makes it
# 1.mp4; a post that yields several files numbers them by position instead.
MEDIA_TEMPLATE="${POST_DIR}/%(playlist_index|1)s.%(ext)s"

# Real newlines, not \n: yt-dlp writes a backslash-n in a print template
# literally. The trailing field falls back to the title, then to empty, so a
# caption-less post still gets its permalink and timestamp.
#
# `timestamp` rather than the `upload_date` the folder uses: both come from the
# same instant, but only `timestamp` carries the time of day, and x-downloader's
# text.txt records the second. The folder wants a sortable day, the text wants
# the moment — same fact, two precisions, deliberately.
TEXT_TEMPLATE="https://www.douyin.com/video/%(id)s
%(timestamp>%Y-%m-%d %H:%M:%S|undated)s

%(description,title|)s"

# --sleep-*: Douyin rate-limits hard; an unthrottled batch starts failing
#   partway through and can get the session challenged.
# --no-overwrites: what makes re-runs resume. It keys on the resolved path, so
#   deleting a post's folder re-downloads it — unlike --download-archive, which
#   kept claiming a deleted post was done and used to own this job.
# --print-to-file: the default WHEN fires after extraction and before the
#   download, so a post whose media fails still leaves its text on disk. The
#   folder then holds no media, which is exactly how the next run knows to
#   retry it.
CMD=(
  yt-dlp
  "${COOKIE_ARGS[@]}"
  -a "$NORMALISED"
  --sleep-requests 2
  --sleep-interval 3
  --max-sleep-interval 8
  --retries 3
  --ignore-errors
  --no-overwrites
  --embed-metadata
  --print-to-file "$TEXT_TEMPLATE" "${POST_DIR}/text.txt"
  -o "$MEDIA_TEMPLATE"
)

if [[ "$DRY_RUN" == 1 ]]; then
  printf 'Would run:\n'
  printf '  %q' "${CMD[@]}"
  printf '\n\nNormalised URLs:\n'
  cat "$NORMALISED"
  exit 0
fi

mkdir -p "$OUTDIR"

# yt-dlp's --print-to-file appends and has no overwrite mode, so a post fetched
# twice — a retry after a failure, or simply this script run again — would get a
# second copy of its permalink, timestamp and caption in the same file. The
# folder name is not known here (the date arrives with the metadata), so match
# on the id, which is the half of it we do know.
#
# Only the text is removed. A .part file beside it is yt-dlp's resume data for a
# half-downloaded file, and clearing the folder wholesale would throw it away.
shopt -s nullglob
for id in ${SEEN[@]+"${SEEN[@]}"}; do
  for stale in "${OUTDIR}"/*_"${id}"/text.txt; do
    rm -f "$stale"
  done
done
shopt -u nullglob

echo "Downloading to ${OUTDIR}"
# Not fatal: --ignore-errors makes yt-dlp exit non-zero if any single post
# failed, which is expected in a long batch. What landed is on disk, so a
# re-run picks up exactly the posts still missing.
if ! "${CMD[@]}"; then
  echo >&2
  echo "warning: yt-dlp exited non-zero — some posts failed." >&2
  echo "Re-run the same command to retry only the ones still missing." >&2
  exit 1
fi

echo "Done. Each post is a folder under ${OUTDIR}"
