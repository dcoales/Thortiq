# Sync Adapter Reference

This note captures the platform-specific persistence factories that wrap the shared sync manager.
Each adapter keeps storage concerns local to its platform while presenting a unified
`SyncPersistenceAdapter` contract.

## Desktop (Electron)
- Module: `apps/desktop/src/sync/persistence.ts` → `createDesktopFilePersistenceFactory`.
- Storage: filesystem snapshot stored under `~/.thortiq/outline/<docId>.ydoc` by default.
- Behaviour:
  - `start()` hydrates the Yjs document from disk if a snapshot exists.
  - `flush()`/`destroy()` write the latest document state back to disk.
  - Accepts overrides for base directory, file name, and filesystem implementation (useful for
    tests/mocks).

## Web
- Module: `apps/web/src/outline/syncPersistence.ts` → `createWebIndexeddbPersistenceFactory`.
- Storage: IndexedDB database per document (`thortiq-outline:<docId>` by default).
- Behaviour: waits for `IndexeddbPersistence.whenSynced` before resolving readiness and supports
  dependency injection for alternate IndexedDB implementations.

## Mobile (React Native)
- Module: `apps/mobile/src/sync/persistence.ts` → `createReactNativePersistenceFactory`.
- Storage: AsyncStorage (or compatible) entry keyed by `thortiq:outline:<docId>` by default.
- Behaviour:
  - `start()` base64-decodes the stored snapshot and applies it to the Yjs doc.
  - `flush()`/`destroy()` encode and persist the latest snapshot.
  - Accepts custom namespace prefixes so multiple accounts/dev environments remain isolated.

## Testing Hooks
- `packages/client-core/src/sync/persistence.ts` exports `createEphemeralPersistenceFactory` for unit
  tests and environments without durable storage.
- Platform adapters accept injected storage backends allowing Vitest suites to run without touching
  real disk/AsyncStorage.

Keep this document in sync when adding new platforms or adjusting snapshot formats. Reference this
file in task/PR notes as required by `AGENTS.md`.
