#!/usr/bin/env bash
set -euo pipefail

# Runs the sync-enabled web dev server with a public host so other devices can reach it.
# Uses HTTPS with certificates for IP 192.168.0.56 when available.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
PORT="${VITE_DEV_PORT:-5173}"

# Check if certificates exist for HTTPS
CERT_PATH="${ROOT_DIR}/certs/192.168.0.56.pem"
KEY_PATH="${ROOT_DIR}/certs/192.168.0.56-key.pem"

if [ -f "${CERT_PATH}" ] && [ -f "${KEY_PATH}" ]; then
  echo "Starting HTTPS server with certificates for 192.168.0.56 on port ${PORT}"
  echo "Access via: https://192.168.0.56:${PORT}"
else
  echo "Warning: HTTPS certificates not found at ${CERT_PATH} and ${KEY_PATH}"
  echo "Starting HTTP server on port ${PORT}"
  echo "Access via: http://192.168.0.56:${PORT}"
fi

# Do not force fixed host overrides; the app derives host from window.location
unset VITE_AUTH_BASE_URL || true
unset VITE_SYNC_WEBSOCKET_URL || true

"${SCRIPT_DIR}/run-web-sync.sh" --host 0.0.0.0 --port "${PORT}"
