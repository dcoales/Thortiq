# Thortiq Phase 1 Plan: Collaborative Outliner Core

This plan translates `docs/thortiq_spec.md` and `AGENTS.md` into actionable steps for a first release: a collaborative outliner that couples React, Yjs, ProseMirror, and TanStack Virtual. Each step is self-contained so an LLM can implement and validate it before moving on. Unless a step states otherwise, all state mutations involving document structure or text **must happen inside Yjs transactions**, every shared module needs succinct intent comments, and completion requires `pnpm lint && pnpm typecheck && pnpm test` to succeed.

---

## Step 1 – Establish Workspace Foundation
**Goal:** Create a buildable monorepo skeleton with shared-first layout, TypeScript tooling, and baseline scripts.

**Key tasks**
- Initialise Git-tracked Node workspace using `pnpm` workspaces with root `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, and `.npmrc` that keeps node modules outside source zips (respect rule 20).
- Enable Corepack (or otherwise pin `pnpm`) and document the required `pnpm` version so contributors and CI stay aligned.
- Scaffold packages:
  - `packages/client-core` (domain logic & Yjs schema helpers).
  - `packages/editor-prosemirror` (ProseMirror integration helpers).
  - `apps/web` (React shell; keep platform-specific code isolated).
- Install baseline deps: `typescript`, `ts-node`, `eslint`, `@typescript-eslint/*`, `vitest`, `@vitest/ui`, `happy-dom` (for headless DOM), `vite`, `@vitejs/plugin-react`, `react`, `react-dom`.
- Configure scripts: `lint` (eslint), `typecheck` (tsc --noEmit), `test` (vitest run --coverage), `dev` (vite dev), `build` (vite build) at the app level plus root passthrough scripts.
- Add lint config enforcing Yjs/React best practices (prefer function components, no uncontrolled mutations) and Prettier formatting (if used) wired to lint.

**Testing & validation**
- Run `pnpm install` then verify `pnpm lint`, `pnpm typecheck`, and `pnpm test` all pass with placeholder source.
- Add CI-friendly docs snippet explaining how to bootstrap (`docs/architecture/workspace.md`).

**References / best practices**
- Keep shared code in packages, and let apps import via workspace paths.
- Ensure TS path aliases resolve across packages via `tsconfig.base.json` `compilerOptions.paths`.

---

## Step 2 – Model Tree State in Yjs
**Goal:** Define shared domain types and a Yjs document layout that respects mirrors-as-edges and stable IDs.

**Key tasks**
- In `packages/client-core`, add TypeScript types for `NodeId (ulid)`, `NodeSnapshot`, `EdgeId`, `EdgeState` (collapsible state), `NodeMetadata`, and `OutlineTree` helpers.
- Describe module intent with top-of-file comment summarising invariants (e.g., mirrors never form cycles; edges store UI flags).
- Create `createOutlineDoc` that initialises a `Y.Doc` with:
  - `nodes`: `Y.Map` mapping `NodeId` → `Y.Map` for text/meta.
  - `edges`: `Y.Map` mapping `EdgeId` → struct containing parent, child, position, collapsed state.
  - `rootEdges`: `Y.Array<EdgeId>` preserving top-level order.
- Implement helper functions (`withTransaction`, `nodeText`, `setNodeText`, `addChildEdge`, etc.) ensuring each mutation wraps `doc.transact`.
- Provide pure selectors that convert Yjs state into immutable snapshots for UI consumption without leaking live Y objects.
- Add Vitest unit tests covering ID stability, cycle prevention guard, and edge-local state handling.

**Testing & validation**
- Run `pnpm test -- --runInBand packages/client-core` to ensure domain helpers behave deterministically.
- Document data model sketch in `docs/architecture/outline-data-model.md`.

**References / best practices**
- Follow Yjs guidance: mutate shared types only inside `doc.transact`; avoid storing plain JS references to Y structures outside helper scope.

---

## Step 3 – Sync & Undo Infrastructure
**Goal:** Provide reusable adapters to connect the Yjs document to collaboration providers while enforcing unified undo history.

**Key tasks**
- Add `packages/sync-core` with module-level comment explaining responsibilities.
- Implement `createSyncContext` returning `{ doc, undoManager, awareness }` using `y-protocols/awareness` and `UndoManager` targeting `nodes` and `edges` types only.
- Ensure remote transactions don’t leak into local undo history (`UndoManager` `trackedOrigins` pattern per Yjs docs).
- Create thin adapter interface `SyncProvider` (`connect`, `disconnect`, emits status events) so platform code can swap providers (websocket later).
- Include helpers for offline persistence hooks but stub provider (no network yet).
- Write tests mocking transactions to confirm undo/redo order and awareness updates.

**Testing & validation**
- Unit-tests for undo isolation and awareness broadcast.
- Lint/typecheck/test must stay green.

**References / best practices**
- From Yjs docs: instantiate one `UndoManager` per logical doc; filter origins to exclude remote awareness updates.

---

## Step 4 – React Shell with TanStack Virtual
**Goal:** Build the web app frame that reads outline snapshots, renders a virtualised tree, and keeps rendering pure.

**Key tasks**
- Inside `apps/web`, set up React Router (if desired for future panes) or simple single-page shell with global providers.
- Create `OutlineProvider` that subscribes to Yjs changes via `doc.observe` and exposes derived snapshots with React context; debounce heavy recomputations.
- Integrate `@tanstack/react-virtual` `useVirtualizer` for the outline list: supply scroll element ref, `estimateSize`, and `measureElement` to handle variable row heights.
- Ensure each rendered row uses stable keys (`edgeId`).
- Render nodes in display mode with plain HTML (`dangerouslySetInnerHTML` with sanitisation) and keep DOM static to satisfy virtualizer measurement.
- Implement keyboard navigation skeleton (up/down, expand/collapse placeholders) without mutating doc yet.

**Testing & validation**
- Add React Testing Library smoke test ensuring provider renders and virtualizer receives correct count snapshot.
- Manually run `pnpm dev` and confirm virtual list scrolls smoothly with dummy data.

**References / best practices**
- TanStack recommends measuring dynamic heights via ref callback; avoid forcing sync layout reads in loops.
- Keep React components pure; delegate side-effects to hooks.

---

## Step 5 – ProseMirror Editor Integration
**Goal:** Mount a single collaborative ProseMirror editor on the active node while keeping other rows static.

**Key tasks**
- In `packages/editor-prosemirror`, define schema extending `prosemirror-schema-basic` with marks for bold/italic/code and link, plus node for paragraph (phase 1).
- Set up helper `createCollaborativeEditor` returning `{ view, setNode, destroy }` that internally wires:
  - `ySyncPlugin`, `yCursorPlugin`, `yUndoPlugin` from `y-prosemirror` bound to node-specific `Y.XmlFragment`.
  - Keymaps for enter/split, backspace merge, `Mod-b/i` formatting, using ProseMirror command best practices.
- Handle mapping between outline nodes and `Y.XmlFragment` stored under each node record (`nodes.get(nodeId).get('textXml')`). Initialise fragment on demand inside Y transaction.
- Expose React hook `useActiveNodeEditor` that creates/destroys `EditorView` on selection changes; ensure DOM container reused to avoid flicker, align fonts with read-only view.
- Respect AGENTS rules: no DOM surgery inside typing; rely on ProseMirror view updates.
- Add integration tests (Vitest + jsdom) simulating typing, undo/redo, and verifying virtualization unaffected (mock measure).

**Testing & validation**
- Run targeted tests plus full suite.
- Manual check: editing active node updates other clients (simulate with second editor instance in test) and view toggles seamlessly.

**References / best practices**
- Per ProseMirror docs: keep `EditorView` lifecycle outside React render, update via `dispatchTransaction` that calls `view.updateState`.
- Ensure schema and plugins defined once to avoid duplicate decorations.

---

## Step 6 – Outline Commands & Interaction
**Goal:** Implement core outline behaviors (insert, indent/outdent, collapse) wired through Yjs-safe commands and keyboard shortcuts.

**Key tasks**
- Add command helpers in `packages/client-core` (or new `packages/outline-commands`) for:
  - Creating sibling/child nodes with stable IDs.
  - Reordering nodes (move up/down) while preventing cycles (validate mirrors).
  - Toggling collapsed state stored on edge records.
  - Keyboard handlers mapping Enter/Shift+Enter, Tab/Shift+Tab, Arrow navigation.
- Ensure commands reuse shared transaction helpers and broadcast origin metadata for undo grouping.
- Update React UI to call commands via a centralized dispatcher hook to keep view logic thin.
- Extend tests for command functions (pure) and React interaction tests covering keyboard flows.

**Testing & validation**
- Unit-tests for each command verifying Yjs structure changes and invariants.
- UI tests (RTL) ensuring DOM focus transitions but virtualization remains stable.
- Full lint/typecheck/test.

**References / best practices**
- Use command objects or small composable functions (SOLID). Avoid burying data ops inside React components.

---

## Step 7 – Offline Persistence & Session Bootstrapping
**Goal:** Provide durable local storage so phase 1 works offline and restores open outline state.

**Key tasks**
- Integrate `y-indexeddb` (or similar) within `sync-core` adapter; allow injection for environments without IndexedDB.
- Persist session metadata (pane layout, selection) in a separate serialisable store (`Y.Map` or local storage) ensuring mirrors/edges tracked.
- On app start, load snapshot from IndexedDB before attaching UI; provide promise-based readiness gating to avoid rendering empty state.
- Add environment-aware adapters (web uses IndexedDB; fallback to in-memory for tests) following platform adapter rule.
- Document how to reset local cache for dev.

**Testing & validation**
- Write async tests using fake-indexeddb to confirm persistence, hydration, and Yjs updates survive reload.
- Manual test: type offline (simulate by disconnecting provider) and confirm data restored on refresh.

**References / best practices**
- When using `y-indexeddb`, set `gc=false` if we want undo history preserved; ensure provider unsubscribes on teardown.

---

## Step 8 – Quality Gates & Documentation
**Goal:** Finalise developer ergonomics, automated checks, and documentation to support future phases.

**Key tasks**
- Ensure lint/typecheck/test run in CI (GitHub Actions workflow with matrix for Node LTS).
- Add Storybook or Vite preview demonstrating outline states (optional but useful for QA) while keeping data mutations within transactions.
- Backfill docs: update `docs/architecture` with editor integration notes, virtualisation strategies, and testing conventions.
- Provide `CONTRIBUTING.md` summarising rules from `AGENTS.md`, how to run commands, and expectations for comments.
- Review for SOLID/composability compliance and ensure no stray `any` types.

**Testing & validation**
- Smoke-test build `pnpm build`.
- Confirm Undo history works across sessions via manual scenario.

**References / best practices**
- Align documentation with spec so future phases (tasks pane, multi-pane) can build on stable contracts.

---

## When Can We Move to Phase 2?
- Outline supports collaborative editing of nested nodes with real-time Yjs sync, undo/redo, and offline persistence.
- Virtualised tree remains responsive with large synthetic datasets.
- All shared modules have intent comments and unit coverage; tests exercise editor flows via user-like interactions.
- Documentation in `docs/architecture` reflects actual implementation; no TODO gatekeepers remain except tracked follow-ups.
