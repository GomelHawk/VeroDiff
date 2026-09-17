#!/usr/bin/env bash
# Snapshot the working tree into a shadow repository outside the project.
# Invoked by the UserPromptSubmit (pre) and Stop (post) hooks.
# Never writes a single object into the project's own .git.
set -uo pipefail

KIND="${1:-snap}"
STDIN_JSON="$(cat 2>/dev/null || true)"

cd "${CLAUDE_PROJECT_DIR:-$PWD}" 2>/dev/null || exit 0
TOP="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
cd "$TOP" || exit 0

# --- where snapshots live --------------------------------------------------
CACHE="${VERODIFF_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/verodiff}"
if command -v md5sum >/dev/null 2>&1;  then key="$(printf '%s' "$TOP" | md5sum | cut -c1-12)"
elif command -v md5 >/dev/null 2>&1;   then key="$(printf '%s' "$TOP" | md5 -q | cut -c1-12)"
else key="$(printf '%s' "$TOP" | cksum | cut -d' ' -f1)"; fi
SHADOW="$CACHE/$(basename "$TOP")-$key.git"
[ -d "$SHADOW" ] || git init -q --bare "$SHADOW" 2>/dev/null || exit 0
printf '%s\n' "$TOP" > "$SHADOW/project-path" 2>/dev/null

export GIT_DIR="$SHADOW" GIT_WORK_TREE="$TOP"

# --- prompt text and session id, for per-session isolation -----------------
label=""; sid=""
if [ -n "$STDIN_JSON" ]; then
  if command -v jq >/dev/null 2>&1; then
    label="$(printf '%s' "$STDIN_JSON" | jq -r '.prompt // ""' 2>/dev/null)"
    sid="$(printf '%s' "$STDIN_JSON" | jq -r '.session_id // ""' 2>/dev/null)"
  elif command -v python3 >/dev/null 2>&1; then
    label="$(printf '%s' "$STDIN_JSON" | python3 -c \
      'import sys,json;print(json.load(sys.stdin).get("prompt",""))' 2>/dev/null)"
    sid="$(printf '%s' "$STDIN_JSON" | python3 -c \
      'import sys,json;print(json.load(sys.stdin).get("session_id",""))' 2>/dev/null)"
  fi
fi
sid="$(printf '%s' "$sid" | tr -cd 'A-Za-z0-9._-' | cut -c1-64)"
[ -n "$sid" ] || sid="default"

label="$(printf '%s' "$label" | tr '\n\r\t' '   ' | cut -c1-100)"
LABEL_FILE="$SHADOW/label-$sid"
if [ -n "$label" ]; then printf '%s' "$label" > "$LABEL_FILE" 2>/dev/null
else label="$(cat "$LABEL_FILE" 2>/dev/null || true)"; fi
[ -n "$label" ] || label="(no prompt)"

# --- take the snapshot -----------------------------------------------------
REF="refs/verodiff/session/$sid"
export GIT_INDEX_FILE="$SHADOW/index-$sid"
git add -A -- . >/dev/null 2>&1
tree="$(git write-tree 2>/dev/null)" || exit 0
[ -n "$tree" ] || exit 0
unset GIT_INDEX_FILE GIT_WORK_TREE

parent="$(git rev-parse -q --verify "$REF" 2>/dev/null || true)"
if [ -n "$parent" ] && [ "$(git rev-parse -q --verify "$parent^{tree}")" = "$tree" ]; then
  exit 0   # nothing changed during this turn
fi

branch="$(git --git-dir="$TOP/.git" symbolic-ref --quiet --short HEAD 2>/dev/null || echo detached)"
msg="[$KIND] $label"$'\n\n'"session: $sid"$'\n'"branch: $branch"$'\n'"at: $(date '+%Y-%m-%d %H:%M:%S')"

export GIT_AUTHOR_NAME="verodiff-snapshot" GIT_AUTHOR_EMAIL="claude@local"
export GIT_COMMITTER_NAME="verodiff-snapshot" GIT_COMMITTER_EMAIL="claude@local"

if [ -n "$parent" ]; then
  commit="$(printf '%s' "$msg" | git commit-tree "$tree" -p "$parent" 2>/dev/null)"
else
  commit="$(printf '%s' "$msg" | git commit-tree "$tree" 2>/dev/null)"
fi
[ -n "$commit" ] || exit 0
git update-ref "$REF" "$commit" >/dev/null 2>&1
exit 0
