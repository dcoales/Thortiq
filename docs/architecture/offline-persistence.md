# Offline Persistence & Session Bootstrapping

Thortiq keeps the outline document durable on each device while remaining responsive to
multi-tab collaboration. The web shell wires platform adapters around the shared `sync-core`
utilities to ensure the same behaviour can be reused on desktop and mobile shells later.

## Storage layers
- **Outline document** – Backed by `y-indexeddb` via `createIndexeddbPersistence`. Each tab loads the
  existing snapshot before React mounts and receives live updates via BroadcastChannel.
- **Session metadata** – Stored in `localStorage` through the session store adapter. We only persist
  edge identifiers (never array indices) so focus/selection can be restored safely.

## Bootstrap guard
When the first client seeds the welcome outline we set an internal `thortiq:bootstrap` flag on the
Y.Doc. Subsequent tabs (or refreshes) skip seeding even if they start simultaneously, preventing
duplicate seed nodes.

## Clearing local cache (dev tooling)
To reset a browser session during development:
1. Open DevTools → Application → Storage and delete the IndexedDB database named
   `thortiq-outline`.
2. Remove the session metadata entry `thortiq:session:v1` from `localStorage` (same panel) or run: 
   ```js
   indexedDB.deleteDatabase("thortiq-outline");
   localStorage.removeItem("thortiq:session:v1");
   ```
3. Reload the app; the bootstrap guard reseeds the default outline once the persistence layer is
   empty.

These steps keep Yjs undo history intact (`doc.gc = false`) while giving developers a clean slate.
