#!/usr/bin/env bash
# The one place that knows where VeroDiff's snapshots live and how they are taken.
# The plugin's hooks module runs it; it never writes a single object into the project's
# own .git, and always exits 0 so it can never get in the way of a turn.
#
#   snapshot.sh pre          snapshot the working tree as a turn starts
#   snapshot.sh post         snapshot it as the turn ends
#   snapshot.sh where        print the shadow repository's path, take nothing
#   snapshot.sh prune DAYS   drop sessions whose newest snapshot is older than DAYS
#
# Input comes from the environment, so no JSON parser is needed:
#   VERODIFF_SESSION_ID   the session's id (its ref, index and label are its own)
#   VERODIFF_PROMPT       the prompt that started the turn, for a `pre` snapshot
#   CLAUDE_PROJECT_DIR    the project; the current directory when unset
#   VERODIFF_DIR          where snapshots live; ~/.cache/verodiff when unset
set -uo pipefail

# A git variable inherited from whoever started Claude Code (a git hook, a wrapper) would
# point these commands somewhere else - GIT_OBJECT_DIRECTORY even into the project's own
# .git. Start from none of them; GIT_DIR and the rest are set below on purpose.
for var in $(git rev-parse --local-env-vars 2>/dev/null); do unset "$var"; done

KIND="${1:-snap}"

cd "${CLAUDE_PROJECT_DIR:-$PWD}" 2>/dev/null || exit 0
TOP="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
cd "$TOP" || exit 0

# --- where snapshots live --------------------------------------------------
CACHE="${VERODIFF_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/verodiff}"
if command -v md5sum >/dev/null 2>&1;  then key="$(printf '%s' "$TOP" | md5sum | cut -c1-12)"
elif command -v md5 >/dev/null 2>&1;   then key="$(printf '%s' "$TOP" | md5 -q | cut -c1-12)"
else key="$(printf '%s' "$TOP" | cksum | cut -d' ' -f1)"; fi
SHADOW="$CACHE/$(basename "$TOP")-$key.git"

[ "$KIND" = "where" ] && { printf '%s\n' "$SHADOW"; exit 0; }

sid="$(printf '%s' "${VERODIFF_SESSION_ID:-}" | tr -cd 'A-Za-z0-9._-' | cut -c1-64)"
[ -n "$sid" ] || sid="default"

# --- drop stale sessions ---------------------------------------------------
# A session whose newest snapshot is older than DAYS loses its ref, index and label, and
# an index or label left with no session goes too.
# Its objects go at the next gc once they are two weeks unreferenced - never sooner,
# so a snapshot another session is writing right now can never lose an object.
if [ "$KIND" = "prune" ]; then
  [ -d "$SHADOW" ] || exit 0
  days="${2:-30}"
  case "$days" in ''|*[!0-9]*) exit 0 ;; esac
  cutoff=$(( $(date +%s) - days * 86400 ))
  export GIT_DIR="$SHADOW"
  dropped=0
  while IFS=' ' read -r when ref; do
    old="${ref#refs/verodiff/session/}"
    [ "$old" = "$sid" ] && continue          # never the session asking
    [ "$when" -lt "$cutoff" ] 2>/dev/null || continue
    git update-ref -d "$ref" >/dev/null 2>&1 && dropped=$((dropped+1))
    rm -f "$SHADOW/index-$old" "$SHADOW/label-$old"
  done < <(git for-each-ref --format='%(committerdate:unix) %(refname)' refs/verodiff/session 2>/dev/null)
  # An index or label with no ref beside it - a session whose snapshot never landed, a
  # lock a killed git left behind - is dropped once its own file is DAYS old: a younger
  # one may belong to a session taking its first snapshot right now.
  while IFS= read -r file; do
    name="$(basename "$file")"
    old="${name#*-}"; old="${old%.lock}"
    [ "$old" = "$sid" ] && continue
    git show-ref --verify --quiet "refs/verodiff/session/$old" && continue
    rm -f "$file"
  done < <(find "$SHADOW" -maxdepth 1 -type f \( -name 'index-*' -o -name 'label-*' \) -mtime +"$days" 2>/dev/null)
  [ "$dropped" -gt 0 ] && git gc --quiet --prune=2.weeks.ago >/dev/null 2>&1
  exit 0
fi

[ -d "$SHADOW" ] || git init -q --bare "$SHADOW" 2>/dev/null || exit 0
printf '%s\n' "$TOP" > "$SHADOW/project-path" 2>/dev/null

# --- what the project's own .git says about its files ----------------------
# With GIT_DIR on the shadow, git reads the shadow's info/ and config, not the project's.
# So a file excluded only in .git/info/exclude (a personal .env, say) would be
# snapshotted, and a git-crypt or transcrypt file stored in plain text, because its
# clean filter is defined in .git/config. Mirror info/exclude and info/attributes, and
# carry the filters over - read from every scope git reads for the project, so an
# include.path or a worktree's config.worktree counts too, as `--local` alone would not.
COMMON="$(git rev-parse --git-common-dir 2>/dev/null)"
case "$COMMON" in /*) ;; *) COMMON="$TOP/$COMMON" ;; esac
filters=()
defined="|"          # the drivers that can clean: |name|name|
while IFS= read -r -d '' entry; do
  key="${entry%%$'\n'*}"
  filters+=(-c "$key=${entry#*$'\n'}")
  case "$key" in
    filter.*.clean|filter.*.process) name="${key#filter.}"; defined="$defined${name%.*}|" ;;
  esac
done < <(git config --null --get-regexp '^filter\.' 2>/dev/null)

# A file whose filter driver is defined nowhere would be stored as it is on disk - in
# plain text, if that driver was meant to encrypt it. Such files are left out entirely:
# taken off the session's index and excluded from the add. Looking costs a walk of the
# tree, so it happens only when some attributes file names a filter at all.
attributes_name_a_filter() {
  {
    cat "$TOP/.gitattributes" "$COMMON/info/attributes" 2>/dev/null
    cat "$(git config --path core.attributesFile 2>/dev/null \
           || printf '%s' "${XDG_CONFIG_HOME:-$HOME/.config}/git/attributes")" 2>/dev/null
    git ls-files -z -- ':(glob)**/.gitattributes' 2>/dev/null \
      | while IFS= read -r -d '' f; do cat "$TOP/$f" 2>/dev/null; done
  } | grep -q filter
}
# A path as an exclude line that matches it and nothing else: anchored, every wildcard
# and special character escaped.
literal_pattern() { printf '/%s\n' "$(printf '%s' "$1" | sed 's/[][*?\\!# ]/\\&/g')"; }
unfiltered=()
unfiltered_lines=""
if attributes_name_a_filter; then
  while IFS= read -r -d '' path && IFS= read -r -d '' _ && IFS= read -r -d '' value; do
    case "$value" in unspecified|unset|set) continue ;; esac
    case "$defined" in *"|$value|"*) continue ;; esac
    case "$path" in *$'\n'*) exit 0 ;; esac   # no exclude line can name it: take nothing
    unfiltered+=("$path")
    unfiltered_lines="$unfiltered_lines$(literal_pattern "$path")"$'\n'
  done < <(git ls-files -co --exclude-standard -z 2>/dev/null | git check-attr --stdin -z filter 2>/dev/null)
fi

mkdir -p "$SHADOW/info" 2>/dev/null
{ cat "$COMMON/info/exclude" 2>/dev/null; printf '%s' "$unfiltered_lines"; } > "$SHADOW/info/exclude.$$" 2>/dev/null
mv -f "$SHADOW/info/exclude.$$" "$SHADOW/info/exclude" 2>/dev/null
{ cat "$COMMON/info/attributes" 2>/dev/null; } > "$SHADOW/info/attributes.$$" 2>/dev/null
mv -f "$SHADOW/info/attributes.$$" "$SHADOW/info/attributes" 2>/dev/null

export GIT_DIR="$SHADOW" GIT_WORK_TREE="$TOP"

# --- the prompt, kept per session for the `post` snapshot that follows ------
# The module hands it over already cut to length, by characters. Never shorten it here:
# `cut -c` counts bytes and splits a multi-byte character, Cyrillic or emoji alike.
# A `pre` always rewrites it, even with no prompt text: otherwise a turn begun by an
# empty prompt would carry the previous turn's label.
label="$(printf '%s' "${VERODIFF_PROMPT:-}" | tr '\n\r\t' '   ')"
LABEL_FILE="$SHADOW/label-$sid"
if [ "$KIND" = "pre" ]; then
  [ -n "$label" ] || label="(no prompt)"
  printf '%s' "$label" > "$LABEL_FILE" 2>/dev/null
else
  label="$(cat "$LABEL_FILE" 2>/dev/null || true)"
fi
[ -n "$label" ] || label="(no prompt)"

# --- take the snapshot -----------------------------------------------------
REF="refs/verodiff/session/$sid"
export GIT_INDEX_FILE="$SHADOW/index-$sid"
# An excluded file the index already holds would still be updated: take it off first.
if [ ${#unfiltered[@]} -gt 0 ]; then
  printf '%s\0' "${unfiltered[@]}" | git update-index -z --force-remove --stdin >/dev/null 2>&1
fi
# A file git cannot read (mode 000, a socket) is skipped, not the whole snapshot: without
# --ignore-errors git aborts, the index keeps its last state, and write-tree would record
# that - losing the turn, or on a new session's first snapshot, the empty tree that makes
# turn 1 the whole project. Anything still fatal (a lock, a full disk) takes no snapshot.
err="$(git ${filters[@]+"${filters[@]}"} add -A --ignore-errors -- . 2>&1 >/dev/null)"
case "$err" in *fatal:*) exit 0 ;; esac
tree="$(git write-tree 2>/dev/null)" || exit 0
[ -n "$tree" ] || exit 0

# --- submodules ------------------------------------------------------------
# A submodule (or any repository nested in the project) is a gitlink in the tree: the
# commit it points to, nothing of what is uncommitted in it. So each one that has
# uncommitted work gets a fingerprint - a checksum of its diff against its HEAD and of
# its untracked files - kept in the snapshot's message. When one changes between two
# snapshots, the step says so even though its tree does not: "changes inside submodule
# X are not shown". A project with no gitlinks pays one read of the index for this,
# filtered by grep: a bash loop over every entry cost 0.3 s on 20,000 files. A path
# holding a newline splits into lines here; no part of one is a submodule `cd` reaches.
# The fingerprint of one nested repository, run in a subshell of its own (the parentheses)
# so the shadow's GIT_* never reach it. GIT_OPTIONAL_LOCKS=0: read only, never refresh
# its index. Kept a function, never written inline in a multi-line $( ): bash 3.2 reads a
# quote inside a comment there as a real one, and the whole script stops parsing.
fingerprint() (
  unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE
  cd "$TOP/$1" 2>/dev/null || exit 0
  export GIT_OPTIONAL_LOCKS=0
  {
    git diff HEAD --no-color --no-ext-diff --binary 2>/dev/null
    git ls-files -o --exclude-standard -z 2>/dev/null \
      | while IFS= read -r -d '' f; do printf '%s\n' "$f"; cksum < "$f" 2>/dev/null; done
  } | cksum | tr ' ' '-'
)
CLEAN_PRINT="$(printf '' | cksum | tr ' ' '-')"
substate=""
while IFS= read -r entry; do
  path="${entry#*$'\t'}"
  case "$path" in *$'\t'*|*$'\n'*) continue ;; esac
  print="$(fingerprint "$path")"
  [ -n "$print" ] && [ "$print" != "$CLEAN_PRINT" ] && substate="$substate$print $path"$'\n'
done < <(git ls-files -s -z 2>/dev/null | tr '\0' '\n' | grep '^160000 ')
unset GIT_INDEX_FILE GIT_WORK_TREE

parent="$(git rev-parse -q --verify "$REF" 2>/dev/null || true)"
changed=""
if [ -n "$parent" ]; then
  before="$(git log -1 --format='%(trailers:key=submodule-state,valueonly)' "$parent" 2>/dev/null)"
  # a fingerprint on one side only, or different on each: that submodule moved
  [ -n "$substate$before" ] && changed="$(LC_ALL=C comm -3 <(printf '%s' "$substate" | LC_ALL=C sort) \
                              <(printf '%s\n' "$before" | sed '/^$/d' | LC_ALL=C sort) \
             | tr -d '\t' | cut -d' ' -f2- | LC_ALL=C sort -u)"
  if [ "$(git rev-parse -q --verify "$parent^{tree}")" = "$tree" ] && [ -z "$changed" ]; then
    exit 0   # nothing changed during this turn
  fi
fi

branch="$(git --git-dir="$TOP/.git" symbolic-ref --quiet --short HEAD 2>/dev/null || echo detached)"
msg="[$KIND] $label"$'\n\n'"session: $sid"$'\n'"branch: $branch"$'\n'"at: $(date '+%Y-%m-%d %H:%M:%S')"
# trailers, in the message's last paragraph, where `git log %(trailers)` reads them
while IFS= read -r line; do [ -n "$line" ] && msg="$msg"$'\n'"submodule-state: $line"; done <<< "$substate"
while IFS= read -r line; do [ -n "$line" ] && msg="$msg"$'\n'"submodule-changed: $line"; done <<< "$changed"

export GIT_AUTHOR_NAME="verodiff-snapshot" GIT_AUTHOR_EMAIL="claude@local"
export GIT_COMMITTER_NAME="verodiff-snapshot" GIT_COMMITTER_EMAIL="claude@local"

if [ -n "$parent" ]; then
  commit="$(printf '%s' "$msg" | git commit-tree "$tree" -p "$parent" 2>/dev/null)"
else
  commit="$(printf '%s' "$msg" | git commit-tree "$tree" 2>/dev/null)"
fi
[ -n "$commit" ] || exit 0
git update-ref "$REF" "$commit" >/dev/null 2>&1
# Plumbing never packs, so every blob would stay a loose object. gc --auto does nothing
# until there are enough of them, and prunes nothing younger than two weeks.
git gc --auto --quiet >/dev/null 2>&1
exit 0
