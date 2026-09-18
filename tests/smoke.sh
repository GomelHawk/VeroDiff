#!/usr/bin/env bash
# VeroDiff smoke test. No Claude Code, no network, no credentials - just git and bash,
# so it runs identically on a developer's machine and on a CI runner.
#
#   tests/smoke.sh
#
# It guards the promises the plugin makes to a user. The first one is the important one:
# taking a snapshot must never write an object into the project's own .git.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SNAP="$ROOT/plugins/vero-diff/scripts/snapshot.sh"
VD="$ROOT/plugins/vero-diff/bin/verodiff"

WORK="$(mktemp -d 2>/dev/null || mktemp -d -t verodiff)"
trap 'rm -rf "$WORK"' EXIT
export VERODIFF_DIR="$WORK/cache"

pass=0 fail=0
ok()   { pass=$((pass+1)); printf '  \033[32mok\033[0m    %s\n' "$1"; }
no()   { fail=$((fail+1)); printf '  \033[31mFAIL\033[0m  %s\n' "$1"; [ $# -gt 1 ] && printf '        %s\n' "$2"; }
is()   { if [ "$2" = "$3" ]; then ok "$1"; else no "$1" "expected '$3', got '$2'"; fi; }
has()  { if printf '%s' "$2" | grep -q -- "$3"; then ok "$1"; else no "$1" "missing '$3'"; fi; }
hasnt(){ if printf '%s' "$2" | grep -q -- "$3"; then no "$1" "found '$3'"; else ok "$1"; fi; }

echo "== repository hygiene =="

for f in install.sh uninstall.sh plugins/vero-diff/scripts/snapshot.sh \
         plugins/vero-diff/bin/verodiff plugins/vero-diff/bin/verodiff-pane; do
  [ -x "$ROOT/$f" ] && ok "executable: $f" || no "executable: $f" "not +x - it will not run once cloned"
  if grep -q $'\r$' "$ROOT/$f"; then
    no "LF endings: $f" "CRLF found - dies with: /usr/bin/env: 'bash\\r': No such file or directory"
  else
    ok "LF endings: $f"
  fi
done

for f in .claude-plugin/marketplace.json plugins/vero-diff/.claude-plugin/plugin.json \
         plugins/vero-diff/hooks/hooks.json; do
  if python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$ROOT/$f" 2>/dev/null; then
    ok "valid JSON: $f"
  else
    no "valid JSON: $f"
  fi
done

# macOS still ships bash 3.2 as /bin/bash. `mapfile`/`readarray` and a fractional
# `read -t` are bash 4+, and an unguarded one breaks the viewer for every macOS user.
for f in install.sh uninstall.sh plugins/vero-diff/scripts/snapshot.sh \
         plugins/vero-diff/bin/verodiff plugins/vero-diff/bin/verodiff-pane; do
  if grep -qE '^[^#]*\b(mapfile|readarray)\b' "$ROOT/$f"; then
    no "no bash 4+ syntax: $f" "mapfile/readarray needs bash 4; macOS ships 3.2"
  elif grep -qE '^[^#]*read\b.*-t +[0-9]*\.[0-9]' "$ROOT/$f" && ! grep -q 'BASH_VERSINFO' "$ROOT/$f"; then
    no "no bash 4+ syntax: $f" "fractional 'read -t' needs bash 4 - gate it on BASH_VERSINFO"
  else
    ok "no bash 4+ syntax: $f"
  fi
done

# hooks.json must not be declared in plugin.json as well, or the plugin loads twice.
# Check the parsed key, not the raw text - "hooks" is also a legitimate keyword value.
if python3 -c 'import json,sys; sys.exit(1 if "hooks" in json.load(open(sys.argv[1])) else 0)' \
     "$ROOT/plugins/vero-diff/.claude-plugin/plugin.json"; then
  ok "plugin.json does not declare hooks"
else
  no "plugin.json does not declare hooks" "hooks/hooks.json is auto-discovered; declaring it loads the plugin twice"
fi

echo
echo "== snapshots =="

REPO="$WORK/project"
mkdir -p "$REPO"; cd "$REPO" || exit 1
git init -q -b main
git config user.email smoke@test; git config user.name smoke
git config core.autocrlf input          # the fixture's endings are not what we are testing
git config gc.auto 0                    # no background repack while we are counting objects
git config core.commitGraph false
printf 'alpha\nbeta\n' > a.txt
printf '*.log\n' > .gitignore
git add -A; git commit -qm init
export CLAUDE_PROJECT_DIR="$REPO"

# List object files by path rather than counting them: git is free to pack loose objects
# whenever it likes, which changes the count without anything having been written by us.
# The promise VeroDiff makes is narrower and exact - it never ADDS an object here.
objects() { find "$REPO/.git/objects" -type f | sed "s|^$REPO/.git/objects/||" | LC_ALL=C sort; }
objects > "$WORK/objects.before"

# ---- turn 1 ----
echo '{"prompt":"first turn","session_id":"smoke"}' | "$SNAP" pre
is "hook exits 0 (pre)" "$?" "0"
printf 'alpha\nbeta\ngamma\n' > a.txt
printf 'new file\n' > added.txt
printf 'secret\n' > skipme.log           # gitignored: must never appear
echo '{"session_id":"smoke"}' | "$SNAP" post
is "hook exits 0 (post)" "$?" "0"

# ---- turn 2 ----
echo '{"prompt":"second turn","session_id":"smoke"}' | "$SNAP" pre
rm -f added.txt
echo '{"session_id":"smoke"}' | "$SNAP" post

# ---- a turn that changes nothing must not create a step ----
steps_before="$("$VD" -S smoke -l | grep -c '^ *[0-9]')"
echo '{"prompt":"a question, no edits","session_id":"smoke"}' | "$SNAP" pre
echo '{"session_id":"smoke"}' | "$SNAP" post
steps_after="$("$VD" -S smoke -l | grep -c '^ *[0-9]')"
is "a no-op turn adds no step" "$steps_after" "$steps_before"

objects > "$WORK/objects.after"
added="$(LC_ALL=C comm -13 "$WORK/objects.before" "$WORK/objects.after")"
if [ -z "$added" ]; then
  ok "project .git was never written to"
else
  no "project .git was never written to" "objects appeared: $(printf '%s' "$added" | tr '\n' ' ')"
fi

diff0="$("$VD" -S smoke -n 0)"
diff1="$("$VD" -S smoke -n 1)"
hasnt ".gitignore is honoured"      "$diff1" "skipme.log"
has   "turn 1 diff shows the edit"  "$diff1" "+gamma"
has   "turn 1 diff shows a new file" "$diff1" "added.txt"
has   "turn 2 diff shows a deletion" "$diff0" "deleted file"

echo
echo "== the step list speaks human =="

list="$("$VD" -S smoke -l)"
hasnt "no [post] marker leaks"  "$list" '\[post\]'
hasnt "no [pre] marker leaks"   "$list" '\[pre\]'
has   "turns are numbered"      "$list" 'turn 1'
has   "the baseline is named"   "$list" 'session baseline'
has   "changed files are shown" "$list" 'a.txt'
has   "-s names the turn"       "$("$VD" -S smoke -s 0)" 'turn'

echo
echo "== every mode exits 0 (a non-zero exit aborts a skill invocation) =="

for args in "-l" "-1" "-s" "-s 0" "-s 99" "-s abc" "-n 0" "-n 99" "-n abc" \
            "--where" "--sessions" "--help" "-S nope -l" "-S -l"; do
  # shellcheck disable=SC2086
  "$VD" $args >/dev/null 2>&1
  is "verodiff $args" "$?" "0"
done

cd "$WORK" || exit 1
"$VD" -l >/dev/null 2>&1
is "verodiff outside a git repository" "$?" "0"

CLAUDE_PROJECT_DIR="$WORK" "$SNAP" pre </dev/null >/dev/null 2>&1
is "snapshot hook outside a git repository" "$?" "0"

echo
if [ "$fail" -eq 0 ]; then
  printf '\033[32m%s passed, 0 failed\033[0m\n' "$pass"; exit 0
else
  printf '\033[31m%s passed, %s FAILED\033[0m\n' "$pass" "$fail"; exit 1
fi
