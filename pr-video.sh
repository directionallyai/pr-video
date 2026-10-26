#!/usr/bin/env bash
# Makes a code-tour review video of a GitHub pull request.
#
#   ./pr-video.sh <pr-url> [output.mp4]
#
# Checks the PR out into a work directory, has `claude -p` review it and write a tour spec
# (checking its own work against rendered stills), then renders the video with Remotion.
#
# Environment:
#   PR_VIDEO_MODEL   model for claude -p (default: claude's own default)
#   PR_VIDEO_PROBE   1 lets claude curl live URLs to check whether the change is deployed
#   PR_VIDEO_WORK    work directory to use instead of a fresh temp dir (kept afterwards)
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: $0 <https://github.com/OWNER/REPO/pull/N> [output.mp4]" >&2
  exit 2
fi
url="$1"
if [[ ! "$url" =~ ^https://github\.com/([^/]+)/([^/]+)/pull/([0-9]+) ]]; then
  echo "Not a GitHub pull request URL: $url" >&2
  exit 2
fi
owner="${BASH_REMATCH[1]}"
repo="${BASH_REMATCH[2]}"
number="${BASH_REMATCH[3]}"
out="${2:-out/$repo-$number.mp4}"
mkdir -p "$(dirname "$out")"
out="$(cd "$(dirname "$out")" && pwd)/$(basename "$out")"

for cmd in gh git node npm claude; do
  command -v "$cmd" >/dev/null || { echo "Missing dependency: $cmd" >&2; exit 1; }
done

tool="$(cd "$(dirname "$0")" && pwd)"
[ -d "$tool/node_modules" ] || (cd "$tool" && npm ci)

work="${PR_VIDEO_WORK:-$(mktemp -d "${TMPDIR:-/tmp}/pr-video.XXXXXX")}"
mkdir -p "$work"
work="$(cd "$work" && pwd -P)"
echo "work dir: $work"

# Check out the PR and pin the diff: a merged PR is its merge commit against the first
# parent; an open one is its head against the merge base with the target branch.
[ -d "$work/repo/.git" ] || gh repo clone "$owner/$repo" "$work/repo" -- -q
info="$(gh pr view "$number" -R "$owner/$repo" --json state,mergeCommit,headRefOid,baseRefName)"
field() { node -e 'const o=JSON.parse(process.argv[1]); const v=process.argv[2].split(".").reduce((a,k)=>a?.[k],o); process.stdout.write(v ?? "")' "$info" "$1"; }
git -C "$work/repo" fetch -q origin "pull/$number/head" "$(field baseRefName)"
if [ "$(field state)" = MERGED ] && [ -n "$(field mergeCommit.oid)" ]; then
  head="$(field mergeCommit.oid)"
  base="$(git -C "$work/repo" rev-parse "$head^1")"
else
  head="$(field headRefOid)"
  base="$(git -C "$work/repo" merge-base "origin/$(field baseRefName)" "$head")"
fi
echo "diff: $base..$head"

[ -f "$work/spec.json" ] ||
  printf '{\n  "repo": "repo",\n  "base": "%s",\n  "head": "%s",\n  "title": {},\n  "stops": [],\n  "verdict": {}\n}\n' \
    "$base" "$head" >"$work/spec.json"

allowed=(
  "Read" "Glob" "Grep"
  "Edit(/$work/spec.json)"
  "Bash(gh pr view:*)" "Bash(gh pr diff:*)" "Bash(gh pr checks:*)"
  "Bash(git -C $work/repo:*)"
  "Bash(node $tool/build-tour.mjs:*)" "Bash(node $tool/render.mjs stills:*)"
)
probe_note="You cannot fetch live URLs in this run, so do not claim anything about what is deployed."
if [ "${PR_VIDEO_PROBE:-0}" = 1 ]; then
  allowed+=("Bash(curl:*)")
  probe_note="You may use curl to check whether the change is live on its deployed hosts and behaves as claimed. Only request URLs belonging to this project."
fi

prompt="$(<"$tool/prompt.md")"
prompt="${prompt//"{{PR_URL}}"/$url}"
prompt="${prompt//"{{WORK}}"/$work}"
prompt="${prompt//"{{TOOL}}"/$tool}"
prompt="${prompt//"{{BASE}}"/$base}"
prompt="${prompt//"{{HEAD}}"/$head}"
prompt="${prompt//"{{PROBE_NOTE}}"/$probe_note}"

model_args=()
[ -n "${PR_VIDEO_MODEL:-}" ] && model_args=(--model "$PR_VIDEO_MODEL")

(cd "$work" && claude -p "$prompt" "${model_args[@]}" --add-dir "$tool" --allowedTools "${allowed[@]}") |
  tee "$work/review.txt"

node "$tool/build-tour.mjs" "$work/spec.json" "$work/tour.json"
node "$tool/render.mjs" video "$work/tour.json" "$out"
echo "review: $work/review.txt"
echo "video:  $out"
