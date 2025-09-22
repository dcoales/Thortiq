# Thortiq Phase 1 Implementation Plan

This plan sequences development into incremental, testable milestones that satisfy the Phase 1 specification and honor the engineering guardrails in `AGENTS.md`. Each step produces a runnable build, includes automated verification, and gates the next step on passing `npm run lint`, `npm run typecheck`, and `npm test`.

## Step 1 – Repository & CI Scaffolding
- Initialize monorepo/workspace structure with packages for `client-core`, `web-app`, `desktop-shell`, `mobile-shell`, and `sync-server`.
- Configure shared ESLint, TypeScript project references, Jest/Vitest harness, and Husky pre-push hook running lint+typecheck+tests.
- Add GitHub Actions pipeline mirroring local commands; ensure Node.js LTS matrix.
- Deliverable: Empty shells compile; CI green.

## Step 2 – Domain Models & Utilities
- Define TypeScript types for nodes, edges, panes, sessions, tasks, and user metadata in `client-core`.
- Implement ULID-based ID generator module and validation helpers (cycle detection stubs, mirror invariants).
- Add unit tests covering schema invariants and ID generation.
- Deliverable: `client-core` builds independently; tests pass.

## Step 3 – Yjs Document Schema & Persistence Layer
- Model Yjs doc structure (maps/arrays) for nodes, edges, sessions; wrap mutations inside helper transactions per rule #3.
- Integrate persistence adapters: IndexedDB (web), file/SQLite abstractions (desktop/mobile) behind interface.
- Write tests asserting transactional writes, snapshot load/save, and mirror cycle prevention.
- Deliverable: In-memory demo script that creates nodes, persists snapshot, reloads without data loss.

## Step 4 – Undo Manager & Command Bus
- Configure single `UndoManager` attached to relevant Yjs types with origin tagging to exclude remote edits.
- Build command dispatcher handling text edits, indent/outdent, node creation, deletion, and move requests.
- Unit test undo/redo behavior and command composition without UI.
- Deliverable: CLI harness demonstrating core editing commands with undo/redo.

## Step 5 – Shared React Infrastructure
- Create reusable hooks (`useYDoc`, `useSelection`, `useCommand`) using context providers in `client-core`.
- Implement virtualization primitives (`VirtualizedTreeView`) with placeholder row renderer obeying mirror edge rules.
- Add Storybook or Expo story to visualize basic tree scrolling with mock data.
- Deliverable: Web app renders virtualized outline grid with fake nodes; passes accessibility smoke tests.

## Step 6 – Node Editing (Text & Enter Rules)
- Implement rich text editor component using `Slate` or `ProseMirror` binding to Yjs; enforce no direct DOM mutation.
- Support Enter key behaviors (split, sibling above/below, child creation) and Tab/Shift+Tab indent logic via command bus.
- Add Jest + Playwright tests covering keystroke scenarios and ensuring transactions wrap mutations.
- Deliverable: Web app allows editing nodes with correct Enter/Tab semantics; automated tests green.

## Step 7 – Selection & Multi-Select Gestures
- Add drag-selection marquee logic respecting sibling promotion rule from the spec.
- Visual feedback (light blue background) and keyboard navigation (arrow up/down) integrated with virtualization.
- Test selection logic with unit tests for edge cases (collapsed parents, mirror edges) and E2E test verifying gesture.
- Deliverable: Selection states persist in Yjs edge metadata; undo stack untouched.

## Step 8 – Drag & Drop Reordering
- Integrate accessible drag-and-drop system (e.g., `@dnd-kit`) customized for bullet handles and drop zones.
- Implement drop indicator (grey line) and batch move for multiple selected nodes while maintaining order.
- Validate cycle-prevention guard before commit; surface warnings on invalid drop.
- Add E2E tests ensuring drop behaviors and multi-node moves.
- Deliverable: Users can rearrange nodes smoothly; tests ensure no flicker regressions.

## Step 9 – Ancestor Guidelines & Toggle Behavior
- Render guideline segments per ancestor using CSS borders/React Native equivalents.
- Implement hover/thickening interactions (web/desktop) and tap targets (mobile) that toggle child expansion rules.
- Debounce expensive hover calculations; confirm collapsed state stored on edges per rule #5.
- Deliverable: Visual guidelines behave per spec; screenshot tests or visual regression suite updated.

## Step 10 – Side Panel, Import/Export, Settings
- Build slide-out side panel with profile, settings, import/export menu.
- Implement Workflowy OPML import parser and Thortiq JSON round-trip; ensure imports run inside transactions.
- Add confirmation dialogs and progress indicators; write parser unit tests with sample fixtures.
- Deliverable: Import/export accessible from web and desktop shells; CLI tests cover parsing.

## Step 11 – Tasks Pane & Sessions
- Create Tasks pane that filters todo nodes, reusing virtualization; implement checkbox toggle (Ctrl+Enter).
- Persist pane layouts and saved sessions in Yjs doc; add restore manager to reopen panes.
- Tests for session serialization/deserialization and task filters.
- Deliverable: Users can open multiple panes, save/restore sessions, and manage tasks.

## Step 12 – Sync Server & Realtime Collaboration
- Implement Node.js sync server with `y-websocket`, JWT auth, and REST endpoints (profile, import/export relay).
- Connect clients via WebSocket with awareness API, ensuring remote updates bypass undo history.
- Add integration tests (Jest + supertest) and load smoke (k6 or artillery) to measure scalability.
- Deliverable: Two clients editing same document stay in sync with near real-time updates.

## Step 13 – Desktop & Mobile Packaging
- Electron: wrap web bundle, configure auto-updater, file system import/export integration.
- React Native: reuse core package via Metro bundler; implement platform-specific gestures and offline storage adapter.
- Automated builds via CI for desktop installers and mobile beta (TestFlight/Internal testing).
- Deliverable: Installable desktop app and mobile beta builds running core features.

## Step 14 – Hardening & Performance Pass
- Profile virtualization and command latency with large (100k node) fixtures; optimize memoization and debouncing.
- Add monitoring hooks (Sentry, basic analytics) and improve logging around sync/undo events.
- Security review covering auth flows, storage encryption, and rate limiting.
- Deliverable: Documented performance metrics, security checklist, and readiness report.

