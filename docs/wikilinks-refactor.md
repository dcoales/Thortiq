# Wikilinks Refactor Plan

## Goals
- Keep the static outline HTML, ProseMirror editor, and all remote clients in sync for node text and metadata edits.
- Make wiki links comply with spec §4.2.1: focus the target node on activation, expose a usable edit affordance, and place the caret after the post-link space.
- Centralise wiki-link/outline helper logic inside shared packages so both static rows and the active editor reuse the same code paths.
- Deliver changes without violating AGENTS.md: no DOM writes outside ProseMirror, no mutations outside Yjs transactions, favour shared-first architecture, leave undo history intact, and keep logic composable.

## Workstream Overview
1. **Outline Store Sync Improvements** – ensure every text/metadata edit updates outline snapshots without disrupting the active editor.
2. **Wiki Link Interaction Fixes** – repair hover/edit affordances and caret placement.
3. **Shared Domain Utilities** – extract the target-edge resolution helper for reuse.
4. **Regression Coverage & Validation** – extend tests and run required checks.

Each workstream is independent but must land in the order above so downstream tasks consume the shared improvements.

## Detailed Tasks

### 1. Outline Store Sync Improvements
- File: `packages/client-core/src/outlineStore/store.ts`
  - Introduce `STRUCTURAL_REBUILD_META_KEY = Symbol("outline-structural-rebuild")`.
  - When running the structural rebuild inside `handleDocAfterTransaction`, set `transaction.meta.set(STRUCTURAL_REBUILD_META_KEY, true)` before calling `createOutlineSnapshot`. This tags the transaction so ancillary observers can ignore the same update.
  - Add a module-level queue (e.g. `let pendingNodeRefresh: Set<NodeId> | null = null`) plus a `flushPendingNodeRefresh()` scheduled via `queueMicrotask` to batch node refreshes across the current event loop tick.
  - Attach a `sync.outline.nodes.observeDeep(handleNodesDeepChange)` listener during `attachListeners` and tear it down alongside other observers.
  - `handleNodesDeepChange` should:
    - Early-return when `transaction.meta.get(STRUCTURAL_REBUILD_META_KEY)` is truthy.
    - Collect node ids from the Yjs events (skip root-level events on the nodes map itself).
    - Add ids into `pendingNodeRefresh`, schedule the microtask if this is the first addition, and exit.
  - In the microtask:
    - Clone the existing `snapshot.nodes` map into a `Map` so structural ordering stays intact.
    - For each queued id, if the node still exists in the Yjs doc call `getNodeSnapshot` and update the map; otherwise remove it.
    - If no changes were applied, bail out. Otherwise replace `snapshot = { ...snapshot, nodes: nextNodes }` and call `notify()`.
  - Keep logic pure (no DOM access) and within the AGENTS.md rule about mutation via Yjs transactions only.

- File: `apps/web/src/outline/ActiveNodeEditor.tsx`
  - Split the existing layout effect: one `useLayoutEffect` should remain responsible for initial mount, container changes, and node switches; a separate `useEffect` should update keymap/wiki options when the option objects change.
  - Ensure the cleanup path only parks the editor in `detachedHost` rather than destroying it, so rapid snapshot updates from task 1 do not steal focus or break wiki link keyboard handling.

### 2. Wiki Link Interaction Fixes
- File: `apps/web/src/outline/OutlineView.tsx`
  - Update `onWikiLinkHover` handling to keep `wikiHoverState` alive while the pointer is over the edit button: add `onMouseEnter` / `onMouseLeave` handlers to the ✎ button that set/clear a “hover lock” (e.g. a ref counter or boolean) so hover state persists until both the link and the button are left.
  - Ensure clearing hover state still happens when neither the link nor the button is hovered to avoid stale UI.
- File: `packages/editor-prosemirror/src/index.ts`
  - In `applyWikiLink`, compute whether a trailing space already exists. Always position the selection after the space (`const caretPos = nextChar === " " ? linkEnd + 1 : linkEnd;`). Insert the space only when absent, and call `transaction.setSelection(TextSelection.create(transaction.doc as any, caretPos));`.
  - Add a unit test exercising both cases (existing space vs. inserted space) under the editor package’s test suite.

### 3. Shared Domain Utilities
- File: `packages/client-core/src/wiki` *(new or existing module)*
  - Extract the edge-path resolver currently implemented as `resolveEdgePathForNode` inside `apps/web/src/outline/OutlineView.tsx`. Implement it as a pure helper (e.g. `findEdgePathForNode(snapshot: OutlineSnapshot, nodeId: NodeId): EdgeId[] | null`) that returns the edge id path from document root to the node.
  - Add unit tests in `packages/client-core/src/wiki/__tests__` covering: node not found, root node, nested node, and mirrored node scenarios.
- Update call sites:
  - `apps/web/src/outline/OutlineView.tsx`: import the helper from `@thortiq/client-core/wiki` and delete the in-component implementation.
  - Any other consumer (e.g. reuse inside `ActiveNodeEditor` when we later need to focus via the same logic).
  - Ensure typings stay shared-first per AGENTS.md rule 13.

### 4. Regression Coverage & Validation
- Extend editor/wiki tests to cover the new caret-placement logic as noted above.
- Add integration coverage around hover state if feasible (React testing for `OutlineView` hover-lock behaviour); if not, describe manual QA steps.
- Update or add documentation notes if the shared helper lives in a new package folder (e.g. include the helper in `packages/client-core/src/index.ts`).
- Run `npm run lint`, `npm run typecheck`, and `npm test` before concluding the work.

## Dependency & Conflict Check
- Task 1 must ship before tasks 2–3 so that the outline snapshot updates do not reintroduce focus churn while we adjust UI behaviour.
- Task 3 introduces a new helper consumed by both `OutlineView` and editor code. No other workstream manipulates the same logic paths, so there is no merge contention once the helper exports are in place.
- Task 2’s hover-lock uses React state only; it does not interfere with the snapshot updates from task 1 because the hover state lives in the view layer.
- All tasks respect AGENTS.md by keeping mutations in Yjs transactions, avoiding DOM writes outside ProseMirror, favouring shared modules, and keeping logic composable.

## Validation Checklist
- [ ] Static wiki-link click focuses the linked node in the outline.
- [ ] Hovering a wiki link reveals an edit button that remains clickable.
- [ ] Accepting a wiki link places the caret after the trailing space irrespective of existing whitespace.
- [ ] Outline snapshot updates propagate to static rows and remote clients on each keystroke without stealing editor focus.
- [ ] Lint, typecheck, and test suites pass.
