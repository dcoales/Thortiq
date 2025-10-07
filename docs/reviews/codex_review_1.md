# Codex Review – AGENTS.md Compliance & Scalability

**Date:** 2025-02-15  
**Reviewer:** Codex (GPT-5)  
**Scope:** Validate adherence to AGENTS.md, ProseMirror/Yjs/TanStack best practices, and assess scalability risks for 100k+ node outlines.

## Findings
- **Critical – O(n) node-map clone on every text flush** (`packages/client-core/src/outlineStore/store.ts:198`)
  - `flushPendingNodeRefresh` copies the entire `snapshot.nodes` map before patching changed IDs. With 100k nodes this becomes a full traversal on each keystroke, violating AGENTS rules 7 & 30 about avoiding heavy work per update. Consider structural sharing (e.g. copy-on-write only for touched entries) or persistent map utilities so text edits scale with the number of changed nodes, not total nodes.
- **Critical – Full snapshot rebuild for each structural transaction** (`packages/client-core/src/outlineStore/store.ts:568-583`)
  - Every structural Yjs transaction triggers `createOutlineSnapshot` twice (before and after `reconcileOutlineStructure`). Each call walks all nodes, edges, root arrays, and child arrays (`packages/client-core/src/doc/snapshots.ts:15-39`). On large outlines this means double O(n) work per indent/move/delete, causing frame drops and breaking rule 7’s “avoid heavy computations on every update.” Tracking touched parent/child collections and patching the snapshot incrementally would keep structural edits proportional to the changed sub-tree.
- **High – Ancestor resolution in search scales O(n²)** (`packages/client-core/src/selectors.ts:352-384`)
  - `getAncestors` scans `snapshot.edges` for each ancestor hop while `buildSearchRows` calls it for every result node. For broad searches this degenerates to quadratic behaviour. Caching a `child->parentEdge` map when the snapshot is built (or memoising within the search pass) would cut lookups to O(depth).
- **High – Wiki link search reprocesses the entire outline per keystroke** (`packages/client-core/src/wiki/search.ts:31-76`)
  - `searchWikiLinkCandidates` iterates every node, lowercases text, and recomputes `computePrimaryPaths` on each invocation. With 100k nodes this easily exceeds 100ms per keypress, breaching rules 7 & 30. A debounced, incremental index (e.g. token -> node IDs) or at least caching the BFS paths between calls is needed for responsive wiki-link dialogs.

## Open Questions & Assumptions
- Snapshot immutability appears to drive the full-map clones. Can we adopt a persistent data structure (e.g. `Map` wrapper with structural sharing) without breaking consumer expectations?  
- Structural reconciliation currently relies on a full snapshot rebuild to stay in sync. Would maintaining per-parent child arrays in the snapshot (and updating them alongside `reconcileOutlineStructure`) satisfy invariants without the global rebuild?

## Compliance Snapshot
- Yjs mutations are consistently wrapped in `withTransaction` helpers (`packages/client-core/src/doc/nodes.ts:21-68`, `packages/client-core/src/doc/edges.ts:53-116`), upholding AGENTS rules 3 & 29.  
- The ProseMirror adapter keeps a single `EditorView` instance and swaps fragments via `setNode` (`packages/editor-prosemirror/src/index.ts:283-434`), aligning with rules 20-24.  
- TanStack Virtual is wired correctly with measurement hooks and overscan control (`packages/client-react/src/outline/OutlineVirtualList.tsx:56-139`), satisfying rule 23.

## Suggested Next Steps
1. Prototype incremental snapshot updates for structural and text changes, reusing maps/arrays where possible to avoid full copies.
2. Introduce parent-edge indexing during snapshot creation to eliminate repeated edge scans in `buildPaneRows` search paths.
3. Add a debounced search index (or cached BFS paths) for wiki links so queries touch only affected nodes and reuse previous work.
4. Capture profiling data with 100k-node fixtures to validate improvements and ensure TanStack measurement remains stable after optimisations.
