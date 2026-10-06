#!/usr/bin/env bash
# VeroDiff smoke test. No Claude Code, no network, no credentials - just git and bash,
# so it runs identically on a developer's machine and on a CI runner.
#
#   tests/smoke.sh
#
# It guards the promises snapshot.sh makes to a user. The first one is the important one:
# taking a snapshot must never write an object into the project's own .git. The pane's
# own logic is TypeScript and is tested by `claude plugin test ./plugins/vero-diff`.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SNAP="$ROOT/plugins/vero-diff/scripts/snapshot.sh"

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

for f in install.sh uninstall.sh plugins/vero-diff/scripts/snapshot.sh; do
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
# `read -t` are bash 4+, and an unguarded one breaks snapshots for every macOS user.
for f in install.sh uninstall.sh plugins/vero-diff/scripts/snapshot.sh; do
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

# The plugin is a mod: hooks.json names the hooks module and nothing else. A command hook
# beside it would take every snapshot twice.
if python3 -c 'import json,sys; sys.exit(0 if json.load(open(sys.argv[1])) == {"modules": ["./register.tsx"]} else 1)' \
     "$ROOT/plugins/vero-diff/hooks/hooks.json"; then
  ok "hooks.json names only the hooks module"
else
  no "hooks.json names only the hooks module" "the module takes the snapshots; a command hook would double them"
fi

# claude.ai organization distribution rejects a plugin with a top-level bin/.
[ ! -e "$ROOT/plugins/vero-diff/bin" ] && ok "no top-level bin/ in the plugin" \
  || no "no top-level bin/ in the plugin" "organization distribution rejects it"

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
# The shadow repository, located the way snapshot.sh and the pane both locate it: keyed
# on git's toplevel, which on macOS is /private/var/... while mktemp said /var/...
TOP="$(git rev-parse --show-toplevel)"
if command -v md5sum >/dev/null 2>&1; then key="$(printf '%s' "$TOP" | md5sum | cut -c1-12)"
else key="$(printf '%s' "$TOP" | md5 -q | cut -c1-12)"; fi
export SHADOW="$VERODIFF_DIR/project-$key.git"
REF="refs/verodiff/session/smoke"
shadow() { GIT_DIR="$SHADOW" git "$@"; }
# The diff of the Nth newest snapshot against its parent, as the pane draws it.
step_diff() { local sha; sha="$(shadow rev-parse "$REF~$1")"; shadow diff --no-color "$sha^" "$sha"; }

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
steps_before="$(shadow rev-list --count "$REF")"
echo '{"prompt":"a question, no edits","session_id":"smoke"}' | "$SNAP" pre
echo '{"session_id":"smoke"}' | "$SNAP" post
steps_after="$(shadow rev-list --count "$REF")"
is "a no-op turn adds no step" "$steps_after" "$steps_before"

objects > "$WORK/objects.after"
added="$(LC_ALL=C comm -13 "$WORK/objects.before" "$WORK/objects.after")"
if [ -z "$added" ]; then
  ok "project .git was never written to"
else
  no "project .git was never written to" "objects appeared: $(printf '%s' "$added" | tr '\n' ' ')"
fi

diff0="$(step_diff 0)"
diff1="$(step_diff 1)"     # newest first; turn 2's pre moved nothing, so it was not stored
hasnt ".gitignore is honoured"      "$diff1" "skipme.log"
has   "turn 1 diff shows the edit"  "$diff1" "+gamma"
has   "turn 1 diff shows a new file" "$diff1" "added.txt"
has   "turn 2 diff shows a deletion" "$diff0" "deleted file"

echo
echo "== the history the pane reads =="

subjects="$(shadow log --format=%s "$REF")"
is  "one snapshot per boundary that moved the tree" "$(shadow rev-list --count "$REF")" "3"
has "a finished turn is a post snapshot"  "$subjects" '^\[post\] second turn'
has "a turn keeps the prompt that began it" "$subjects" '^\[post\] first turn'
is  "the oldest snapshot has no parent"   "$(shadow rev-list --max-parents=0 "$REF" | wc -l | tr -d ' ')" "1"
is  "the project path is recorded"        "$(cat "$SHADOW/project-path")" "$TOP"
hasnt "sessions do not share a ref"       "$(shadow for-each-ref --format='%(refname)')" 'session/default'

echo
echo "== the hook never fails a turn =="

cd "$WORK" || exit 1
CLAUDE_PROJECT_DIR="$WORK" "$SNAP" pre </dev/null >/dev/null 2>&1
is "snapshot hook outside a git repository" "$?" "0"

echo
if [ "$fail" -eq 0 ]; then
  printf '\033[32m%s passed, 0 failed\033[0m\n' "$pass"; exit 0
else
  printf '\033[31m%s passed, %s FAILED\033[0m\n' "$pass" "$fail"; exit 1
fi
