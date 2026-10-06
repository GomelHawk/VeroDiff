#!/usr/bin/env bash
# Install the vero-diff plugin from this repository.
#   ./install.sh                        install for your user, from this clone
#   ./install.sh --scope project DIR    share it with everyone who works in DIR
#   ./install.sh --scope local DIR      install it for yourself, in DIR only
#
# Project and local scope write to DIR's .claude/ settings, so they need DIR: run from
# this clone, the current directory would be the clone itself. A project install declares
# the GitHub marketplace, not this clone's path, which no teammate has.
set -euo pipefail

REPO="GomelHawk/VeroDiff"
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
  user) ;;
  project|local)
    [ -n "$DIR" ] || { echo "--scope $SCOPE needs the project's directory: ./install.sh --scope $SCOPE DIR"; exit 1; }
    DIR="$(cd "$DIR" 2>/dev/null && pwd)" || { echo "No such directory: ${3:-}"; exit 1; }
    [ "$DIR" != "$HERE" ] || { echo "DIR is this clone; name the project to install VeroDiff into"; exit 1; }
    ;;
  *) echo "Unknown scope: $SCOPE (user, project or local)"; exit 1 ;;
esac

echo "Validating the marketplace and the plugin..."
claude plugin validate "$HERE"
claude plugin validate "$HERE/plugins/vero-diff"

echo
echo "Registering the marketplace..."
case "$SCOPE" in
  user)    claude plugin marketplace add "$HERE" ;;
  project) (cd "$DIR" && claude plugin marketplace add "$REPO" --scope project) ;;
  local)   (cd "$DIR" && claude plugin marketplace add "$HERE" --scope local) ;;
esac

echo
echo "The plugin is a mod: one hooks module that snapshots the working tree when a turn"
echo "starts and when it ends (scripts/snapshot.sh), and draws each turn's diff in a pane."
echo
if [ "$SCOPE" = "user" ]; then
  claude plugin install "vero-diff@verodiff-marketplace"
else
  (cd "$DIR" && claude plugin install "vero-diff@verodiff-marketplace" --scope "$SCOPE")
  echo
  if [ "$SCOPE" = "project" ]; then
    echo "Written to $DIR/.claude/settings.json - commit it to share VeroDiff with the team."
  else
    echo "Written to $DIR/.claude/settings.local.json - for you only, never committed."
  fi
fi

echo
echo "Installed. Restart Claude Code, then:"
echo "  /vero-diff            open the pane: every turn's diff, newest first"
echo "  /vero-diff last [N]   print a turn's diff into the chat"
echo "  /vero-diff purge      delete this project's snapshots"
