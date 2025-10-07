# Mirrors Implementation Plan

## Context
- Section 4.2.2 of `docs/thortiq_spec.md` defines the Mirrors feature set, spanning creation workflows, UI affordances, children handling, deletion semantics, and tracking UI.
- `AGENTS.md` rules to keep front-of-mind: all mutations must run inside `withTransaction` helpers (#3), mirrors are edge-scoped (#5), undo flows remain unified (#6), virtualization must stay fast (#7, #23), and shared-first layering keeps domain logic in `packages/client-core` with thin platform adapters (#8, #13-15).
- Current related modules: `packages/client-core/src/doc/edges.ts`, `packages/client-core/src/outlineStore/store.ts`, `packages/outline-commands/src/outlineCommands.ts`, `packages/client-react/src/outline/*`, `apps/web/src/outline/*`, and the wiki dialog plumbing in `apps/web/src/outline/components/WikiLinkDialog.tsx`.

## Goals
1. Support mirror creation via `((` dialog and `Alt+drag`, ensuring mirrors reuse node content while maintaining per-edge state.
2. Prevent invalid mirrors (self-mirror, mirrors of mirrors, circular paths) and keep child edge identity unique even when branches are expanded concurrently.
3. Surface UI affordances: colored bullet halos, right-rail mirror counter, path picker dialog with navigation.
4. Guarantee mirror operations respect Yjs transactions, single UndoManager history, virtualization constraints, and remain performant for nodes with 10k descendants.
5. Ship comprehensive tests and documentation updates so future agents can extend the feature safely.

## High-Level Strategy
- Keep mirror invariants inside `@thortiq/client-core`: add read/write helpers, selectors, and snapshot utilities that React layers can consume without touching Yjs maps directly.
- Extend shared commands (`@thortiq/outline-commands`) to expose mirror-specific operations used by both the dialog and drag-and-drop flows.
- Reuse wiki dialog infrastructure by extracting shared search + list presentation into shared modules; the mirror dialog layer only tweaks filtering and result handling.
- Update React outline components and platform shells to display mirror indicators and the tracking sidebar while deferring heavy computations to memoized selectors.
- Add targeted unit, integration, and smoke tests to cover multi-mirror scenarios, deletions, and UI interactions without regressing virtualization.

## Detailed Steps for an Implementing Agent

### 1. Audit current outline and wiki link infrastructure
- Review `packages/client-core/src/doc/edges.ts` and `nodes.ts` to document current invariants, especially how `EDGE_MIRROR_KEY` is read/written today.
- Inspect `packages/client-core/src/wiki/search.ts` and `apps/web/src/outline/components/WikiLinkDialog.tsx` to understand existing search + popup flows for reuse.
- Capture findings in the implementation PR description so future agents know which invariants pre-existed versus newly introduced.

### 2. Extend the outline data model for mirrors
- Introduce explicit helpers in `packages/client-core/src/doc/edges.ts` (e.g. `createMirrorEdge`, `promoteMirrorToOriginal`) that encapsulate:
  - verifying the candidate node is not already a mirror,
  - enforcing no circular paths by consulting ancestors via `resolveAncestorEdgeIds` (add if missing),
  - setting `EDGE_MIRROR_KEY` to the original node id and leaving it `null` only for the canonical edge.
- Update `EdgeSnapshot` or companion derived helpers to expose `isMirror`, `originNodeId`, and per-edge collapse state.
- Ensure `packages/client-core/src/doc/edges.test.ts` gains unit coverage for cycle prevention, mirror metadata persistence, and promotion logic. All helpers must wrap mutations in `withTransaction`.

### 3. Provide mirror-aware selectors and lookup utilities
- In `packages/client-core/src/outlineStore/store.ts` (or nearby selectors), add memoized getters:
  - `getMirrorEdges(nodeId)` returning all edges referencing the same node,
  - `getMirrorPaths(edgeId)` using an enhanced path builder that returns every path (adapt `computePrimaryPaths` from `wiki/search.ts` into a shared `paths` module).
- Keep selectors pure (snapshot-based), and ensure path computation short-circuits once it exceeds a configured max to stay O(edges) for 10k descendants.
- Add tests in `packages/client-core/src/paneSelectors.test.ts` validating mirrors share text but own unique edge ids and path arrays.

### 4. Implement mirror creation command surface
- Extend `packages/outline-commands/src/outlineCommands.ts` with high-level commands:
  - `createMirrorFromDialog(targetNodeId, options)` handling sibling insertion versus converting an empty bullet into a mirror,
  - `createMirrorViaDrag(sourceEdgeId, destinationParent, position, origin)` supporting alt-drag.
- Commands should orchestrate `client-core` helpers, pass through the shared `origin`, and return structured results (`{ edgeId, nodeId }`) for UI updates.
- Update command tests under `packages/outline-commands/src/__tests__` to cover mirror scenarios, mocking the outline doc via existing test harness.

### 5. Build the mirror dialog by reusing wiki dialog infrastructure
- Extract shared dialog primitives from `apps/web/src/outline/components/WikiLinkDialog.tsx` into `packages/client-react/src/outline/components/SearchDialogBase.tsx` (or similar) so both wiki and mirror dialogs share layout, keyboard handling, virtualization, and selection management.
- Implement `MirrorDialog` in `apps/web/src/outline/components/MirrorDialog.tsx` that:
  - filters out nodes already mirrored in the active branch,
  - hides nodes whose canonical edge would introduce a cycle (leveraging selectors from Step 3),
  - returns the selected node id to the command layer to create the mirror.
- Ensure dialog focus handling, keyboard navigation, and virtualization mirror the wiki dialog; add concise comments noting the shared behaviours and step-specific differences.

### 6. Support Alt+drag mirror creation
- Extend `packages/client-react/src/outline/useOutlineDragAndDrop.ts` to detect `Alt` modifier during drag operations.
- When `Alt` is pressed on drop, call the new `createMirrorViaDrag` command instead of move; ensure the original edge remains intact while the new mirror edge inserts at the computed position.
- Preserve existing drop zone precision and virtualization compatibility (respect TanStack measurements); update drag-and-drop tests in `packages/client-react/src/outline/__tests__` to cover alt-drag.

### 7. Update outline row UI to reflect mirror status
- In `packages/client-react/src/outline/components/OutlineRowView.tsx`, render the 1px circular halo around the bullet:
  - orange border for canonical edges, blue border for mirrors.
  - Keep styling in shared CSS modules (likely `apps/web/src/outline/OutlineView.css` or equivalent) so other platforms can reuse tokens.
- Ensure the decoration overlays without shifting layout. Add comments explaining how the halo width interacts with collapsed halos (per spec 4.2.2.2).
- Verify virtualization row measurement stays constant by updating snapshot tests in `apps/web/src/outline/OutlineView.test.tsx`.

### 8. Guarantee mirror children own unique edges while sharing node content
- When creating a mirror, compute child edges lazily: the mirror should point at the same child node ids but allocate fresh edge ids so virtualization receives unique identifiers.
- Add helper `duplicateChildEdgesForMirror` in `packages/client-core/src/doc/edges.ts` that:
  - iterates child edges of the original node using snapshots,
  - clones edge records (new edge id, same child node id, collapsed state copied) inside a transaction,
  - keeps metadata minimal to avoid O(n) Yjs map allocations beyond necessary fields.
- Cover this logic with unit tests ensuring original and mirror child edges diverge when the original tree mutates afterward.

### 9. Implement deletion and promotion semantics
- Extend command helpers to handle mirror deletion:
  - When deleting an edge whose `mirrorOfNodeId` is null (the canonical original), select the next mirror edge (deterministic order) and call `promoteMirrorToOriginal` to nullify its `mirrorOfNodeId`.
  - Ensure child edges attached to the deleted mirror edge are removed without deleting underlying nodes unless orphaned across all mirrors.
- Add explicit tests for:
  - deleting a parent edge that cascades removal of the original, triggering promotion,
  - deleting a mirror leaving others untouched,
  - deleting an ancestor that implicitly deletes the original edge while mirrors remain (per spec 4.2.2.4).
- Update selectors to keep focus/selection stable during promotions, respecting UndoManager history boundaries.

### 10. Deliver mirror tracking affordance
- Add a right-rail component (`packages/client-react/src/outline/components/MirrorTracker.tsx`) that subscribes to selector data from Step 3 (mirror counts + paths).
- In `apps/web/src/outline/OutlineView.tsx`, render the tracker aligned with the virtualized rows; use absolute positioning anchored to each row via TanStack measurement callbacks to avoid DOM reflows.
- Implement the popup list showing original + mirror paths:
  - highlight the canonical path in orange, others in default text with hover state,
  - clicking an entry dispatches `setFocusedEdgeId` via shared commands/selectors so focus updates using existing infrastructure.
- Add integration tests in `apps/web/src/outline/OutlineView.test.tsx` verifying the tracker counts update when mirrors are added/removed and that clicking focuses the requested node.

### 11. Performance and collaboration guardrails
- Profile mirror creation with a synthetic 10k descendant tree in a dedicated test (e.g. `packages/client-core/src/doc/edges.performance.test.ts` or extend existing suites) to assert operation counts stay linear and transactions remain bounded.
- Ensure all commands flag their origin so the shared `UndoManager` only tracks local changes; remote mirror updates should not pollute local undo history (rules #6, #24).
- Audit for event listener cleanup (drag/drop, tracker overlays) to prevent leaks per rule #32.

### 12. Testing strategy
- Unit: `client-core` edges + selectors, `outline-commands`, drag/drop helpers.
- Integration: React outline rendering, dialog flows, tracker interactions with virtualization.
- Editor: add ProseMirror-focused tests in `packages/editor-prosemirror/src/index.test.ts` to ensure mirrors do not spawn extra editors and undo/redo works across mirror edges.
- Snapshot: add baseline coverage for mirror halos and sidebar counts.
- Run `npm run lint && npm run typecheck && npm test` before shipping (per AGENTS rule #1).

### 13. Documentation and follow-up
- Update `docs/thortiq_spec.md` cross-references if implementation clarifies behaviour, and add architectural notes to `docs/architecture` (e.g. `docs/architecture/mirrors.md`) summarising mirror data flow, linking from PR/task notes per rule #18.
- Document any new platform adapter contracts (drag/drop hooks, tracker APIs) and ensure module headers include intent comments (rule #15).
- Record TODOs with owner/date if temporary trade-offs are required (TypeScript only, no `any` without justification per rule #12).

## Validation Checklist
- [ ] Mirror creation via dialog and alt-drag produces blue halos, leaves originals orange, and avoids cycles or mirror-of-mirror scenarios.
- [ ] Child edges stay unique across mirrors, virtualization renders rows once, and focus navigation/UndoManager behave identically after promotions/deletions.
- [ ] Mirror tracker shows accurate counts, lists paths with orange original highlight, and navigation commands focus target nodes.
- [ ] All mirror commands run inside `withTransaction`, reuse shared origins, and pass lint/type/test scripts: `npm run lint && npm run typecheck && npm test`.
- [ ] Documentation updated with mirror architecture summary and cross-links from implementation notes.
