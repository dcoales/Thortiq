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
export AUTH_DATABASE_PATH="${AUTH_DATABASE_PATH:-${ROOT_DIR}/coverage/dev-sync-server.sqlite}"

# Ensure the SQLite file lives in a persisted directory so restarts keep identity records.
mkdir -p "$(dirname "${AUTH_DATABASE_PATH}")"

cd "${ROOT_DIR}"
pnpm --filter sync-server dev
