#!/usr/bin/env bash
#
# archive.sh — entry point for the douyin-archiver skill.
#
# Owns folder, plan and metadata policy; delegates the actual fetching to
# download-douyin.sh, the ID collection to collect-douyin-ids.mjs, and the
# diff-and-confirm step to plan.mjs. This script archives; download-douyin.sh
# downloads — the filenames say which layer you are in.
#
#   archive.sh <profile-url> --plan     collect, report what would be fetched
#   archive.sh <profile-url> --go       fetch what that plan listed
#   archive.sh <profile-url> --yes      both, without stopping to confirm
#   archive.sh <post-url>               one post, straight away
#
# An account is never archived without an explicit --go or --yes: the list is
# collected first and reported, so the account, the folder and the number of
# posts are all known before anything is fetched. A bare profile URL therefore
# behaves as --plan.
#
# Runs are resumable: the post folders under posts/ are the sole record of what
# has landed, so a re-run fetches only what is missing — and deleting a post's
# folder is how you ask for it again.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# The skill directory is pure source and may live anywhere — a plugin dir, a
# read-only checkout — so nothing mutable hangs off it. Session state is
# user-level (log in once, not once per project); archives are project-level
# (an archive belongs beside the work it is part of).
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/douyin-archiver"
PROFILE_DIR="${STATE_DIR}/profile"
COOKIE_FILE="${STATE_DIR}/cookies.txt"

ALIAS=""
UNALIAS=""
URL=""
ARCHIVES_ARG=""
MODE=""

# --yes is the user's own say-so, and the skill appends --plan or --go after
# whatever flags the user typed. Last-wins would therefore quietly overrule a
# user who pre-authorised the run, so --yes outranks both rather than being
# overwritten by whichever came last.
set_mode() {
  [[ "$MODE" == "yes" ]] || MODE="$1"
}

usage() {
  cat <<'EOF'
archive.sh — archive a Douyin account's posts, or download a single post.

Usage: archive.sh <url> [--archives DIR] [--alias NAME] [--plan|--go|--yes]

  <url>   https://www.douyin.com/user/MS4w...   every post from the account
          https://www.douyin.com/video/711...   one post

Modes (profile URLs):
      --plan            Collect the post list, report what would be fetched,
                        and stop. The default: nothing is fetched until a
                        plan has been made and approved.
      --go              Fetch the posts the last --plan listed. Needs a
                        plan made within the last 24h for this account and
                        this archives root.
      --yes, -y         Plan and fetch in one run, without stopping.

Options:
      --archives DIR    Root directory the archives live in. The account
                        folder is DIR/douyin/<alias>, or DIR/douyin/<sec_uid>
                        for an account that has no alias.
                        (default: <git root, else cwd>/archives — required
                        when run from inside the skill directory)
      --alias NAME      Name this account's folder NAME instead of its sec_uid,
                        so the archive is readable to a person. An existing
                        folder is renamed on the next --go; a new one is created
                        with this name. Recorded in archiver.json against the
                        sec_uid, which is what finds the folder again after.
      --unalias         Put this account's folder back under its sec_uid.
      --profile DIR     Playwright session profile
                        (default: ${XDG_STATE_HOME:-~/.local/state}/douyin-archiver/profile)
  -h, --help            Show this help

Each post lands in the account folder under posts/<date>_<id>/, holding a
post.json — permalink, timestamp, caption and the media it carries — plus that
media as 1.mp4. post.json is written before the download, and a post counts as
landed when every file it lists is there; delete one and it is fetched again.
Beside posts/ sit account.json (whose account this folder is) and sync.json
(the list awaiting approval between --plan and --go, plus the last run).
<archives>/archiver.json records the schema and maps each sec_uid to its alias.

Image posts (图文) are counted and reported, but not yet downloaded:
https://github.com/luojiahai/skills/issues/39
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --alias)     ALIAS="$2"; shift 2 ;;
    --unalias)   UNALIAS=1; shift ;;
    --archives)  ARCHIVES_ARG="$2"; shift 2 ;;
    --profile)   PROFILE_DIR="$2"; shift 2 ;;
    --plan)      set_mode plan; shift ;;
    --go)        set_mode go; shift ;;
    -y | --yes)  MODE="yes"; shift ;;
    -h | --help) usage; exit 0 ;;
    # Named rather than left to the catch-all below. The old flag is the one
    # thing likely to still be sitting in a shell history, and "unknown option"
    # would be true while sending the user to --help to find out why.
    --downloads)
      echo "error: --downloads was renamed to --archives (and the default root is now archives/)" >&2
      echo "  the old root is not read: rename downloads/ to archives/, or pass --archives DIR" >&2
      exit 2 ;;
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

if [[ -n "$ALIAS" && -n "$UNALIAS" ]]; then
  echo "error: --alias and --unalias ask for opposite things. Pass one or the other." >&2
  exit 2
fi

# Where archives live is decided in one place, paths.mjs, rather than being
# recomputed here: a root that disagrees with the one the Node scripts use
# would name a different account folder and silently re-download everything. It
# also expands ~ and makes the path absolute, since the agent passes the user's
# flag through as typed and a quoted ~/data never reaches the shell's expansion.
ARCHIVES="$(node "${SCRIPT_DIR}/account.mjs" root --archives "$ARCHIVES_ARG")" || exit 2

# Before the session, before the first request, before anything is written: an
# archive this build cannot read must cost nothing to discover. With no
# old-layout detection behind it, this refusal is the only thing standing
# between a version mismatch and a silent full re-download.
node "${SCRIPT_DIR}/archiver.mjs" check --archives "$ARCHIVES" || exit 2

# Stamping is deliberately not part of that check: it happens once a folder has
# been resolved, so a mistyped --archives does not leave a stamped empty
# directory behind on a run that then goes nowhere.
stamp_root() {
  node "${SCRIPT_DIR}/archiver.mjs" stamp --archives "$ARCHIVES"
}

# The command that makes a plan, quoted back to the user in every message that
# needs one to exist.
PLAN_HINT="${SCRIPT_DIR}/archive.sh '${URL}'${ARCHIVES_ARG:+ --archives '${ARCHIVES_ARG}'}${ALIAS:+ --alias '${ALIAS}'} --plan"

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

# The subdirectory holding one folder per post. Spelled here as well as in
# landed.mjs's POSTS_DIR — change it in one place and change it in the other.
POSTS_SUBDIR="posts"

TMP_COLLECTED=""
TMP_META=""
TMP_PENDING=""
TMP_LOG=""
cleanup() {
  rm -f ${TMP_COLLECTED:+"$TMP_COLLECTED"} ${TMP_META:+"$TMP_META"} \
    ${TMP_PENDING:+"$TMP_PENDING"} ${TMP_LOG:+"$TMP_LOG"}
}
trap cleanup EXIT

# Reads one field out of a JSON file. The path goes through argv rather than
# into the script source, so a folder name with a quote in it cannot break it.
json_field() {
  node -e 'let o={};try{o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))}catch{}
           const v=o[process.argv[2]];console.log(v===undefined||v===null?"":v)' "$1" "$2"
}

# Counting what is on disk and printing a block both belong to plan.mjs, so
# that what a run reports is rendered by the same code that rendered what the
# user approved — and counted by the same rule.
plan_mjs() {
  node "${SCRIPT_DIR}/plan.mjs" "$@"
}

# Cookies are cached and reused; they are only re-minted when yt-dlp actually
# rejects them, so the common path costs no browser launch.
mint_cookies() {
  node "${SCRIPT_DIR}/export-cookies.mjs" -o "$COOKIE_FILE" --profile "$PROFILE_DIR"
}

# Runs download-douyin.sh, re-minting cookies and retrying once if the session
# was the problem. Returns download-douyin.sh's exit status.
download_list() {
  local list="$1" folder="$2" status
  # A global rather than a local, so the EXIT trap can clean it up when a
  # 30-minute run is interrupted partway.
  TMP_LOG="$(mktemp -t douyin-dl-log)"

  [[ -f "$COOKIE_FILE" ]] || mint_cookies

  set +e
  "${SCRIPT_DIR}/download-douyin.sh" -i "$list" -o "${folder}/${POSTS_SUBDIR}" \
    --cookies "$COOKIE_FILE" 2>&1 | tee "$TMP_LOG"
  status="${PIPESTATUS[0]}"
  set -e

  if [[ "$status" != 0 ]] && grep -q "Fresh cookies" "$TMP_LOG"; then
    echo
    echo "[douyin] session cookies rejected — re-minting and retrying once…"
    mint_cookies
    set +e
    "${SCRIPT_DIR}/download-douyin.sh" -i "$list" -o "${folder}/${POSTS_SUBDIR}" \
      --cookies "$COOKIE_FILE" 2>&1 | tee "$TMP_LOG"
    status="${PIPESTATUS[0]}"
    set -e
  fi

  rm -f "$TMP_LOG"
  TMP_LOG=""
  return "$status"
}

resolve_folder() {
  node "${SCRIPT_DIR}/account.mjs" resolve --archives "$ARCHIVES" "$@"
}

# Refuses an unusable or already-taken alias before anything is collected,
# written or downloaded — it needs the archives root and nothing else, so a typo
# costs no browser and no scroll.
#
# The sec_uid may be empty — a single post that named none, or a profile URL
# that carried none. The 抖音号 and the URL go with it so the check can still
# work out whose account this is: without them it would read the account's own
# alias as a collision with itself. The authoritative check is inside `alias`,
# once the sec_uid is in hand.
check_alias() {
  [[ -n "$ALIAS" ]] || return 0
  node "${SCRIPT_DIR}/account.mjs" check-alias --archives "$ARCHIVES" \
    --sec-uid "${1:-}" --douyin-id "${2:-}" --url "$URL" --alias "$ALIAS"
}

# Moves the account's folder where --alias or --unalias says it goes, and prints
# where that now is. Called only on the paths that download: a --plan that
# silently reorganised the archive would be a preview that lied, and a rename
# between the two invalidates nothing, because a plan records the archives root
# and the account rather than the folder.
apply_alias() {
  local sec_uid="$1" folder="$2"
  if [[ -n "$UNALIAS" ]]; then
    node "${SCRIPT_DIR}/account.mjs" unalias --archives "$ARCHIVES" --sec-uid "$sec_uid"
  elif [[ -n "$ALIAS" ]]; then
    node "${SCRIPT_DIR}/account.mjs" alias --archives "$ARCHIVES" \
      --sec-uid "$sec_uid" --alias "$ALIAS"
  else
    printf '%s\n' "$folder"
  fi
}

# ---- single post -----------------------------------------------------------
if [[ "$URL" =~ /video/([0-9]+) ]]; then
  POST_ID="${BASH_REMATCH[1]}"

  [[ -f "$COOKIE_FILE" ]] || mint_cookies

  # yt-dlp's `channel_id` is the sec_uid, which now *is* the folder name, and
  # `uploader` is the 抖音号, which is what a human reads. Both come from one
  # metadata request, so a single post is still filed correctly without opening
  # a browser.
  #
  # `|| true` is load-bearing: under `set -e -o pipefail` a yt-dlp that exits
  # non-zero would take the whole script down here, with its stderr already sent
  # to /dev/null — a silent exit 1, and the retry and diagnosis below would
  # never be reached.
  identity_of() {
    yt-dlp --cookies "$COOKIE_FILE" --print "%(channel_id|)s	%(uploader|)s" \
      --skip-download "https://www.douyin.com/video/$1" 2>/dev/null | head -1 || true
  }

  IDENTITY="$(identity_of "$POST_ID")"

  if [[ -z "${IDENTITY//[[:space:]]/}" ]]; then
    echo "[douyin] no metadata — re-minting cookies and retrying once…"
    mint_cookies
    IDENTITY="$(identity_of "$POST_ID")"
  fi

  SEC_UID="${IDENTITY%%$'\t'*}"
  DOUYIN_ID="${IDENTITY#*$'\t'}"

  if [[ -z "${IDENTITY//[[:space:]]/}" ]]; then
    echo "error: could not read metadata for post ${POST_ID}." >&2
    echo "The post may be private, deleted or region-locked; failing that, the" >&2
    echo "session is dead — re-establish it with:" >&2
    echo "  node ${SCRIPT_DIR}/collect-douyin-ids.mjs --login <profile-url>" >&2
    exit 1
  fi

  check_alias "$SEC_UID" "$DOUYIN_ID"

  # With a sec_uid the folder is known outright, and an alias may name it — the
  # sec_uid is what the alias is recorded against, so everything that makes an
  # alias safe is present. Without one there is no name to invent — the 抖音号 is
  # the mutable identifier this layout stopped filing by, and an alias with no id
  # behind it has nothing to record — so an alias may only *find* a folder here,
  # and the only hope is one some earlier run already made for this account.
  if [[ -n "$SEC_UID" ]]; then
    FOLDER="$(resolve_folder --sec-uid "$SEC_UID" --alias "$ALIAS")"
  else
    FOLDER_STATUS=0
    FOLDER="$(resolve_folder --douyin-id "$DOUYIN_ID" --alias "$ALIAS")" || FOLDER_STATUS=$?
    if [[ "$FOLDER_STATUS" != 0 ]]; then
      echo "error: this post did not name its account's sec_uid, and no folder here" >&2
      echo "belongs to 抖音号 ${DOUYIN_ID} yet — so there is nowhere to file it." >&2
      echo "Archive the profile once first:" >&2
      echo "  ${SCRIPT_DIR}/archive.sh 'https://www.douyin.com/user/<sec_uid>' --plan" >&2
      exit 1
    fi
  fi

  # A single post downloads rather than plans, so the move happens now — except
  # under --plan, which only reports. No sec_uid means no move: there is no id to
  # record the alias against.
  if [[ "$MODE" != "plan" && -n "$SEC_UID" ]]; then
    FOLDER="$(apply_alias "$SEC_UID" "$FOLDER")"
  fi

  # Identity, written as soon as the folder is known and before anything is
  # fetched: which account this folder belongs to, never how much of it has
  # been downloaded. That is what lets a later full run find this folder
  # instead of starting a second one for the same account. No --url: the URL
  # here names a post, and the recorded one is the profile's.
  stamp_root
  node "${SCRIPT_DIR}/account.mjs" write --folder "$FOLDER" --archives "$ARCHIVES" \
    --sec-uid "$SEC_UID" --douyin-id "$DOUYIN_ID"

  # A single post is already as specific as an instruction gets, so it is not
  # planned or confirmed — but --plan still answers where it would land.
  if [[ "$MODE" == "plan" ]]; then
    plan_mjs post --folder "$FOLDER" --douyin-id "$DOUYIN_ID" --post "$POST_ID"
    exit 0
  fi

  echo "[douyin] single post ${POST_ID}"
  mkdir -p "${FOLDER}/${POSTS_SUBDIR}"

  TMP_PENDING="$(mktemp -t douyin-single)"
  echo "https://www.douyin.com/video/${POST_ID}" >"$TMP_PENDING"

  SINGLE_STATUS=0
  download_list "$TMP_PENDING" "$FOLDER" || SINGLE_STATUS=$?

  # The same block every other run ends with, read back off disk: on success it
  # shows the post downloaded, after a failure still to fetch.
  echo
  plan_mjs post --folder "$FOLDER" --douyin-id "$DOUYIN_ID" --post "$POST_ID"
  if [[ "$SINGLE_STATUS" != 0 ]]; then
    echo "warning: the download failed — re-run the same command to retry" >&2
  fi
  exit "$SINGLE_STATUS"
fi

# ---- whole account ---------------------------------------------------------
if [[ ! "$URL" =~ douyin\.com/user/ ]]; then
  echo "error: not a Douyin profile or post URL: $URL" >&2
  echo "Expected .../user/MS4wLjABAAAA... or .../video/<id>" >&2
  if [[ "$URL" =~ v\.douyin\.com ]]; then
    echo "v.douyin.com share links have to be expanded first: open the link in" >&2
    echo "a browser and copy the douyin.com URL it lands on." >&2
  fi
  exit 2
fi

# The sec_uid is in the URL, so --go can find the account's folder without
# opening a browser at all.
SEC_UID=""
if [[ "$URL" =~ /user/([^/?#]+) ]]; then
  SEC_UID="${BASH_REMATCH[1]}"
fi

# Fetches the plan sitting in $1, which --plan wrote and the user approved.
#
# Call it plainly, never as `run_plan … || status=$?`: bash switches errexit
# off for the whole body of a function invoked in a || list, and with it off a
# *refused* plan fell straight through to the download — "0 post(s)", a
# metadata write that could merge a foreign plan's identity, and a summary
# telling the user to re-run the very --go that just failed.
run_plan() {
  local folder="$1" before after pending status=0

  TMP_PENDING="$(mktemp -t douyin-pending)"
  # The one refusal errexit must never be trusted with: nothing below this
  # line may run on a plan that was not approved as-is.
  plan_mjs load --folder "$folder" --archives "$ARCHIVES" \
    --sec-uid "$SEC_UID" --out "$TMP_PENDING" --remedy "$PLAN_HINT" || return $?

  pending="$(wc -l <"$TMP_PENDING" | tr -d ' ')"
  before="$(plan_mjs count --folder "$folder")"

  # `load` re-checks the plan against disk, so a --go re-run after everything
  # landed has nothing left. yt-dlp given an empty list is an error, and the
  # run has in fact succeeded — report it and clear the plan below.
  if [[ "$pending" == 0 ]]; then
    echo "[douyin] every post in the plan is already downloaded"
  else
    mkdir -p "${folder}/${POSTS_SUBDIR}"
    echo "[douyin] downloading ${pending} post(s) to ${folder}/${POSTS_SUBDIR}…"
    download_list "$TMP_PENDING" "$folder" || status=$?
  fi

  # Only the profile URL: the identity was written by `build` before anything
  # was fetched, and by an earlier run's `build` on the --go path. It also
  # re-derives the alias from the folder, which is what settles the records after
  # a move that happened between then and now.
  node "${SCRIPT_DIR}/account.mjs" write --folder "$folder" --archives "$ARCHIVES" --url "$URL"

  after="$(plan_mjs count --folder "$folder")"

  echo
  plan_mjs summary --folder "$folder" --archives "$ARCHIVES" \
    --before "$before" --after "$after" --exit-status "$status"

  # Kept after a partial run, so a retry re-fetches only what is missing
  # without paying for another collection; removed once it has all landed.
  # After the summary, which reads the plan for the account's name and counts.
  if [[ "$status" == 0 ]]; then
    plan_mjs clear --folder "$folder"
  fi

  return "$status"
}

# ---- --go: fetch an approved plan, no browser involved -------------------
if [[ "$MODE" == "go" ]]; then
  check_alias "$SEC_UID"

  RESOLVE_STATUS=0
  FOLDER="$(resolve_folder --sec-uid "$SEC_UID" --require-match)" || RESOLVE_STATUS=$?

  # 3 is "no folder here for this account", which has a remedy. Anything else
  # is a real failure that has already said what it was, and swallowing it as
  # "no plan" would send the user off to fix the wrong thing.
  if [[ "$RESOLVE_STATUS" == 3 ]]; then
    echo "error: no folder for this account under ${ARCHIVES}, so there is no plan to run." >&2
    echo "  run: ${PLAN_HINT}" >&2
    exit 2
  elif [[ "$RESOLVE_STATUS" != 0 ]]; then
    exit "$RESOLVE_STATUS"
  fi

  # The move happens before the download, so what is fetched goes straight into
  # its final home.
  FOLDER="$(apply_alias "$SEC_UID" "$FOLDER")"

  # Plain call: a failure exits the script with run_plan's status via errexit.
  run_plan "$FOLDER"
  exit 0
fi

# ---- --plan / --yes: collect, diff, report ---------------------------------
# Before the browser opens: the sec_uid is in a profile URL, so an alias that
# cannot be used is refused without collecting anything at all.
check_alias "$SEC_UID"

TMP_COLLECTED="$(mktemp -t douyin-urls)"
TMP_META="$(mktemp -t douyin-meta)"

echo "[douyin] collecting post IDs…"
node "${SCRIPT_DIR}/collect-douyin-ids.mjs" "$URL" \
  -o "$TMP_COLLECTED" --meta "$TMP_META" --headless --profile "$PROFILE_DIR"

DOUYIN_ID="$(json_field "$TMP_META" douyin_id)"
[[ -n "$SEC_UID" ]] || SEC_UID="$(json_field "$TMP_META" sec_uid)"

if [[ -z "$DOUYIN_ID" ]]; then
  echo "error: could not read 抖音号 from the profile page." >&2
  exit 1
fi

if [[ -z "$SEC_UID" ]]; then
  echo "error: could not read the account's sec_uid from the profile page or URL." >&2
  echo "It is the MS4w... part of https://www.douyin.com/user/MS4w..." >&2
  exit 1
fi

# Asked again now the sec_uid is certain — the URL may not have carried one, and
# the check above then ran without knowing whose account this is.
check_alias "$SEC_UID" "$DOUYIN_ID"

FOLDER="$(resolve_folder --sec-uid "$SEC_UID" --alias "$ALIAS")"

stamp_root

echo
node "${SCRIPT_DIR}/plan.mjs" build --meta "$TMP_META" --urls "$TMP_COLLECTED" \
  --folder "$FOLDER" --archives "$ARCHIVES" --url "$URL" \
  --alias "$ALIAS" ${UNALIAS:+--unalias}

# Nothing pending means nothing to fetch, so the scan was the whole run and
# there is nothing to confirm. build has already recorded the account's
# identity. The plan now lives inside sync.json, so its presence is a question
# for plan.mjs rather than for a path test.
if [[ "$(plan_mjs pending --folder "$FOLDER")" == 0 ]]; then
  exit 0
fi

if [[ "$MODE" != "yes" ]]; then
  echo
  echo "Nothing has been downloaded. To fetch the posts above:"
  echo "  ${PLAN_HINT% --plan} --go"
  exit 0
fi

echo
# --yes is the one path that plans and fetches in a breath, so the move it just
# reported happens here, before the download.
FOLDER="$(apply_alias "$SEC_UID" "$FOLDER")"

# Plain call: a failure exits the script with run_plan's status via errexit.
run_plan "$FOLDER"
exit 0
