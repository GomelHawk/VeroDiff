#!/usr/bin/env bash
# Remove the vero-diff plugin and, optionally, the snapshots it collected.
#   ./uninstall.sh                        remove the plugin, keep snapshots
#   ./uninstall.sh --scope project DIR    remove it from DIR's shared settings
#   ./uninstall.sh --scope local DIR      remove it from DIR's local settings
#   ./uninstall.sh --purge                also delete every project's snapshots
# --purge combines with --scope; -y skips its question.
set -euo pipefail

SCOPE="user"
DIR=""
PURGE=0
YES=0
while [ $# -gt 0 ]; do
  case "$1" in
    --purge) PURGE=1 ;;
    -y|--yes) YES=1 ;;
    --scope) SCOPE="${2:-}"; DIR="${3:-}"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
  shift
done

command -v claude >/dev/null 2>&1 || { echo "claude CLI not found on PATH"; exit 1; }
CACHE="${VERODIFF_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/verodiff}"

case "$SCOPE" in
  user) DIR="$PWD" ;;
  project|local)
    [ -n "$DIR" ] || { echo "--scope $SCOPE needs the project's directory: ./uninstall.sh --scope $SCOPE DIR"; exit 1; }
    DIR="$(cd "$DIR" 2>/dev/null && pwd)" || { echo "No such directory: $DIR"; exit 1; }
    ;;
  *) echo "Unknown scope: $SCOPE (user, project or local)"; exit 1 ;;
esac

# A step that finds nothing to remove is not fatal - the plugin may never have been
# installed at this scope - but it says so rather than passing in silence.
echo "Uninstalling the plugin at $SCOPE scope (this removes its hooks module and command)..."
(cd "$DIR" && claude plugin uninstall "vero-diff@verodiff-marketplace" --scope "$SCOPE") \
  || echo "  (not removed: see the message above)"

echo "Removing the marketplace registration..."
(cd "$DIR" && claude plugin marketplace remove "verodiff-marketplace" --scope "$SCOPE") \
  || echo "  (not removed: see the message above)"

# Only what snapshot.sh creates is deleted: a <project>-<hex>.git that git calls a bare
# repository. VERODIFF_DIR may point anywhere - a shared ~/.cache, say - so the folder
# itself goes only if nothing else is left in it.
SHAPE='-[0-9a-f]+[.]git$'
if [ "$PURGE" = 1 ]; then
  stores=()
  for store in "$CACHE"/*-*.git; do
    [ -d "$store" ] || continue
    [[ "$(basename "$store")" =~ $SHAPE ]] || continue
    [ "$(git --git-dir="$store" rev-parse --is-bare-repository 2>/dev/null)" = "true" ] || continue
    stores+=("$store")
  done
  echo
  if [ ${#stores[@]} -eq 0 ]; then
    echo "No snapshots in $CACHE"
  else
    echo "Snapshots to delete, in $CACHE:"
    for store in "${stores[@]}"; do printf '  %s  %s\n' "$(du -sh "$store" 2>/dev/null | cut -f1)" "$(basename "$store")"; done
    if [ "$YES" != 1 ] && [ -t 0 ]; then
      printf 'Delete them? [y/N] '
      read -r answer
      case "$answer" in y|Y|yes|YES) ;; *) echo "Kept."; PURGE=0 ;; esac
    fi
    if [ "$PURGE" = 1 ]; then
      for store in "${stores[@]}"; do rm -rf "$store"; done
      rmdir "$CACHE" 2>/dev/null || true
      echo "Deleted."
    fi
  fi
else
  echo
  echo "Snapshots were left in place at: $CACHE"
  echo "Delete them later with: ./uninstall.sh --purge"
fi

echo
echo "Done. Your project repositories were never modified by this plugin."
