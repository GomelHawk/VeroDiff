#!/usr/bin/env bash
# Install the vero-diff plugin from this repository.
#   ./install.sh                 install for your user
#   ./install.sh --scope project install for this repository's team
set -euo pipefail

SCOPE="user"
[ "${1:-}" = "--scope" ] && SCOPE="${2:-user}"

command -v claude >/dev/null 2>&1 || { echo "claude CLI not found on PATH"; exit 1; }
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Validating the marketplace and the plugin..."
claude plugin validate "$HERE"
claude plugin validate "$HERE/plugins/vero-diff"

echo
echo "Registering the marketplace..."
claude plugin marketplace add "$HERE"

echo
echo "The plugin is a mod: one hooks module that snapshots the working tree when a turn"
echo "starts and when it ends (scripts/snapshot.sh), and draws each turn's diff in a pane."
echo
claude plugin install "vero-diff@verodiff-marketplace" --scope "$SCOPE"

echo
echo "Installed. Restart Claude Code, then:"
echo "  /vero-diff            open the pane: every turn's diff, newest first"
echo "  /vero-diff last [N]   print a turn's diff into the chat"
echo "  /vero-diff purge      delete this project's snapshots"
