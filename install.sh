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
echo "The plugin adds two hooks. Claude Code will show them before you confirm:"
echo "  UserPromptSubmit -> scripts/snapshot.sh pre    (snapshot before your prompt is processed)"
echo "  Stop             -> scripts/snapshot.sh post   (snapshot when Claude finishes the turn)"
echo
claude plugin install "vero-diff@verodiff-marketplace" --scope "$SCOPE"

echo
echo "Installed. Restart Claude Code, then:"
echo "  /vero-diff:steps      open the live diff pane"
echo "  /vero-diff:lastdiff   show the latest turn in chat"
echo "  /hooks                verify the two hooks are registered"
