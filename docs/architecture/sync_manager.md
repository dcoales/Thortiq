# Sync Manager Architecture

The sync manager owns the lifecycle of the collaborative outline document on every platform. It
keeps one `Y.Doc` per account/device, ensures all mutations flow through Yjs transactions, and
coordinates network + persistence adapters without mixing platform concerns (per AGENTS.md rules
around SOLID and composition). This document is maintained alongside the staged work captured in
`docs/sync_server_plan.md` (see Step 9 for the hand-off checklist).

## Responsibilities
- Initialise the shared outline (`OutlineDoc`) using stable ULIDs for nodes/edges.
- Create and expose the unified `UndoManager`, guaranteeing remote patches never pollute local
  history.
- Bridge offline persistence, network providers, and awareness state while keeping mutations inside
  `doc.transact`.
- Surface connection status, error events, and telemetry hooks so shells can react without reaching
  into Yjs internals.
- Provide resilience primitives (network offline detection, jittered exponential backoff) so
  reconnect storms never destabilise the document pipeline.

## Core Interfaces
The TypeScript definitions live in `packages/client-core/src/sync/SyncManager.ts` and describe:
- `SyncManager` – high-level facade exposing the outline, awareness, undo manager, readiness
  promises, and imperative lifecycle (`connect`, `disconnect`, `dispose`).
- `SyncProviderAdapter` – abstract transport (e.g., y-websocket, custom relay) with a simple status
  machine (`disconnected` → `connecting` → `connected`) plus reconnection callbacks.
- `SyncPersistenceAdapter` – pluggable offline cache (IndexedDB, filesystem, AsyncStorage) responsible
  for seeding the doc before network attach.
- `SyncPersistenceContext` – arguments passed to persistence factories (`docId`, `Y.Doc`).
- `AwarenessPresence` – serialisable payload stored in Yjs awareness (user identity + editing focus)
  that stays out of undo history.
- `createSyncManager(options)` – constructs the manager, wiring persistence readiness, provider lifecycles,
  undo tracking, and awareness propagation without leaking platform details. The default web provider now
  targets the custom sync server (`apps/server/src/index.ts`).

All consumers interact with these abstractions; platform apps only configure adapters.

## Lifecycle Flow
```
createSyncManager()
  ├─ createOutlineDoc()                   // client-core helper with transaction wrappers
  ├─ setupUndoManager(trackedOrigins)     // ensures mirrors + structure share history
  ├─ persistence.start()                  // hydrate local snapshot before network usage
  └─ attachProvider()
        ├─ provider.connect()
        ├─ apply remote updates (transactions tagged with provider origin)
        └─ update status + awareness broadcast
```

The manager exposes a `.status` observable so UI shells can show connectivity indicators without
blocking render.

## Resilience & Telemetry
- Recoverable provider errors emit `reconnect-scheduled` / `reconnect-attempt` events that include
  attempt counts and jittered delay, allowing shells to surface intent without polling internals.
- When the runtime exposes `online/offline` events, the manager pauses retries while offline and
  emits `network-offline` / `network-online` events so analytics/UX layers can respond consistently.
- Manual disconnects cancel pending retries, ensuring platforms retain full control over lifecycle
  transitions (e.g. explicit “work offline” toggles).

## State Model
```
[offline]
   │ connect()
   ▼
[connecting] -- provider.connected --> [connected]
   │                               ↘
   ├─ provider.error --------------> [recovering]
   │                                   │
   └─ disconnect() ------------------> [offline]

[recovering] retries with exponential backoff, eventually re-entering [connected] or [offline]
```

Every transition runs inside `withTransaction` to avoid partial updates.

## Server Expectations
- **WebSocket endpoint:** `wss://<host>/sync/v1/{outlineId}` managed by Caddy → Lightsail. Clients
  authenticate with `Authorization: Bearer <token>`.
- **Handshake:** Follows y-websocket protocol. Server must echo `sync_step1` / `sync_step2` frames
  during initial connect and stream `update` frames thereafter.
- **Persistence:** Server stores incoming update payloads durably (object storage + periodic merged
  snapshots) so a reconnecting device receives the complete state after auth.
- **Awareness channel:** Awareness updates travel over the same socket but never persist server-side.
- **Back-pressure:** If the server signals `throttle` messages (custom frame), clients pause local
  broadcast; retry after the suggested interval.

## Failure Handling
- Provider errors trigger the manager to schedule reconnect attempts with jittered exponential
  backoff (cap at 60s). Offline persistence remains active so edits stay local.
- If persistence fails to hydrate, the manager surfaces a fatal error while leaving the doc empty;
  callers can show recovery UI.
- When a remote update fails validation (e.g., shape mismatch), the manager logs the payload
  (structured data) and drops it to avoid corrupting the tree.

## Metrics & Telemetry Hooks
The manager emits optional callbacks:
- `onStatusChange(status)` – surfaces lifecycle transitions.
- `onSyncEvent(event)` – high-level events (`"snapshot-applied"`, `"update-sent"`, `"update-drop"`).
- `onError(error)` – fatal issues that require user feedback.

Platform shells can wire these into logging/analytics without touching internals.

## Implementation Notes
- Track all local writes with a `localOrigin` symbol stored in the manager options so undo/redo can
  filter remote origins cleanly.
- Use debounced event batching when recomputing derived indexes (virtualised outline) to respect the
  “virtualise rows” rule.
- Future steps will flesh out concrete adapters; this document guarantees every implementation stays
  aligned with the shared contracts.
