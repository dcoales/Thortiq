# Sync Server Overview

This document explains how to run the realtime sync server, exercise the REST endpoints, and execute the websocket smoke test.

## Prerequisites
- Node.js 20.x
- npm 10.x
- [k6](https://k6.io/docs/getting-started/installation/) binary on your PATH (for load smoke)

## Running the server

```
npm install
npm run sync:local
```

The `sync:local` helper script will:

- generate (or reuse) a local JWT secret stored in `.local-sync-config.json`
- mint a fresh 12 hour token and write the necessary Vite env variables into `apps/web-app/.env.local`
- start the sync server with `THORTIQ_JWT_SECRET` already set

Press `Ctrl+C` to stop the server. When you need to start it again, rerun `npm run sync:local`.

If you prefer to start the service manually:

```
npm run build --workspace @thortiq/sync-server
THORTIQ_JWT_SECRET=<your-secret> npm run start --workspace @thortiq/sync-server
```

The sync server understands the following environment variables:

- `THORTIQ_JWT_SECRET` – shared signing secret for JWT validation (required)
- `THORTIQ_SYNC_PORT` – optional, defaults to `5001`

## REST endpoints

All REST calls require a bearer token signed with `THORTIQ_JWT_SECRET`.

- `GET /health` – public health probe
- `GET /api/profile` – returns `{profile}` for the authenticated user
- `POST /api/documents/:docId/import` – body `{update: base64}` applies a Yjs update
- `GET /api/documents/:docId/export` – returns `{update: base64}` representing the latest document state
- `GET /api/documents/:docId/state-vector` – returns `{stateVector: base64}` for incremental syncs

## Websocket endpoint

Clients connect to `ws://<host>:<port>/<docId>?token=<jwt>` using the `y-websocket` protocol. Awareness updates piggyback on the same connection.

### Web client configuration

The web client reads the following Vite environment variables at build time:

- `VITE_SYNC_SERVER_URL` – websocket base URL (e.g. `ws://localhost:5001`)
- `VITE_SYNC_HTTP_URL` – HTTP base URL (defaults to the websocket host with `http` scheme)
- `VITE_SYNC_TOKEN` – optional bootstrapped JWT, stored in `localStorage`
- `VITE_SYNC_DOC_ID` – document identifier (defaults to `thortiq-outline`)

Running `npm run sync:local` writes these values automatically.

## Smoke load test

The project provides a `k6` scenario that opens concurrent websocket connections.

```
SYNC_WS_URL=ws://localhost:5001 SYNC_JWT=<token> npm run loadtest --workspace @thortiq/sync-server
```

Optional environment variables:

- `SYNC_DOC_ID` – defaults to `thortiq-outline`
- `SYNC_VUS` – virtual users (default `5`)
- `SYNC_DURATION` – test duration (default `30s`)
- `SYNC_SLEEP_SECONDS` – pause between iterations (default `1`)
- `SYNC_ITERATION_TIMEOUT_MS` – websocket lifetime per iteration (default `2000` ms)
