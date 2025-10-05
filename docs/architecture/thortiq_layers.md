# Outline Refactor Roadmap Layering

## Purpose
This document records the target layering for the outline stack ahead of the large refactor in `docs/refactor1.md`. It ensures every contributor or agent can orient quickly, avoid platform-specific coupling, and preserve AGENTS.md guarantees (transactions, SOLID boundaries, shared-first architecture).

## Layering Overview
- **Data Foundations (`packages/client-core/doc/*`)**: Own Yjs document creation, node/edge lifecycle helpers, and snapshot transforms. All mutations happen inside exported `withTransaction` helpers so editors never touch Yjs maps directly.
- **Session & Persistence (`packages/sync-core/sessionStore/*`)**: Maintain per-device UI state (pane focus, selections, collapsed edges) independent of platform storage. Expose pure command helpers, serialization, and migration utilities that desktop, mobile, and web can reuse.
- **Sync Orchestration (`packages/client-core/sync` + adapters)**: Compose SyncManager, provider factories, and bootstrap flows. Platform adapters inject persistence + network providers but never reimplement shared logic.
- **React Bindings (`packages/client-react/outline`)**: Provide the outline provider component plus hooks such as `useOutlineStore`, `useOutlinePresence`, and `useOutlineSessionState` so React-based platforms consume the shared store without duplicating lifecycle code.
- **Platform Views (`apps/*/src/outline`)**: Renderers (web, desktop, mobile) consume the shared hooks, handle DOM/Native event wiring, and stay under 500 lines per module. Drag/drop, virtualization, and command handlers invoke shared utilities rather than inlining mutations. The web outline pane now composes `@thortiq/client-react` exports (`useOutlineRows`, `useOutlineSelection`, `useOutlineDragAndDrop`, `OutlineVirtualList`, `OutlineRowView`) and limits in-file logic to shell presentation (pane header, new-node affordance, persistent editor host).

## Next Steps
Subsequent phases will split `doc.ts`, `sessionStore.ts`, `OutlineProvider.tsx`, and `OutlineView.tsx` into the layers above. Each phase must finish with `npm run lint && npm run typecheck && npm test` and update this document if layering details change.
