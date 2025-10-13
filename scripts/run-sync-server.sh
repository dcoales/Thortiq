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

PRIMARY_IP_CERT_PATH="${ROOT_DIR}/certs/192.168.0.56.pem"
PRIMARY_IP_KEY_PATH="${ROOT_DIR}/certs/192.168.0.56-key.pem"
DEFAULT_TLS_CERT_PATH="${ROOT_DIR}/certs/dev-sync-cert.pem"
DEFAULT_TLS_KEY_PATH="${ROOT_DIR}/certs/dev-sync-key.pem"

# Prefer IP-specific certs if present, otherwise fallback to dev cert
if [[ -z "${SYNC_TLS_CERT_PATH:-}" && -z "${SYNC_TLS_KEY_PATH:-}" ]]; then
  if [[ -f "${PRIMARY_IP_CERT_PATH}" && -f "${PRIMARY_IP_KEY_PATH}" ]]; then
    export SYNC_TLS_CERT_PATH="${PRIMARY_IP_CERT_PATH}"
    export SYNC_TLS_KEY_PATH="${PRIMARY_IP_KEY_PATH}"
    echo "[sync-server] Using TLS certificate for 192.168.0.56 at ${SYNC_TLS_CERT_PATH}"
  elif [[ -f "${DEFAULT_TLS_CERT_PATH}" && -f "${DEFAULT_TLS_KEY_PATH}" ]]; then
    export SYNC_TLS_CERT_PATH="${DEFAULT_TLS_CERT_PATH}"
    export SYNC_TLS_KEY_PATH="${DEFAULT_TLS_KEY_PATH}"
    echo "[sync-server] Using default TLS certificate at ${SYNC_TLS_CERT_PATH}"
  fi
fi

# Allow HTTPS dev origins by default when not explicitly set
if [[ -z "${AUTH_CORS_ALLOWED_ORIGINS:-}" ]]; then
  export AUTH_CORS_ALLOWED_ORIGINS="https://penguin.linux.test:5173,https://penguin.linux.test:5174,https://192.168.0.56:5173,https://192.168.0.56:5174,https://localhost:5173,https://localhost:5174,https://100.115.92.200:5174"
  echo "[sync-server] CORS allowed origins: ${AUTH_CORS_ALLOWED_ORIGINS}"
fi

# Ensure the SQLite file lives in a persisted directory so restarts keep identity records.
mkdir -p "$(dirname "${AUTH_DATABASE_PATH}")"

cd "${ROOT_DIR}"
pnpm --filter sync-server dev
