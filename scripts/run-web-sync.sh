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

# Derive a stable per-session token so the browser can authenticate once the sync server comes online.
NODE_OUTPUT="$(node <<'NODE'
const crypto = require("crypto");

const secret = process.env.VITE_SYNC_SHARED_SECRET || "local-dev-secret";
const inputUserId = (process.env.VITE_SYNC_USER_ID || "").trim();
const userId = inputUserId.length > 0
  ? inputUserId
  : `web-${typeof crypto.randomUUID === "function" ? crypto.randomUUID() : crypto.randomBytes(6).toString("hex")}`;
const signature = crypto.createHmac("sha256", secret).update(userId).digest("base64url");
process.stdout.write(`${userId} ${userId}:${signature}`);
NODE
)"
IFS=' ' read -r GENERATED_SYNC_USER_ID GENERATED_SYNC_TOKEN <<<"${NODE_OUTPUT}"

export VITE_SYNC_USER_ID="${VITE_SYNC_USER_ID:-${GENERATED_SYNC_USER_ID}}"
export VITE_SYNC_AUTH_TOKEN="${GENERATED_SYNC_TOKEN}"

cd "${ROOT_DIR}"
pnpm --filter web dev "$@"
