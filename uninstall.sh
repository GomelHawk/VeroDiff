#!/usr/bin/env bash
# Remove the vero-diff plugin and, optionally, the snapshots it collected.
#   ./uninstall.sh               remove the plugin, keep snapshots
#   ./uninstall.sh --purge       remove the plugin and every snapshot cache
set -euo pipefail

PURGE=0
[ "${1:-}" = "--purge" ] && PURGE=1

command -v claude >/dev/null 2>&1 || { echo "claude CLI not found on PATH"; exit 1; }
CACHE="${VERODIFF_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/verodiff}"

echo "Uninstalling the plugin (this removes its hooks and skills)..."
claude plugin uninstall "vero-diff@verodiff-marketplace" || true

echo "Removing the marketplace registration..."
claude plugin marketplace remove "verodiff-marketplace" || true

if [ "$PURGE" = 1 ]; then
  if [ -d "$CACHE" ]; then
    echo
    echo "Snapshot cache to delete: $CACHE"
    du -sh "$CACHE" 2>/dev/null || true
    rm -rf "$CACHE"
    echo "Deleted."
  else
    echo "No snapshot cache at $CACHE"
  fi
else
  echo
  echo "Snapshots were left in place at: $CACHE"
  echo "Delete them later with: ./uninstall.sh --purge   (or: verodiff --purge-all)"
fi

echo
echo "Done. Your project repositories were never modified by this plugin."
