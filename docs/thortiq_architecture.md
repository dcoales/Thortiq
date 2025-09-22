# Thortiq Phase 1 Architecture

## 1. Purpose
This document outlines the Phase 1 architecture for Thortiq, an outliner-first, offline-capable, multi-platform knowledge management application. It distills the functional specification in `thortiq_spec_phase_1.md` and the engineering guardrails in `AGENTS.md` into a technical blueprint for implementation.

## 2. Guiding Constraints & Principles
- **Outliner-first UX:** Keyboard-first, high-performance tree editing with mirrors, tasks, and wiki links.
- **Offline-first & local-first:** Every client operates without connectivity, persisting state locally and syncing opportunistically.
- **Multi-platform:** Web (React), desktop (Electron shell), and mobile (React Native) share a common TypeScript core.
- **Collaboration-ready:** Near real-time sync, conflict-free edits, and a unified undo history across structural and textual changes.
- **Engineering rules from `AGENTS.md`:**
  - All text/structure mutations flow through Yjs transactions.
  - No DOM surgery during typing; rely on declarative rendering.
  - Mirrors carry edge-local state; node identities are stable UUIDs/ULIDs.
  - Single `UndoManager` covering formatting + structural changes without capturing remote edits.
  - Virtualized rendering for large trees, debouncing non-critical work.
  - SOLID, composable architecture; avoid mixing UI, data, and side effects.
  - TypeScript throughout; `any` only with tracked TODOs.
  - Maintain repo health (`npm run lint && npm run typecheck && npm test`) before finishing tasks.

## 3. High-Level System Architecture
```
+-----------------+          +---------------------------+
|  Client Shells  |          |     Sync & API Layer      |
|-----------------|          |---------------------------|
|  Web (React)    |  HTTPS   |  Caddy reverse proxy      |
|  Electron       |<-------> |  Node.js sync server      |
|  React Native   |   WSS    |  Yjs websocket provider   |
+-----------------+          |  AuthN/AuthZ service      |
        |                    |  Persistent data storage  |
        v                    +-------------+-------------+
+-------------------------------+          |
|     Shared Client Core        |          |
|-------------------------------|          |
| Type-safe domain models       |          |
| Yjs doc schema & providers    |          |
| Undo manager & state machine  |          |
| Persistence adapters (IndexedDB, SQLite) |
| React UI primitives & hooks   |          |
+-------------------------------+          |
        |                                   v
        +----------------------> Encrypted storage (PostgreSQL + object store)
```

## 4. Client Architecture
### 4.1 Layered Composition
- **Shell layer:** Platform-specific bootstraps (web entrypoint, Electron main/renderer, React Native app). Responsible for window management, native integrations, and wiring the shared core.
- **Shared core package (`@thortiq/client-core`):** Pure TypeScript module exposing domain models, Yjs bindings, undo manager orchestration, and shared React hooks/components. No direct DOM usage to remain portable across platforms.
- **Feature modules:**
  - `outliner`: virtualized tree rendering, keyboard engine, drag-and-drop adapter.
  - `tasks-pane`: filters todo nodes, reuses virtualization primitives.
  - `sessions`: manages saved session state metadata.
  - `side-panel`: profile, settings, import/export actions.

### 4.2 Rendering & Interaction
- Use React function components with hooks; keep them pure and declarative.
- Virtualize node rows via `react-virtualized`/`@tanstack/virtual-core` (web) and equivalent FlatList optimizations on mobile to handle 100k+ nodes.
- Node identities derive from ULIDs stored in Yjs maps. Mirrors are represented as edges (`{ edgeId, fromNodeId, toNodeId, collapsed }`).
- Editing is backed by the Yjs rich-text type: each keystroke wrapped in a transaction to honor constraint #3.
- The keyboard command layer decouples gesture handling from the view (Command pattern) to remain SOLID and testable.

### 4.3 State & Undo Management
- The Yjs document (`thortiqDoc`) is the single source of truth. It contains:
  - `nodes`: Y.Map keyed by ULID storing metadata (HTML, tags, todo state, timestamps).
  - `tree`: Y.Map keyed by parent node ID with ordered Y.Arrays of edge records.
  - `sessions`: serialized pane layout state.
- A single `UndoManager` is scoped to the relevant Yjs types, with origin tagging to exclude remote updates from the undo stack.
- React components subscribe via shared hooks (`useYjsNodes`, `useSelection`) that derive memoized state and debounce heavy computations.

### 4.4 Persistence & Offline
- Web: IndexedDB via `y-indexeddb` adapter for offline snapshots; Service Worker caches static assets and bootstraps the latest doc checkpoint.
- Desktop: SQLite (via better-sqlite3 or equivalent) persisted inside Electron app data.
- Mobile: SQLite/AsyncStorage hybrid using `@react-native-async-storage/async-storage` for metadata and `react-native-sqlite-storage` for Yjs snapshots.
- Startup flow restores from local snapshot, replays pending updates, then connects to sync server.

### 4.5 Platform Integration
- Web/desktop share most UI code; desktop adds file system hooks for import/export.
- Mobile uses the same domain logic with RN-specific view primitives (`TextInput`, `FlatList`), reusing keyboard command logic via abstraction.

## 5. Sync & Backend Architecture
### 5.1 Components
- **Caddy:** TLS termination, static asset serving, reverse proxy to sync API.
- **Sync server (Node.js/TypeScript):**
  - Express/Fastify REST endpoints for auth, profile, import/export.
  - `y-websocket` based provider for real-time document sync.
  - Session token issuance via JWT; integration with Cognito or self-hosted password auth.
  - Rate limiting and per-document access control.
- **Persistence:** PostgreSQL for user accounts, access control, and metadata; S3-compatible object storage (Lightsail bucket) for encrypted document snapshots/backups.

### 5.2 Data Flow
1. Client authenticates and receives JWT.
2. Client opens websocket to sync server with token; server validates and attaches to user room(s).
3. Local Yjs updates propagate via WebRTC awareness; server rebroadcasts to connected peers.
4. Periodic snapshots + delta updates stored server-side for new devices and recovery.

### 5.3 Conflict Resolution & Mirrors
- Yjs CRDT guarantees conflict-free merges. Mirror edges share node references; validation logic on both client and server prevents cycles by inspecting attempted edge insertions.
- Move operations compute prospective ancestry; cycle attempts emit rejection events surfaced via UI warnings.

## 6. Domain Model Overview
| Entity | Description | Key fields |
|--------|-------------|------------|
| Node | Canonical content unit | `id`, `html`, `createdAt`, `updatedAt`, `done`, `tags`, `metadata` |
| Edge | Parent-child relationship (mirrors included) | `edgeId`, `parentId`, `childId`, `index`, `collapsed`, `viewMode` |
| Pane | UI viewport | `paneId`, `rootNodeId`, `filters`, `layout` |
| Session | Saved layout | `sessionId`, `paneIds`, `selectionState`, `timestamp` |
| User | Account info | `userId`, `profile`, `settings`, `subscriptions` |

## 7. Undo/Redo & History
- Single `UndoManager` tracks operations over node text, metadata, and tree edges.
- Client tags remote-origin updates so the undo stack ignores them, keeping history local per constraint #6.
- History UI (Phase 1) exposes keyboard shortcuts (Ctrl/Cmd+Z / Shift+Ctrl/Cmd+Z) and optional inline status indicator.

## 8. Import/Export
- **Workflowy OPML:** Parsed client-side; transformed into Thortiq node/edge schema, respecting mirrors by generating new nodes when OPML lacks mirror semantics.
- **Thortiq JSON:** Round-trip serialization of Yjs doc for backups, validated against schema version.

## 9. Security & Privacy
- End-to-end TLS via Caddy; JWT-based auth headers for REST and WebSocket.
- Optional client-side encryption for node content at rest (stretch goal beyond Phase 1).
- Rate limiting and audit logging on sync server to monitor misuse.

## 10. Deployment & Operations
- Lightsail instance hosts Caddy + Node.js sync server via systemd.
- CI/CD pipeline (GitHub Actions): lint, typecheck, tests, bundle builds, deploy via SSH/rsync.
- Monitoring: Caddy access logs, Node.js metrics (Prometheus), client error telemetry (Sentry).

## 11. Performance Considerations
- Virtualize long lists; avoid layout thrash by measuring nodes lazily.
- Debounce expensive tree calculations (e.g., descendant counts) and compute incrementally.
- Prefer lazy-loading subtrees when panes focus deep nodes.
- Store derived UI state (collapsed, selection) on edges/panes, not nodes, to avoid redundant rerenders.

## 12. Future Extensions
- Collaborative cursors and presence indicators.
- Advanced task pane features (filters, due dates).
- Plugin architecture for custom renderers.
- Encryption at rest and zero-knowledge sharing.

