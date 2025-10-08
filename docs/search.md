# Search & Indexing Implementation Plan
This checklist distils §7 of `docs/thortiq_spec.md` plus the stability constraints in `AGENTS.md` into a concrete build plan. Follow the steps in order; each step links the spec requirement to the files an LLM should edit.

## Implementation Plan

### 1. Extend pane session schema for search state
- Bump `SESSION_VERSION` and replace the legacy `quickFilter` string with a structured `search` object on `SessionPaneState` (`draft`, `submitted`, `isInputVisible`, `resultEdgeIds`, `manuallyExpandedEdgeIds`, `manuallyCollapsedEdgeIds`, `appendedEdgeIds`).
- Update helpers and persistence under `packages/sync-core/src/sessionStore/*` so migrations hydrate the new object and tests cover legacy payloads.
- Keep all pane mutations routed through `SessionStore.update()`; never touch Yjs documents from session helpers (AGENTS §3).

### 2. Define shared search domain contracts
- Create `packages/client-core/src/search/types.ts` with module-level docs describing query AST nodes, filter predicates, and index field descriptors (`text`, `path`, `tag`, `type`, `created`, `updated`).
- Export a `SearchExpression` AST and the shape of evaluated filters so React adapters stay type-safe.

### 3. Implement the advanced query parser
- Add `packages/client-core/src/search/queryParser.ts` that tokenises the language in spec §7.2 (fields, comparison operators, boolean keywords, grouping, tag shorthand, ranges, quoted strings).
- Normalise strings to case-insensitive comparisons; parse date literals via `Date.parse`.
- Return informative `ParseError` objects with column offsets for UI surfacing.
- Ship exhaustive unit tests in `packages/client-core/src/search/__tests__/queryParser.test.ts` for AND/OR precedence, NOT, range syntax, invalid inputs, and tag shorthand.

### 4. Build the incremental search index
- Introduce `packages/client-core/src/search/index.ts` exporting `createSearchIndex(outline: OutlineDoc)` with methods to `rebuildFromSnapshot()`, `applyTransactionalUpdates(event: YEvent<unknown>)`, and `runQuery(expression: SearchExpression)`.
- Index per-node documents containing: canonical edge id, plain text (combine `node.text` and inline marks), normalised path segments, tag tokens, node type (derive from metadata such as `todo`), created/updated timestamps.
- Keep index maintenance in-memory; when writing back to Yjs (e.g. normalising metadata) wrap mutations in `withTransaction(outline, ...)`.
- Debounce expensive rebuilds to honour AGENTS §7; cover rebuild/apply flows with tests in `packages/client-core/src/search/__tests__/index.test.ts`.

### 5. Plumb search services through the outline store
- Extend `packages/client-core/src/outlineStore/store.ts` to instantiate the search index alongside the snapshot and expose pane-scoped commands (`runPaneSearch`, `clearPaneSearch`, `toggleSearchExpansion`).
- On each Yjs transaction, pass events to the index before notifying listeners so query results stay consistent.
- Ensure pane search state is persisted via the session store only; never leak search queries into shared awareness/undo streams (AGENTS §§6, 26).

### 6. Derive search-aware pane rows
- Update `packages/client-core/src/selectors.ts` and related tests so `buildPaneRows` can run in two modes: normal hierarchy or search mode driven by `pane.search`.
- When search mode is active, assemble `PaneOutlineRow` items from the frozen `resultEdgeIds`, adding metadata that marks rows as `match`, `ancestor`, or `appended`.
- Compute partial expansion flags (`showsSubsetOfChildren`) when not every child edge is present; feed this into downstream renderers for the 45° chevron.
- Maintain the immutable row order to keep TanStack Virtual stable; add regression tests in `packages/client-core/src/paneSelectors.test.ts`.

### 7. Adapt shared React hooks and row view models
- Extend `packages/client-react/src/outline/useOutlineRows.ts` to pass the new search metadata and partial-expansion state through to `OutlineRow`.
- Add a `usePaneSearch` hook in `packages/client-react/src/outline` that bridges session commands (draft updates, submit, clear, manually expand/collapse, append new child edge after Enter).
- Update `packages/client-react/src/outline/components/OutlineRowView.tsx` so the expand/collapse button renders a 45° glyph when `row.partial` is true and toggles between partial/full per spec §7.4.
- Cover new rendering states in `packages/client-react/src/outline/components/__tests__/OutlineRowView.test.tsx`.

### 8. Implement the pane header search UI
- Rework `apps/web/src/outline/components/OutlineHeader.tsx` to inject the search icon, input field, and clear/collapse button behaviour described in spec §7.1 while retaining existing breadcrumb layout for the idle state.
- Ensure the home icon and navigation arrows stay visible and aligned whether search is active or not; prevent browser focus outlines per design note (“should not highlight on focus”) using CSS only (avoid DOM surgery while typing—AGENTS §4).
- Wire the header controls to the new `usePaneSearch` hook so clicks, keyboard submissions, and clear events mutate pane session state.
- Repeat or adapt the same adapter logic for other platforms (desktop/mobile) without duplicating core search code (AGENTS §13).

### 9. Integrate search results into OutlineView flows
- In `apps/web/src/outline/OutlineView.tsx`, consume `usePaneSearch` to clear search when focus changes via breadcrumbs, wiki links, or history navigation (spec §7.1).
- When Enter creates a new node inside search results, append the new edge id to `pane.search.appendedEdgeIds` so it renders immediately even if it does not match.
- Route expand/collapse clicks in search mode through `toggleSearchExpansion` to switch between partial and full sets; ensure manual toggles respect the “partial → full → closed” cycle.
- After applying a query, request a TanStack Virtual re-measure (e.g. `virtualizer.observeElementRect` or manual `virtualizer.measure()`) to bust stale height caches—mirror the fixes referenced in `feat/search-codex` and compare with TanStack best practices.

### 10. Validation and regression coverage
- Add unit tests for the search hook, store commands, and selector behaviours (React Testing Library in `apps/web/src/outline/__tests__/OutlineView.search.test.tsx`).
- Extend integration tests covering wiki link navigation and node edits to confirm searches clear at the right time and results persist until re-run.
- Document manual QA steps (multi-pane search, mirrored nodes, undo/redo) under `docs/verification/search.md`.
- Before marking the task complete run `npm run lint && npm run typecheck && npm test` per Core Stability Rule #1.

### 11. Documentation follow-up
- Update `docs/architecture/virtualization.md` with the TanStack cache invalidation approach and link back to this plan.
- Record any new platform adapters or shared helpers in `docs/architecture/thortiq_layers.md` to keep cross-platform contracts discoverable.

