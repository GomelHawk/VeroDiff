#!/usr/bin/env bash
# Install the vero-diff plugin from VeroPlugins, the one marketplace for every Vero plugin.
#   ./install.sh                        install for your user
#   ./install.sh --scope project DIR    share it with everyone who works in DIR
#   ./install.sh --scope local DIR      install it for yourself, in DIR only
#
# This clone is validated first, but what gets installed is the released plugin from
# VeroPlugins: a plugin works only when installed from there. To run the code in this
# clone instead, start Claude Code with `claude --plugin-dir ./plugins/vero-diff`.
# Project and local scope write to DIR's .claude/ settings, so they need DIR.
set -euo pipefail

REPO="GomelHawk/VeroPlugins"
MARKET="vero-plugins"
PLUGIN="vero-diff"
SCOPE="user"
DIR=""
case "${1:-}" in
  "") ;;
  --scope) SCOPE="${2:-}"; DIR="${3:-}" ;;
  *) echo "Unknown option: $1 (see the top of this script)"; exit 1 ;;
esac

command -v claude >/dev/null 2>&1 || { echo "claude CLI not found on PATH"; exit 1; }
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

case "$SCOPE" in
  user) DIR="$PWD" ;;
  project|local)
    [ -n "$DIR" ] || { echo "--scope $SCOPE needs the project's directory: ./install.sh --scope $SCOPE DIR"; exit 1; }
    DIR="$(cd "$DIR" 2>/dev/null && pwd)" || { echo "No such directory: ${3:-}"; exit 1; }
    [ "$DIR" != "$HERE" ] || { echo "DIR is this clone; name the project to install VeroDiff into"; exit 1; }
    ;;
  *) echo "Unknown scope: $SCOPE (user, project or local)"; exit 1 ;;
esac

echo "Validating the plugin in this clone..."
claude plugin validate "$HERE/plugins/$PLUGIN"

echo
echo "Adding the VeroPlugins marketplace ($REPO)..."
if [ "$SCOPE" = "user" ]; then
  claude plugin marketplace add "$REPO"
else
  (cd "$DIR" && claude plugin marketplace add "$REPO" --scope "$SCOPE")
fi

echo
echo "Installing $PLUGIN@$MARKET..."
if [ "$SCOPE" = "user" ]; then
  claude plugin install "$PLUGIN@$MARKET"
else
  (cd "$DIR" && claude plugin install "$PLUGIN@$MARKET" --scope "$SCOPE")
  echo
  if [ "$SCOPE" = "project" ]; then
    echo "Written to $DIR/.claude/settings.json - commit it to share VeroDiff with the team."
  else
    echo "Written to $DIR/.claude/settings.local.json - for you only, never committed."
  fi
fi

echo
echo "Installed. Restart Claude Code, then:"
echo "  /vero-diff            open the panel: every turn's changes, newest first"
echo "  /vero-diff last [N]   print a turn's changes into the chat"
echo "  /vero-diff purge      delete this project's saved history"
