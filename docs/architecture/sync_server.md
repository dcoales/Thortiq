# Sync Server Architecture

The sync server sits behind Caddy on the Lightsail host and exposes a Yjs-compatible WebSocket
endpoint. It authenticates every connection, hydrates documents from object storage, and mirrors
updates back to connected clients in real time.

## Components
- **HTTP entrypoint** – `apps/server/src/index.ts` creates an HTTP server with a `/healthz` probe and a
  WebSocket upgrade handler. The upgrade path expects `Authorization: Bearer <userId:signature>` where
  `signature = HMAC_SHA256(userId, SYNC_SHARED_SECRET)`.
- **WebSocket provider** – Connections exchange framed messages (`MESSAGE_SYNC`, `MESSAGE_AWARENESS`) that
  wrap the standard Yjs sync protocol. The server replies to `SyncStep1` with `SyncStep2` and rebroadcasts
  structural updates (`messageYjsUpdate`) to other peers.
- **Doc manager** – `apps/server/src/docManager.ts` keeps a single `Y.Doc` and `Awareness` instance per
  outline. It applies inbound updates, debounces snapshot persistence, and notifies subscribers when new
  updates/awareness payloads arrive.
- **Persistence** – Snapshots are saved via the pluggable `SnapshotStorage` interface. Production runs should
  configure `createS3SnapshotStorage` (writes to `s3://<bucket>/<prefix>/<docId>.bin`). Tests use the in-memory
  implementation.

## Message Flow
```
Client connect
  ├─ Auth header validated (HMAC)
  ├─ DocManager.ensureDoc(docId)
  ├─ Server sends SyncStep1 snapshot + latest awareness
  └─ Heartbeat pings keep connection alive (30s)

Client message → Server
  ├─ MESSAGE_SYNC + SyncStep1 → reply with SyncStep2
  ├─ MESSAGE_SYNC + Update    → apply & broadcast to peers
  └─ MESSAGE_AWARENESS        → apply and broadcast awareness delta

Doc update → Storage snapshot (5s debounce) → broadcast MESSAGE_SYNC update to peers
```

## Deployment Notes
- Expose the server internally on `127.0.0.1:1234` and configure Caddy to terminate TLS, proxying to
  `/sync/v1/{docId}`. Example Caddy fragment:
  ```caddyfile
  reverse_proxy /sync/v1/* 127.0.0.1:1234 {
    header_up Authorization {>Authorization}
    header_up X-Forwarded-For {remote}
  }
  ```
- Environment variables:
  - `SYNC_SHARED_SECRET` – HMAC secret shared with application servers.
  - `S3_BUCKET`, `AWS_REGION`, `S3_PREFIX` – optional S3 configuration for snapshots.
  - `PORT` – override default listener (1234).

## Persistence & Backups
- Each snapshot write fully replaces the previous object, making it easy to configure S3 versioning for
  rollbacks.
- Periodic backups can be handled via S3 lifecycle rules; no additional metadata is stored outside Yjs.

## Monitoring & Scaling
- Add Prometheus scraping for `/healthz`.
- Horizontal scaling requires a shared snapshot store (S3) and, optionally, Redis pub/sub for awareness
  mirroring if multiple server instances run behind Caddy. The current design isolates awareness per node,
  which is acceptable for initial deployment.

Keep this document updated whenever protocol framing or persistence semantics change.
