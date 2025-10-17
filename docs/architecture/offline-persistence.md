# Offline Persistence & Session Bootstrapping

Thortiq keeps the outline document durable on each device while remaining responsive to
multi-tab collaboration. The web shell wires platform adapters around the shared `sync-core`
utilities to ensure the same behaviour can be reused on desktop and mobile shells later.

## Storage layers
- **Outline document** – Backed by `y-indexeddb` via `createIndexeddbPersistence`. Each tab loads the
  existing snapshot before React mounts and receives live updates via BroadcastChannel. Databases are
  partitioned per account using the `thortiq::<userId>::sync::outline:<docId>` schema so no cached
  data leaks between logins.
- **Session metadata** – Stored in `localStorage` through the session store adapter. We only persist
  edge identifiers (never array indices) so focus/selection can be restored safely, and the storage
  key follows the same namespace (`thortiq::<userId>::session::v1`).

## Bootstrap guard
When the first client seeds the welcome outline we set an internal `thortiq:bootstrap` flag on the
Y.Doc. Subsequent tabs (or refreshes) skip seeding even if they start simultaneously, preventing
duplicate seed nodes.

## Clearing local cache (dev tooling)
To reset a browser session during development:
1. Open DevTools → Application → Storage and delete the IndexedDB database named
   `thortiq::<userId>::sync::outline:<docId>` (the current user id is included in the prefix). Legacy
   databases such as `thortiq-outline` can also be removed.
2. Remove the session metadata entry `thortiq::<userId>::session::v1` from `localStorage`
   (legacy: `thortiq:session:v1`) or run:
   ```js
   indexedDB.deleteDatabase(`thortiq::${userId}::sync::outline:${docId}`);
   localStorage.removeItem(`thortiq::${userId}::session::v1`);
   ```
   The web shell also exposes `clearOutlineCaches({ userId })` for scripted clean-up.
3. Reload the app; the bootstrap guard reseeds the default outline once the persistence layer is
   empty.

These steps keep Yjs undo history intact (`doc.gc = false`) while giving developers a clean slate.
