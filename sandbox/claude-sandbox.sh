#!/usr/bin/env bash
# Enter the sandboxed Claude Code session (claude --dangerously-skip-permissions).
# Pass a command to run it instead, e.g. ./claude-sandbox.sh bash
set -euo pipefail
cd "$(dirname "$0")"
exec docker compose run --rm --build claude "$@"
