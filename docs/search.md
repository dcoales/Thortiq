# Search Implementation Plan

1. **Confirm Baseline & Guardrails**
   - Re-read `docs/thortiq_spec.md` §7 and AGENTS.md to restate functional rules (query language, ancestor visibility, quick filters, Yjs safety, unified undo) in an engineering checklist.
   - Audit current outline stack layout per `docs/architecture/outline_refactor.md`; sketch current search-related code (if any) to avoid duplicating logic and to keep new work in shared packages first.
   - Document identified gaps in a short comment block at the top of any new module so intent is clear (AGENTS rule 15).

2. **Design Shared Search Contracts (client-core)**
   - In `packages/client-core/doc`, add a module (e.g. `search/indexStore.ts`) that defines the search index types: index entries keyed by stable node IDs, normalized fields (text, path tokens, tags, type, timestamps), and edge-local context needed for mirrors.
   - Expose pure helpers for index lifecycle: `buildIndexFromSnapshot(doc)`, `applyNodeChangeToIndex(change)`, and `queryIndex(index, filters)` ensuring all writes happen inside existing `withTransaction` helpers so no code mutates Yjs maps directly (AGENTS rule 3).
   - Ensure mirrors store edge metadata (collapsed, path offsets) on the edge object rather than node records (requirement 5).

3. **Hook Index Updates Into Yjs Transactions**
   - Extend shared mutation helpers so every node create/update/delete/move transaction also calls `applyNodeChangeToIndex` within the same transaction; remote changes should update the index but never enter local undo history (AGENTS rule 6).
   - Cover bulk operations (import, mirror insertion, move) and ensure debounced reindexing for large batches to keep virtualized scrolling responsive (requirement 7).
   - Add unit tests around index update helpers to prove consistency after transactions and imports (`packages/client-core/doc/__tests__`).

4. **Implement Query Parsing & Evaluation**
   - Create a parser in `packages/client-core/search/queryParser.ts` with no `any` types, covering fields/operators/Boolean/grouping/ranges/tag shorthand as in spec §7.2; include TODO owner/date if any `any` is unavoidable (requirement 12).
   - Parser outputs an AST consumed by a pure evaluator (`queryEvaluator.ts`) that operates on normalized index entries; string comparisons are case-insensitive, date comparisons use `Date.parse`.
   - Ship exhaustive unit tests for parser edge cases, Boolean precedence, range handling, and tag shorthand (AGENTS rule 16).

5. **Assemble Search Service API**
   - Introduce `packages/client-core/search/service.ts` exporting a composable `SearchService` (SOLID/Composition over inheritance) that wires parser + evaluator + index readers and returns results grouped with ancestor chains.
   - Service should expose: `runQuery(docId, query, options)` returning nodes plus ancestor metadata, `getQuickFilter(tag)`, and hooks to pause automatic reapply per spec (results stay static until search is rerun).
   - Include helper to expand ancestor chains while preserving virtualization: return a flattened row list with markers describing which nodes are fully/partially expanded so UI can render indicators.
   - Add integration tests that build a small Yjs doc, index it, run representative queries, and ensure results include ancestors and respect “no auto reapply” semantics.

6. **Persist Pane-Local Search State (sync-core)**
   - Extend `packages/sync-core/sessionStore` with serializable pane search state (current query string, last result snapshot, quick-filter toggles, focus node overrides) ensuring this remains platform-agnostic per shared-first architecture.
   - Provide pure commands `setPaneQuery`, `toggleTagQuickFilter`, `clearPaneSearch` that React bindings and other platforms can reuse.

7. **Expose React Hooks (client-react)**
   - In `packages/client-react/outline`, add hooks like `usePaneSearchState(paneId)` and `useSearchResults(paneId)` which call the shared `SearchService` and session commands. Keep hooks thin so business logic stays in shared modules (layering rules).
   - Ensure hooks subscribe to the unified undo manager without introducing remote edits into local history. Derive memoized row data ready for TanStack virtualization.

8. **Web App UI Wiring (apps/web)**
   - Update the web outline pane component to show the search icon in the header, swap breadcrumb for search input when activated, and debounce user input without breaking typing caret (requirement 4).
   - Render results via existing virtual list component. Use service metadata to show ancestor nodes, adjust collapse indicators (45° arrow when partially filtered), and keep new nodes visible until user presses Enter again.
   - Implement quick-filter chips: clicking a tag chip applies/toggles `tag:…` filter via session commands, combining with AND semantics unless overridden by advanced query.
   - Ensure DOM updates only happen through React render cycle and ProseMirror remains mounted on active node to avoid cursor loss.

9. **Cross-Platform Adapters**
   - For desktop/mobile adapters, reuse the same hooks; surface platform-specific search icon affordances behind thin adapter components. If new adapter interfaces are introduced, document them in `docs/architecture` and note the doc in task/PR (requirement 14).

10. **Testing & Verification**
   - Add shared unit tests already outlined plus React hook tests with `@testing-library/react` to confirm state wiring.
   - Create end-to-end interaction tests (web) simulating user flows: open search, run query, edit in results, add node post-search, toggle quick filters, ensure undo/redo integrity (requirement 19).
   - Before completion, run `npm run lint && npm run typecheck && npm test` (AGENTS rule 1).

11. **Docs & Change Log**
   - Update `docs/thortiq_spec.md` if clarifications were made (e.g. renumber quick filter subsection) and add any new architectural notes under `docs/architecture/` if structural shifts occurred (requirement 18).
   - Record high-level changes and testing evidence in task notes for future agents.

12. **Deployment Readiness**
   - Verify search index rebuild logic handles import/export flows and mirrors.
   - Confirm no node modules leak into source zips (requirement 20).
   - Ensure plan for feature flag or gradual rollout if needed (optional, depending on current release process).
