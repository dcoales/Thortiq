#!/usr/bin/env bash
set -euo pipefail

# Runs the sync-enabled web dev server with a public host so other devices can reach it.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${VITE_DEV_PORT:-5173}"

"${SCRIPT_DIR}/run-web-sync.sh" -- --host 0.0.0.0 --port "${PORT}"
