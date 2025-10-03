# Refactor Plan 1

## Goals
- Align the outline editor stack with AGENTS.md expectations on SOLID, composability, and shared-first architecture.
- Make the largest modules testable in isolation so behaviour stays stable across web, desktop, and mobile adapters.
- Prepare cross-platform reuse by extracting DOM-agnostic logic out of `apps/web` while keeping adapters thin.
- Preserve transactional guarantees (no Yjs mutations outside transactions, unified undo history) during the refactor.

## High-Risk Hotspots
- `apps/web/src/outline/OutlineView.tsx:123` – 2.3k lines mixing rendering, session mutations, drag/drop plans, keyboard shortcuts, virtualization and presence wiring. Hard to test and impossible to reuse on mobile/desktop.
- `apps/web/src/outline/OutlineProvider.tsx:1` – 806 lines coupling sync bootstrap, session store orchestration, presence shaping, and platform adapters. Violates separation of concerns and blocks non-web adapters.
- `packages/client-core/src/doc.ts:1` – 974 lines combining document lifecycle, node/edge helpers, snapshot builders, and validation. Responsibilities are interleaved, making it risky to evolve the data model.
- `packages/sync-core/src/sessionStore.ts:1` – 841 lines melding persistence adapter plumbing, migrations, command helpers, focus history, and reconciliation rules; the desktop/mobile copies lean on this but cannot extend it cleanly.
- `apps/web/src/outline/OutlineView.test.tsx:1` – 1008 lines of mixed integration tests, pointer polyfills, and helper factories; brittle and discourages adding coverage for new shared modules.

## Roadmap

### Phase 0 – Baseline, Guardrails, and Docs
- Capture current behaviour via high-level smoke tests (outline load, drag/drop, keyboard) that can survive the upcoming decomposition.
- Document the target layering (data -> sync -> UI adapters) in `docs/architecture/outline_refactor.md` so future changes reference a single source.
- Add lint rules (or at least CI checks) that flag files exceeding 500 lines in `apps/web/src/outline` to stop regressions once decomposition lands.

### Phase 1 – Client Core Data Moduleisation (`doc.ts`)
- Split `doc.ts` into composable modules under `packages/client-core/src/doc/`:
  - `transactions.ts` – guards `withTransaction`, origin tagging, and helper assertions.
  - `nodes.ts` – node lifecycle (create/set text/metadata) and snapshot helpers.
  - `edges.ts` – edge lifecycle, move/delete helpers, cycle prevention (currently inside `OutlineView` drop logic around `apps/web/src/outline/OutlineView.tsx:430`).
  - `snapshots.ts` – `createOutlineSnapshot`, `buildPaneRows`, plain-data transforms.
- Re-export a thin public surface from `packages/client-core/src/doc/index.ts` to avoid leaking implementation details.
- Add focused unit tests per module and eliminate duplicated validation helpers.
- Update existing imports (web + packages) to new entry points and run full test suite.

### Phase 2 – Session Store Decomposition (`sessionStore.ts`)
- Introduce `packages/sync-core/src/sessionStore/` with clear boundaries:
  - `state.ts` – immutable state shape, defaults, cloning utilities.
  - `commands.ts` – user intent operations (focus navigation, collapse toggles, pending focus) returning new state.
  - `persistence.ts` – adapter glue, serialization, schema version bump logic.
  - `reconciliation.ts` – focus reconciliation currently interleaved at `packages/sync-core/src/sessionStore.ts:240`.
- Expose a wired `createSessionStore` that composes these modules; keep adapter injection so desktop/mobile keep working.
- Port `apps/{desktop,mobile}/src/sync/persistence.ts` onto the shared persistence contract to reduce duplicate logic.
- Expand unit tests to cover migrations independently from command behaviour.

### Phase 3 – Outline Provider & Store (`OutlineProvider.tsx`)
- Move React-independent orchestration into `packages/client-core` (e.g., outline store lifecycle, bootstrap claim handling now embedded near `apps/web/src/outline/OutlineProvider.tsx:120`).
- Create `packages/client-react/outline` (or extend an existing shared React package) that exports small hooks:
  - `useOutlineStore` – manages SyncManager/session wiring via dependency injection.
  - `useOutlinePresence` – converts awareness states (currently handled by `computePresenceSnapshot` around `apps/web/src/outline/OutlineProvider.tsx:220`).
  - `useOutlineSessionState` – wraps `useSyncExternalStore` subscription logic.
- React bindings now live in `packages/client-react/outline`, keeping the web provider as a thin environment adapter.
- Refactor `OutlineProvider` into a thin web adapter injecting browser-specific factories (`createBrowserSessionAdapter`, `createBrowserSyncPersistenceFactory`) while desktop/mobile supply their own.
- Ensure new modules remain platform-agnostic and update `docs/architecture/sync_manager.md` to reference the new layering.

### Phase 4 – Outline View Composition (`OutlineView.tsx`)
- Extract non-DOM logic into reusable hooks/components:
  - `useOutlineRows` – memoises `buildPaneRows` results, quick filter application, focus context preparation.
  - `useOutlineSelection` – consolidates selection state + session mutations now scattered from `apps/web/src/outline/OutlineView.tsx:123-210`.
  - `useOutlineDragAndDrop` – owns drag intent, drop planning, and `moveEdge` orchestration (lines `430-520`). Provide a platform-agnostic interface so mobile can swap pointer handling.
  - `OutlineRowView` / `PresenceIndicators` components to isolate rendering from controller logic.
- Create a shared command layer for keyboard shortcuts and re-use it between web and desktop; logics currently inline should move near `useOutlineCursorManager`.
- Apply virtualization through a dedicated `OutlineVirtualList` component to keep DOM measurement localized and easier to replace.
- After extraction, target <500 lines for the main view file and add targeted unit tests for each hook plus integration coverage for the recomposed component.

### Phase 5 – Test Architecture (`OutlineView.test.tsx`)
- Break the monolithic test into scenario-focused suites under `apps/web/src/outline/__tests__/` (e.g., `dragAndDrop.test.tsx`, `keyboardNavigation.test.tsx`).
- Share polyfills and helpers via `apps/web/src/outline/testUtils.ts` so React Native / Electron tests can reuse them.
- Adopt the new hooks in tests to validate cross-platform contracts (e.g., ensure `useOutlineDragAndDrop` exposes the same API for web + desktop adapters).
- Expand integration tests to cover focus history, presence rendering, and virtualization fallbacks without reimplementing helper scaffolding per file.

## Additional Considerations
- Monitor `packages/client-core/src/sync/SyncManager.ts` (711 lines) during the above work; defer decomposition until dependent modules settle, but schedule it for a follow-up plan.
- Each phase must end with `npm run lint && npm run typecheck && npm test` to honour AGENTS.md rule 1.
- Update or create architecture docs per phase and cross-link them from PR/task notes per rules 14 and 18.
- Ensure newly shared modules keep node-module separation (rule 20) by exporting through existing `packages/*` barrels instead of app-local copies.
