#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/apps/web/.env.local"

if [ -f "${ENV_FILE}" ]; then
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
fi

export VITE_SYNC_WEBSOCKET_URL="${VITE_SYNC_WEBSOCKET_URL:-ws://localhost:1234/sync/v1/{docId}}"
export VITE_SYNC_SHARED_SECRET="${VITE_SYNC_SHARED_SECRET:-local-dev-secret}"

cd "${ROOT_DIR}"
pnpm --filter web dev
