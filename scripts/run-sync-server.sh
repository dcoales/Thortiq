#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/apps/server/.env.local"

if [ -f "${ENV_FILE}" ]; then
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
fi

export SYNC_SHARED_SECRET="${SYNC_SHARED_SECRET:-local-dev-secret}"
export PORT="${PORT:-1234}"

cd "${ROOT_DIR}"
pnpm --filter sync-server dev
