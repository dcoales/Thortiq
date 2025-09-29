# Sync Server Implementation Plan

## Scope & Intent
- Deliver cross-device, near real-time synchronisation while preserving offline-first behaviour and every rule in `AGENTS.md`.
- Keep shared logic in `packages/client-core`; limit platform-specific code to thin adapters.
- Avoid regressions by validating linting, typechecking, and tests before task completion.

## Preconditions
1. ✅ Reviewed Yjs usage across `packages/client-core` and `apps/*`.
   - All mutating helpers (`createNode`, `setNodeText`, `addEdge`, `moveEdge`, `toggleEdgeCollapsed`) wrap their logic in `withTransaction`, which delegates to `outline.doc.transact` (`packages/client-core/src/doc.ts`).
   - Platform code invokes only these helpers via command wrappers (`packages/outline-commands/src/index.ts`) or session flows (`apps/web/src/outline/OutlineProvider.tsx`), so no direct DOM or Yjs mutations bypass transactions.
2. ✅ Captured existing undo/redo setup and mirror edge state.
   - The shared `createSyncContext` seeds a single `UndoManager` over nodes, edges, root edge list, and child-edge map while tracking `localOrigin` symbols (`packages/sync-core/src/index.ts`).
   - Mirror state lives on the edge record (`mirrorOfNodeId`) alongside edge-local fields such as `collapsed` and `position`, keeping mirrors compliant with the "mirrors are edges" rule (`packages/client-core/src/doc.ts`, `packages/client-core/src/types.ts`).
3. ✅ Inventoried persistence layers per platform.
   - Web uses IndexedDB via `createIndexeddbPersistence` with a graceful fallback to an in-memory adapter when the API is unavailable (`packages/sync-core/src/index.ts`, `apps/web/src/outline/platformAdapters.ts`).
   - No filesystem or AsyncStorage adapters exist yet for desktop or mobile, so those remain explicit gaps to cover during platform adapter work.

## Implementation Steps
1. **Design Sync Contracts**
   - Define a `SyncManager` interface in `packages/client-core` describing responsibilities (doc creation, awareness, undo isolation, connection lifecycle).
   - Draft TypeScript types for node/edge identifiers (ULIDs), edge-local metadata, and awareness payloads; add concise module-level comments stating invariants.
   - Capture contracts, state diagrams, and server API expectations (WebSocket channels, auth, snapshot endpoints) in a new `docs/architecture/sync_manager.md` before coding.

2. **Author Shared Sync Manager**
   - Implement `packages/client-core/sync/SyncManager.ts` exposing pure hooks/utilities; ensure all state mutations pass through Yjs transactions.
   - Instantiate a single `Y.Doc`, configure `UndoManager` to ignore remote updates, and wire event emitters with debouncing suitable for virtualised outlines.
   - Provide composition-friendly helpers (e.g., `useSyncStatus`, `useAwarenessPresence`) without leaking platform APIs.

3. **Local Persistence Abstractions**
   - Create storage adapter interfaces (e.g., `SyncPersistenceAdapter`) and factories within `packages/client-core`, then supply implementations per platform under `apps/<platform>/adapters`.
   - Ensure adapters persist doc snapshots/increments using stable IDs; include TODO comments if platform gaps remain.
   - Write unit tests for shared persistence utilities (mock storage) to guarantee deterministic hydration.

4. **Desktop & Mobile Persistence Adapters**
   - **Desktop (Electron):** Add a filesystem-backed adapter (e.g., LevelDB or SQLite via a thin data layer) in `apps/desktop/adapters`, keeping the persistence logic behind the shared interface.
   - **Mobile (React Native):** Implement an AsyncStorage-based adapter (or SQLite fallback) under `apps/mobile/adapters`, handling background flushes without blocking the UI thread.
   - Document adapter configuration (paths, encryption notes, platform caveats) alongside persistence lifecycle diagrams in `docs/architecture/sync_adapters.md`, and cover each adapter with platform-specific smoke tests.

5. **Server Layer**
   - Stand up or configure a Yjs WebSocket provider (self-hosted y-websocket or custom) behind Caddy on Lightsail.
   - Add persistence pipeline (periodic snapshots to S3/Object Storage, optional metadata DB) ensuring reconnecting clients get latest state.
   - Implement auth middleware compatible with existing user accounts; avoid storing node data outside Yjs.

6. **Client Integration**
   - Replace ad-hoc sync logic in each platform with the new `SyncManager`; wire platform adapters for network sockets and storage.
   - Guarantee mirrors keep shared content while edge-local state remains per parent; update selectors/render hooks as needed without breaking virtualization.
   - Expose presence indicators using Yjs Awareness, making sure ephemeral data stays out of undo history.

7. **Resilience & Observability**
   - Add retry/backoff logic, offline detection, and conflict diagnostics inside the manager.
   - Emit structured logs/metrics hooks so platforms can surface sync health without duplicating logic.

8. **Testing & Validation**
   - Extend shared Jest/Vitest suites to cover concurrent edit scenarios, undo isolation, mirror consistency, and rehydration from snapshots.
   - Add integration tests (web/E2E) simulating multi-client edits via headless browsers or mocked providers; respect “no DOM surgery while typing”.
   - Before finishing any implementation task, run `npm run lint && npm run typecheck && npm test`.

9. **Documentation & Handoff**
   - ✅ Update `docs/architecture` with the new sync flow diagram, referencing this plan (`docs/architecture/sync_manager.md`).
   - ✅ Provide adapter-specific notes (connection configuration, storage requirements) per platform (`docs/architecture/sync_adapters.md`).
   - ✅ Record manual verification steps and open risks (`docs/verification/sync_manual_checks.md`).

## Completion Checklist
- [ ] Sync interfaces and shared manager implemented with SOLID-friendly composition.
- [ ] Platform adapters wired, passing automated and manual sync smoke tests.
- [ ] Tests (unit + integration) cover mirrors, undo history, and offline scenarios.
- [ ] Architecture docs updated and linked back to this plan.
- [ ] `npm run lint && npm run typecheck && npm test` executed successfully prior to declaring the task complete.
