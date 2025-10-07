# Performance Refactoring Plan - Phase 1

**Version:** 1.0  
**Date:** October 6, 2025  
**Target:** Optimize Thortiq for 100k+ node outlines  
**Based on:** docs/reviews/cursor_review_1.md, docs/reviews/codex_review_1.md  
**Compliance:** AGENTS.md rules 7, 30-33 (Performance & Scalability)

## Executive Summary

This plan addresses **critical performance bottlenecks** identified in two comprehensive code reviews. The current implementation has O(n) and O(n²) operations on every update that will cause severe performance degradation with large trees (100k+ nodes). The goal is to reduce these operations to O(log n) or O(changed nodes) complexity through incremental updates, memoization, and indexing.

**Estimated Performance Gains:**
- Snapshot Creation: 200ms → 20ms (10x faster)
- Row Building: 50ms → 5ms (10x faster)  
- Search Operations: 100ms → 10ms (10x faster)
- Memory Usage: 200MB → 50MB (4x reduction)

## Critical Issues Identified

### Issue #1: Full Snapshot Rebuild on Every Transaction (CRITICAL)
**Files:** `packages/client-core/src/outlineStore/store.ts` (lines 568-570, 582-583)  
**Impact:** 200ms+ delays, 100MB+ memory allocation per structural change  
**AGENTS Rules Violated:** Rule 7 (avoid heavy computations on every update), Rule 30 (debounce non-critical operations)

### Issue #2: Node Map Clone on Every Text Flush (CRITICAL)
**Files:** `packages/client-core/src/outlineStore/store.ts` (line 198)  
**Impact:** Full O(n) map traversal on every keystroke  
**AGENTS Rules Violated:** Rule 7 (avoid heavy computations on every update), Rule 25 (performance optimization)

### Issue #3: Row Building Without Memoization (CRITICAL)
**Files:** `packages/client-core/src/selectors.ts` (lines 121-200)  
**Impact:** 50ms+ CPU time per render, frame drops during scrolling  
**AGENTS Rules Violated:** Rule 7 (avoid heavy computations on every update), Rule 33 (efficient data structures)

### Issue #4: Wiki Link Search Without Indexing (HIGH)
**Files:** `packages/client-core/src/wiki/search.ts` (lines 31-77)  
**Impact:** 100ms+ search latency, typing lag in dialogs  
**AGENTS Rules Violated:** Rule 30 (debounce non-critical operations), Rule 31 (lazy loading)

### Issue #5: Ancestor Resolution O(n²) Complexity (HIGH)
**Files:** `packages/client-core/src/selectors.ts` (lines 352-384)  
**Impact:** Quadratic complexity for search results with deep hierarchies  
**AGENTS Rules Violated:** Rule 33 (efficient data structures)

### Issue #6: Reconciliation Algorithm Complexity (MEDIUM)
**Files:** `packages/client-core/src/doc/edges.ts` (lines 208-274)  
**Impact:** 50ms+ reconciliation times for large trees  
**AGENTS Rules Violated:** Rule 29 (transaction boundaries), Rule 33 (efficient data structures)

---

## Refactoring Plan - Step-by-Step LLM Prompts

Each step below is formatted as a complete prompt for an LLM to execute. The prompts are ordered by priority (Critical → High → Medium) and include validation steps to ensure AGENTS.md compliance.

---

## PHASE 1: CRITICAL SNAPSHOT OPTIMIZATION

### Step 1.1: Add Snapshot Versioning and Change Tracking

**Priority:** CRITICAL  
**Estimated Time:** 2-3 hours  
**Dependencies:** None

#### LLM Prompt:

```
Implement snapshot versioning and change tracking to enable incremental snapshot updates in Thortiq. This is the foundation for eliminating full snapshot rebuilds on every transaction.

REQUIREMENTS:
1. Add version tracking to OutlineSnapshot interface
2. Create a SnapshotUpdateTracker class to monitor changes
3. Track which nodes and edges changed in each transaction
4. Ensure all changes maintain Yjs transaction patterns (AGENTS rule 3)
5. Add comprehensive unit tests

FILES TO MODIFY:
- packages/client-core/src/doc/snapshots.ts
- packages/client-core/src/types.ts

IMPLEMENTATION DETAILS:

In packages/client-core/src/types.ts, extend OutlineSnapshot:

```typescript
export interface OutlineSnapshot {
  readonly nodes: ReadonlyMap<NodeId, OutlineNodeRecord>;
  readonly edges: ReadonlyMap<EdgeId, OutlineEdgeRecord>;
  readonly roots: ReadonlyArray<EdgeId>;
  readonly version: number; // NEW: Increment on every change
}

export interface SnapshotChangeSet {
  readonly version: number;
  readonly changedNodeIds: ReadonlySet<NodeId>;
  readonly changedEdgeIds: ReadonlySet<EdgeId>;
  readonly structuralChange: boolean; // true if roots/children arrays changed
  readonly previousVersion: number;
}
```

In packages/client-core/src/doc/snapshots.ts, add:

```typescript
/**
 * Tracks changes between snapshot versions for incremental updates.
 * Monitors Yjs transaction events to identify modified nodes/edges.
 */
export class SnapshotChangeTracker {
  private currentVersion: number = 0;
  private changedNodes: Set<NodeId> = new Set();
  private changedEdges: Set<EdgeId> = new Set();
  private structuralChange: boolean = false;

  /**
   * Mark nodes as changed (typically from text edits).
   */
  markNodesChanged(nodeIds: Iterable<NodeId>): void {
    for (const id of nodeIds) {
      this.changedNodes.add(id);
    }
  }

  /**
   * Mark edges as changed (from collapse/expand operations).
   */
  markEdgesChanged(edgeIds: Iterable<EdgeId>): void {
    for (const id of edgeIds) {
      this.changedEdges.add(id);
    }
  }

  /**
   * Mark structural change (roots, children arrays modified).
   */
  markStructuralChange(): void {
    this.structuralChange = true;
  }

  /**
   * Create a changeset for the current accumulated changes.
   */
  createChangeSet(): SnapshotChangeSet {
    const previousVersion = this.currentVersion;
    this.currentVersion++;
    
    const changeSet: SnapshotChangeSet = {
      version: this.currentVersion,
      changedNodeIds: new Set(this.changedNodes),
      changedEdgeIds: new Set(this.changedEdges),
      structuralChange: this.structuralChange,
      previousVersion
    };

    // Reset tracking state
    this.changedNodes.clear();
    this.changedEdges.clear();
    this.structuralChange = false;

    return changeSet;
  }

  getCurrentVersion(): number {
    return this.currentVersion;
  }
}
```

TESTS TO ADD:
Create packages/client-core/src/doc/snapshots.test.ts with:
- Test SnapshotChangeTracker.markNodesChanged() accumulates node IDs
- Test SnapshotChangeTracker.markEdgesChanged() accumulates edge IDs  
- Test SnapshotChangeTracker.markStructuralChange() sets flag
- Test createChangeSet() increments version and resets state
- Test multiple changesets have sequential versions

VALIDATION:
- Run: npm run typecheck
- Run: npm run test packages/client-core/src/doc/snapshots.test.ts
- Verify: No AGENTS.md rule violations (check Yjs transaction patterns remain intact)
- Verify: No performance regression in existing tests

ALIGNMENT WITH AGENTS.md:
- Rule 7: Foundation for avoiding heavy computations on every update
- Rule 33: Efficient data structure for tracking changes
- Rule 39: Incremental change that can be easily reviewed
```

---

### Step 1.2: Implement Incremental Snapshot Updates

**Priority:** CRITICAL  
**Estimated Time:** 4-5 hours  
**Dependencies:** Step 1.1 completed

#### LLM Prompt:

```
Implement incremental snapshot updates to avoid full snapshot rebuilds on every transaction. This addresses the most critical performance bottleneck (200ms+ per structural change).

REQUIREMENTS:
1. Create updateSnapshotIncremental() function that only rebuilds changed portions
2. Integrate SnapshotChangeTracker into outlineStore
3. Fallback to full rebuild only when necessary
4. Maintain snapshot immutability (AGENTS rule 33)
5. Preserve Yjs transaction patterns (AGENTS rule 3)
6. Add comprehensive tests including edge cases

FILES TO MODIFY:
- packages/client-core/src/doc/snapshots.ts
- packages/client-core/src/outlineStore/store.ts

IMPLEMENTATION DETAILS:

In packages/client-core/src/doc/snapshots.ts, add:

```typescript
/**
 * Creates an incremental snapshot update by patching only changed portions.
 * Structural changes require full rebuild; text-only changes are fast-patched.
 * 
 * Performance: O(changed nodes) instead of O(all nodes)
 * Memory: Reuses 95%+ of existing snapshot data via structural sharing
 * 
 * @param previousSnapshot - The baseline snapshot to update
 * @param outline - Current Yjs outline document
 * @param changeSet - Tracked changes from SnapshotChangeTracker
 * @returns New snapshot with incremental updates applied
 */
export function updateSnapshotIncremental(
  previousSnapshot: OutlineSnapshot,
  outline: OutlineDoc,
  changeSet: SnapshotChangeSet
): OutlineSnapshot {
  // FAST PATH: Text-only changes (no structural modifications)
  if (!changeSet.structuralChange && changeSet.changedEdgeIds.size === 0) {
    // Only update changed node text, reuse all other data
    const updatedNodes = new Map(previousSnapshot.nodes);
    
    for (const nodeId of changeSet.changedNodeIds) {
      const yNode = outline.nodes.get(nodeId);
      if (yNode) {
        const currentNode = previousSnapshot.nodes.get(nodeId);
        if (currentNode) {
          updatedNodes.set(nodeId, {
            ...currentNode,
            text: yNode.get('text') || ''
          });
        } else {
          // New node added
          updatedNodes.set(nodeId, {
            id: nodeId,
            text: yNode.get('text') || '',
            childIds: yNode.get('childIds')?.toArray() || []
          });
        }
      } else {
        // Node deleted
        updatedNodes.delete(nodeId);
      }
    }

    return {
      nodes: updatedNodes,
      edges: previousSnapshot.edges, // Reuse unchanged
      roots: previousSnapshot.roots,  // Reuse unchanged
      version: changeSet.version
    };
  }

  // MEDIUM PATH: Edge changes only (collapse/expand)
  if (!changeSet.structuralChange && changeSet.changedEdgeIds.size > 0) {
    const updatedEdges = new Map(previousSnapshot.edges);
    
    for (const edgeId of changeSet.changedEdgeIds) {
      const yEdge = outline.edges.get(edgeId);
      if (yEdge) {
        const currentEdge = previousSnapshot.edges.get(edgeId);
        if (currentEdge) {
          updatedEdges.set(edgeId, {
            ...currentEdge,
            collapsed: yEdge.get('collapsed') || false
          });
        }
      }
    }

    // Update any changed nodes
    let updatedNodes = previousSnapshot.nodes;
    if (changeSet.changedNodeIds.size > 0) {
      updatedNodes = new Map(previousSnapshot.nodes);
      for (const nodeId of changeSet.changedNodeIds) {
        const yNode = outline.nodes.get(nodeId);
        if (yNode) {
          const currentNode = previousSnapshot.nodes.get(nodeId);
          if (currentNode) {
            updatedNodes.set(nodeId, {
              ...currentNode,
              text: yNode.get('text') || ''
            });
          }
        }
      }
    }

    return {
      nodes: updatedNodes,
      edges: updatedEdges,
      roots: previousSnapshot.roots, // Reuse unchanged
      version: changeSet.version
    };
  }

  // SLOW PATH: Structural changes require full rebuild
  // This ensures correctness when roots or children arrays change
  const fullSnapshot = createOutlineSnapshot(outline);
  return {
    ...fullSnapshot,
    version: changeSet.version
  };
}
```

In packages/client-core/src/outlineStore/store.ts, integrate change tracking:

```typescript
// Add to OutlineStoreState interface
interface OutlineStoreState {
  // ... existing fields
  snapshotTracker: SnapshotChangeTracker; // NEW
}

// Initialize in createOutlineStore
const snapshotTracker = new SnapshotChangeTracker();

// Update the transaction observer (around line 568-570)
sync.outline.on('afterAllTransactions', (transaction: Y.Transaction) => {
  const origin = transaction.origin as SyncOrigin | null;
  
  if (transaction.changed.size === 0) {
    return;
  }

  // Track what changed in this transaction
  if (transaction.changed.has(sync.outline.nodes)) {
    const changedNodeIds = Array.from(transaction.changed.get(sync.outline.nodes)?.keys() || []);
    snapshotTracker.markNodesChanged(changedNodeIds);
  }

  if (transaction.changed.has(sync.outline.edges)) {
    const changedEdgeIds = Array.from(transaction.changed.get(sync.outline.edges)?.keys() || []);
    snapshotTracker.markEdgesChanged(changedEdgeIds);
  }

  if (transaction.changed.has(sync.outline.roots)) {
    snapshotTracker.markStructuralChange();
  }

  // Check if any node's childIds array changed (structural)
  for (const [nodeId, changes] of transaction.changed.entries()) {
    if (changes.has('childIds')) {
      snapshotTracker.markStructuralChange();
      break;
    }
  }

  // CRITICAL: Incremental update instead of full rebuild
  const changeSet = snapshotTracker.createChangeSet();
  snapshot = updateSnapshotIncremental(snapshot, sync.outline, changeSet);
  notify();

  // Reconcile if needed
  const updates = reconcileOutlineStructure(sync.outline, { origin });
  if (updates > 0) {
    // Mark as structural change and rebuild
    snapshotTracker.markStructuralChange();
    const reconcileChangeSet = snapshotTracker.createChangeSet();
    snapshot = updateSnapshotIncremental(snapshot, sync.outline, reconcileChangeSet);
    notify();
  }
});
```

TESTS TO ADD:
Add to packages/client-core/src/doc/snapshots.test.ts:
- Test text-only changes use fast path and reuse edges/roots
- Test edge-only changes (collapse) reuse nodes/roots
- Test structural changes trigger full rebuild
- Test multiple incremental updates maintain consistency
- Test memory: verify object references are reused when unchanged
- Test performance: text update on 1000-node tree should be <5ms

PERFORMANCE VALIDATION:
Create a performance test:
```typescript
it('incremental update is 10x faster than full rebuild for text changes', () => {
  const outline = createLargeOutline(10000); // 10k nodes
  const snapshot = createOutlineSnapshot(outline);
  const tracker = new SnapshotChangeTracker();
  
  // Change 10 nodes (0.1% of tree)
  const changedNodes = [nodeId1, nodeId2, ...]; // 10 nodes
  tracker.markNodesChanged(changedNodes);
  const changeSet = tracker.createChangeSet();
  
  const start = performance.now();
  const incrementalSnapshot = updateSnapshotIncremental(snapshot, outline, changeSet);
  const incrementalTime = performance.now() - start;
  
  const fullStart = performance.now();
  const fullSnapshot = createOutlineSnapshot(outline);
  const fullTime = performance.now() - fullStart;
  
  expect(incrementalTime).toBeLessThan(fullTime / 5); // At least 5x faster
  expect(incrementalTime).toBeLessThan(10); // <10ms absolute
});
```

VALIDATION:
- Run: npm run typecheck
- Run: npm run test packages/client-core/src/doc/snapshots.test.ts
- Run: npm run test packages/client-core/src/outlineStore/store.test.ts
- Verify: Performance test passes (incremental is 5x+ faster)
- Verify: No AGENTS.md violations (Yjs transactions intact)
- Manual: Test in web app with large outline (5k+ nodes), verify smooth editing

ALIGNMENT WITH AGENTS.md:
- Rule 7: Eliminates heavy computation on every update (200ms → 20ms)
- Rule 33: Efficient data structures (structural sharing)
- Rule 39: Incremental change, maintains backward compatibility
```

---

### Step 1.3: Optimize flushPendingNodeRefresh to Avoid Full Map Clone

**Priority:** CRITICAL  
**Estimated Time:** 2-3 hours  
**Dependencies:** Step 1.2 completed

#### LLM Prompt:

```
Optimize flushPendingNodeRefresh() to avoid cloning the entire node map on every text edit. Currently it copies all 100k+ nodes to update just a few changed ones.

REQUIREMENTS:
1. Update only changed nodes without full map clone
2. Maintain immutability for React reconciliation
3. Preserve snapshot version consistency
4. Add performance tests showing improvement
5. Ensure Yjs transaction patterns remain intact (AGENTS rule 3)

FILES TO MODIFY:
- packages/client-core/src/outlineStore/store.ts (around line 198)

IMPLEMENTATION DETAILS:

In packages/client-core/src/outlineStore/store.ts, replace flushPendingNodeRefresh:

```typescript
/**
 * Efficiently updates snapshot with pending node text changes.
 * Only clones the nodes Map once and patches changed entries.
 * 
 * Performance: O(changed nodes) instead of O(all nodes)
 * Memory: Single shallow Map clone instead of multiple clones
 * 
 * CRITICAL: This function is called after every text edit batch.
 * With 100k nodes, the old approach (full map clone per node) caused
 * severe keystroke lag. The new approach clones once and patches N times.
 */
function flushPendingNodeRefresh(
  currentSnapshot: OutlineSnapshot,
  pendingNodeIds: Set<NodeId>,
  outline: OutlineDoc,
  tracker: SnapshotChangeTracker
): OutlineSnapshot {
  if (pendingNodeIds.size === 0) {
    return currentSnapshot;
  }

  // Single shallow clone of the nodes Map
  const updatedNodes = new Map(currentSnapshot.nodes);

  // Update only the changed nodes
  for (const nodeId of pendingNodeIds) {
    const yNode = outline.nodes.get(nodeId);
    if (yNode) {
      const currentNode = currentSnapshot.nodes.get(nodeId);
      if (currentNode) {
        // Patch this node's text
        updatedNodes.set(nodeId, {
          ...currentNode,
          text: yNode.get('text') || ''
        });
      }
    }
  }

  // Track these changes for next transaction
  tracker.markNodesChanged(pendingNodeIds);

  // Clear pending set
  pendingNodeIds.clear();

  // Return new snapshot with updated version
  return {
    nodes: updatedNodes,
    edges: currentSnapshot.edges,    // Reuse unchanged
    roots: currentSnapshot.roots,     // Reuse unchanged
    version: currentSnapshot.version + 1
  };
}
```

Update the call site to use the optimized function:

```typescript
// In the text editor handler (around line 198)
const flushNodeRefresh = () => {
  if (pendingNodeRefresh.size === 0) return;
  
  snapshot = flushPendingNodeRefresh(
    snapshot,
    pendingNodeRefresh,
    sync.outline,
    snapshotTracker
  );
  notify();
};
```

TESTS TO ADD:
Add to packages/client-core/src/outlineStore/store.test.ts:

```typescript
describe('flushPendingNodeRefresh optimization', () => {
  it('updates only changed nodes without full map clone', () => {
    const store = createOutlineStore();
    const [node1, node2, node3] = addNodes(store, 3);
    const snapshot1 = store.getSnapshot();
    
    // Edit node1 text
    store.updateNodeText(node1.id, 'Updated text');
    const snapshot2 = store.getSnapshot();
    
    // Verify: node1 changed, node2/node3 reused (same reference)
    expect(snapshot2.nodes.get(node1.id)).not.toBe(snapshot1.nodes.get(node1.id));
    expect(snapshot2.nodes.get(node2.id)).toBe(snapshot1.nodes.get(node2.id)); // Same ref
    expect(snapshot2.nodes.get(node3.id)).toBe(snapshot1.nodes.get(node3.id)); // Same ref
    
    // Verify: edges and roots reused
    expect(snapshot2.edges).toBe(snapshot1.edges); // Same ref
    expect(snapshot2.roots).toBe(snapshot1.roots); // Same ref
  });

  it('handles multiple pending changes efficiently', () => {
    const store = createOutlineStore();
    const nodes = addNodes(store, 1000);
    
    // Edit 10 nodes
    const editedNodes = nodes.slice(0, 10);
    for (const node of editedNodes) {
      store.updateNodeText(node.id, `Updated ${node.id}`);
    }
    
    const snapshot = store.getSnapshot();
    
    // Verify: only 10 nodes updated, 990 reused
    let changedCount = 0;
    for (const node of nodes) {
      const snapshotNode = snapshot.nodes.get(node.id);
      if (editedNodes.includes(node)) {
        expect(snapshotNode?.text).toContain('Updated');
        changedCount++;
      }
    }
    expect(changedCount).toBe(10);
  });

  it('is at least 50x faster than full rebuild for small changes', () => {
    const store = createOutlineStore();
    addNodes(store, 10000); // 10k nodes
    
    // Measure time to update 5 nodes
    const start = performance.now();
    for (let i = 0; i < 5; i++) {
      const nodeId = store.getSnapshot().nodes.keys().next().value;
      store.updateNodeText(nodeId, `Updated ${i}`);
    }
    const optimizedTime = performance.now() - start;
    
    // This should be < 5ms for 5 text edits on 10k tree
    expect(optimizedTime).toBeLessThan(5);
  });
});
```

VALIDATION:
- Run: npm run typecheck
- Run: npm run test packages/client-core/src/outlineStore/store.test.ts
- Verify: Performance tests pass (<5ms for text edits)
- Verify: Object reference reuse tests pass
- Manual: Test typing speed in large outline (5k+ nodes), verify no lag

ALIGNMENT WITH AGENTS.md:
- Rule 7: Avoid heavy computations on every update (eliminates O(n) per keystroke)
- Rule 25: Performance optimization, stable node IDs
- Rule 33: Efficient data structures (structural sharing)
```

---

## PHASE 2: ROW BUILDING MEMOIZATION

### Step 2.1: Add Memoization to buildPaneRows

**Priority:** CRITICAL  
**Estimated Time:** 2-3 hours  
**Dependencies:** Phase 1 completed

#### LLM Prompt:

```
Add React memoization to buildPaneRows to prevent unnecessary recalculations. Currently rebuilds entire row structure on every pane state change, causing 50ms+ frame drops.

REQUIREMENTS:
1. Wrap buildPaneRows with useMemo in React components
2. Add proper dependency arrays based on pane state
3. Leverage snapshot version for cache invalidation
4. Maintain pure function behavior (no side effects)
5. Add tests verifying memoization effectiveness

FILES TO MODIFY:
- apps/web/src/outline/hooks/useOutlineRows.ts (or create if needed)
- packages/client-react/src/outline/useOutlineRows.ts

IMPLEMENTATION DETAILS:

In packages/client-react/src/outline/useOutlineRows.ts, add memoized hook:

```typescript
import { useMemo } from 'react';
import { buildPaneRows, type OutlineSnapshot, type SessionPaneState } from '@thortiq/client-core';

/**
 * Memoized hook for building pane rows from snapshot.
 * 
 * Performance optimization: Only rebuilds rows when relevant pane state changes.
 * Uses snapshot.version as primary cache key for efficient invalidation.
 * 
 * Alignment with AGENTS.md:
 * - Rule 7: Avoids heavy computation on every render
 * - Rule 9: Composition over inheritance (small composable hook)
 * - Rule 17: Pure function, no side effects
 */
export function useOutlineRows(
  snapshot: OutlineSnapshot,
  paneState: SessionPaneState
) {
  return useMemo(() => {
    // buildPaneRows is expensive (O(n) traversal)
    // Only recompute when dependencies actually change
    return buildPaneRows(snapshot, paneState);
  }, [
    // Primary cache key: snapshot version changes on any edit
    snapshot.version,
    
    // Secondary keys: pane-specific state
    paneState.rootEdgeId,
    paneState.focusPathEdgeIds,
    
    // For arrays/objects, need stable references or serialization
    // Using JSON.stringify for collapsed edges (typically small set)
    JSON.stringify(paneState.collapsedEdgeIds),
    
    // Quick filter changes require rebuild
    paneState.quickFilter?.query,
    paneState.quickFilter?.scope
  ]);
}

/**
 * More granular memoization for focus-filtered rows.
 * Only rebuilds when focus path or version changes.
 */
export function useFocusRows(
  snapshot: OutlineSnapshot,
  focusPathEdgeIds: readonly string[]
) {
  return useMemo(() => {
    return buildPaneRows(snapshot, {
      rootEdgeId: null,
      focusPathEdgeIds,
      collapsedEdgeIds: [],
      quickFilter: null
    });
  }, [
    snapshot.version,
    // Focus path is typically small, JSON.stringify is acceptable
    JSON.stringify(focusPathEdgeIds)
  ]);
}
```

ALTERNATIVE: If JSON.stringify on collapsedEdgeIds is expensive (large sets), use deep comparison:

```typescript
import { useMemo, useRef } from 'react';

function useDeepCompareMemo<T>(factory: () => T, deps: readonly unknown[]): T {
  const ref = useRef<{ deps: readonly unknown[], value: T }>();

  if (!ref.current || !deepEqual(ref.current.deps, deps)) {
    ref.current = { deps, value: factory() };
  }

  return ref.current.value;
}

function deepEqual(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (Array.isArray(a[i]) && Array.isArray(b[i])) {
      if (!deepEqual(a[i] as readonly unknown[], b[i] as readonly unknown[])) {
        return false;
      }
    } else if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

export function useOutlineRows(
  snapshot: OutlineSnapshot,
  paneState: SessionPaneState
) {
  return useDeepCompareMemo(() => {
    return buildPaneRows(snapshot, paneState);
  }, [
    snapshot.version,
    paneState.rootEdgeId,
    paneState.focusPathEdgeIds,
    paneState.collapsedEdgeIds,
    paneState.quickFilter?.query,
    paneState.quickFilter?.scope
  ]);
}
```

Update consuming components to use the hook:

```typescript
// In apps/web/src/outline/OutlineView.tsx
import { useOutlineRows } from './hooks/useOutlineRows';

function OutlineView({ paneId }: { paneId: string }) {
  const snapshot = useOutlineSnapshot();
  const paneState = usePaneState(paneId);
  
  // Memoized: only rebuilds when snapshot or relevant pane state changes
  const rows = useOutlineRows(snapshot, paneState);
  
  // ... rest of component
}
```

TESTS TO ADD:
Add to packages/client-react/src/outline/__tests__/useOutlineRows.test.tsx:

```typescript
import { renderHook } from '@testing-library/react';
import { useOutlineRows } from '../useOutlineRows';

describe('useOutlineRows memoization', () => {
  it('returns same reference when dependencies unchanged', () => {
    const snapshot = createTestSnapshot();
    const paneState = createTestPaneState();
    
    const { result, rerender } = renderHook(() =>
      useOutlineRows(snapshot, paneState)
    );
    
    const firstResult = result.current;
    rerender();
    const secondResult = result.current;
    
    // Same reference = memoization working
    expect(firstResult).toBe(secondResult);
  });

  it('rebuilds when snapshot version changes', () => {
    const snapshot1 = createTestSnapshot({ version: 1 });
    const snapshot2 = createTestSnapshot({ version: 2 });
    const paneState = createTestPaneState();
    
    const { result, rerender } = renderHook(
      ({ snapshot }) => useOutlineRows(snapshot, paneState),
      { initialProps: { snapshot: snapshot1 } }
    );
    
    const firstResult = result.current;
    
    rerender({ snapshot: snapshot2 });
    const secondResult = result.current;
    
    // Different reference = rebuild triggered
    expect(firstResult).not.toBe(secondResult);
  });

  it('rebuilds when collapsed edges change', () => {
    const snapshot = createTestSnapshot();
    const paneState1 = createTestPaneState({ collapsedEdgeIds: ['edge1'] });
    const paneState2 = createTestPaneState({ collapsedEdgeIds: ['edge1', 'edge2'] });
    
    const { result, rerender } = renderHook(
      ({ paneState }) => useOutlineRows(snapshot, paneState),
      { initialProps: { paneState: paneState1 } }
    );
    
    const firstResult = result.current;
    rerender({ paneState: paneState2 });
    const secondResult = result.current;
    
    expect(firstResult).not.toBe(secondResult);
  });

  it('does not rebuild when unrelated state changes', () => {
    const snapshot = createTestSnapshot();
    const paneState = createTestPaneState();
    
    const { result, rerender } = renderHook(
      ({ unrelated }) => useOutlineRows(snapshot, paneState),
      { initialProps: { unrelated: 1 } }
    );
    
    const firstResult = result.current;
    rerender({ unrelated: 2 }); // Change prop that's not a dependency
    const secondResult = result.current;
    
    // Should still be same reference
    expect(firstResult).toBe(secondResult);
  });

  it('prevents unnecessary renders with large trees', () => {
    const snapshot = createLargeTestSnapshot(5000); // 5k nodes
    const paneState = createTestPaneState();
    
    let buildCount = 0;
    const mockBuildPaneRows = vi.fn(() => {
      buildCount++;
      return [];
    });
    
    const { rerender } = renderHook(() =>
      useOutlineRows(snapshot, paneState)
    );
    
    const initialCount = buildCount;
    
    // Trigger 10 re-renders with no dependency changes
    for (let i = 0; i < 10; i++) {
      rerender();
    }
    
    // buildPaneRows should only be called once (memoized)
    expect(buildCount).toBe(initialCount);
  });
});
```

VALIDATION:
- Run: npm run typecheck
- Run: npm run test packages/client-react/src/outline/__tests__/useOutlineRows.test.tsx
- Verify: Memoization tests pass (same reference when deps unchanged)
- Manual: Test scrolling in large outline (5k+ nodes), verify 60fps

ALIGNMENT WITH AGENTS.md:
- Rule 7: Avoids heavy computations on every update
- Rule 9: Composition over inheritance (composable hooks)
- Rule 17: Pure function, no side effects in hook
- Rule 33: Efficient data structures (memoization cache)
```

---

## PHASE 3: SEARCH OPTIMIZATION

### Step 3.1: Implement Parent-Edge Index for Ancestor Resolution

**Priority:** HIGH  
**Estimated Time:** 2-3 hours  
**Dependencies:** Phase 1 completed

#### LLM Prompt:

```
Create a parent-edge index during snapshot creation to eliminate O(n²) ancestor resolution in search. Currently getAncestors() scans all edges for each ancestor hop.

REQUIREMENTS:
1. Add parent-edge map to OutlineSnapshot
2. Build index during snapshot creation (one-time O(n) cost)
3. Update getAncestors() to use O(1) lookups
4. Maintain immutability and Yjs patterns
5. Add tests verifying correctness and performance

FILES TO MODIFY:
- packages/client-core/src/types.ts
- packages/client-core/src/doc/snapshots.ts
- packages/client-core/src/selectors.ts

IMPLEMENTATION DETAILS:

In packages/client-core/src/types.ts, extend OutlineSnapshot:

```typescript
export interface OutlineSnapshot {
  readonly nodes: ReadonlyMap<NodeId, OutlineNodeRecord>;
  readonly edges: ReadonlyMap<EdgeId, OutlineEdgeRecord>;
  readonly roots: ReadonlyArray<EdgeId>;
  readonly version: number;
  readonly parentEdgeIndex: ReadonlyMap<NodeId, EdgeId>; // NEW: child -> parent edge
}
```

In packages/client-core/src/doc/snapshots.ts, update createOutlineSnapshot:

```typescript
/**
 * Creates immutable snapshot with parent-edge index for fast ancestor lookups.
 * 
 * Performance: Builds index in O(n) during snapshot creation, enables O(1)
 * parent lookups instead of O(n) edge scans.
 */
export function createOutlineSnapshot(outline: OutlineDoc): OutlineSnapshot {
  const nodes = new Map<NodeId, OutlineNodeRecord>();
  const edges = new Map<EdgeId, OutlineEdgeRecord>();
  const parentEdgeIndex = new Map<NodeId, EdgeId>(); // NEW

  // Build nodes map
  outline.nodes.forEach((yNode, nodeId) => {
    nodes.set(nodeId, {
      id: nodeId,
      text: yNode.get('text') || '',
      childIds: yNode.get('childIds')?.toArray() || []
    });
  });

  // Build edges map AND parent-edge index simultaneously
  outline.edges.forEach((yEdge, edgeId) => {
    const parentId = yEdge.get('parentId');
    const childId = yEdge.get('childId');
    const collapsed = yEdge.get('collapsed') || false;

    edges.set(edgeId, {
      id: edgeId,
      parentId,
      childId,
      collapsed
    });

    // Index: child -> parent edge (for fast ancestor resolution)
    if (childId) {
      parentEdgeIndex.set(childId, edgeId);
    }
  });

  const roots = outline.roots.toArray();

  return {
    nodes,
    edges,
    roots,
    parentEdgeIndex, // NEW
    version: 0 // Will be set by change tracker
  };
}
```

Update incremental snapshot updates to maintain the index:

```typescript
export function updateSnapshotIncremental(
  previousSnapshot: OutlineSnapshot,
  outline: OutlineDoc,
  changeSet: SnapshotChangeSet
): OutlineSnapshot {
  // ... existing fast paths for text-only changes

  // STRUCTURAL CHANGES: Rebuild parent index
  if (changeSet.structuralChange) {
    const fullSnapshot = createOutlineSnapshot(outline);
    return {
      ...fullSnapshot,
      version: changeSet.version
    };
  }

  // EDGE CHANGES: Update parent index if edges changed
  if (changeSet.changedEdgeIds.size > 0) {
    const updatedEdges = new Map(previousSnapshot.edges);
    const updatedParentIndex = new Map(previousSnapshot.parentEdgeIndex);

    for (const edgeId of changeSet.changedEdgeIds) {
      const yEdge = outline.edges.get(edgeId);
      const oldEdge = previousSnapshot.edges.get(edgeId);

      if (yEdge) {
        const childId = yEdge.get('childId');
        
        // Update edge
        updatedEdges.set(edgeId, {
          id: edgeId,
          parentId: yEdge.get('parentId'),
          childId,
          collapsed: yEdge.get('collapsed') || false
        });

        // Update parent index if child changed
        if (childId !== oldEdge?.childId) {
          if (oldEdge?.childId) {
            updatedParentIndex.delete(oldEdge.childId);
          }
          if (childId) {
            updatedParentIndex.set(childId, edgeId);
          }
        }
      } else if (oldEdge) {
        // Edge deleted
        updatedEdges.delete(edgeId);
        if (oldEdge.childId) {
          updatedParentIndex.delete(oldEdge.childId);
        }
      }
    }

    return {
      ...previousSnapshot,
      edges: updatedEdges,
      parentEdgeIndex: updatedParentIndex,
      version: changeSet.version
    };
  }

  return previousSnapshot;
}
```

In packages/client-core/src/selectors.ts, optimize getAncestors:

```typescript
/**
 * Gets ancestor path from node to root using parent-edge index.
 * 
 * Performance: O(depth) instead of O(n * depth) via O(1) parent lookups.
 * 
 * @param snapshot - Snapshot with parent-edge index
 * @param nodeId - Starting node
 * @returns Array of ancestor edges from root to immediate parent
 */
export function getAncestors(
  snapshot: OutlineSnapshot,
  nodeId: NodeId
): EdgeId[] {
  const ancestors: EdgeId[] = [];
  let currentNodeId: NodeId | null = nodeId;

  // Walk up parent chain using index (O(1) lookup per level)
  while (currentNodeId) {
    const parentEdgeId = snapshot.parentEdgeIndex.get(currentNodeId);
    if (!parentEdgeId) break;

    ancestors.unshift(parentEdgeId); // Build path from root down

    const parentEdge = snapshot.edges.get(parentEdgeId);
    if (!parentEdge) break;

    currentNodeId = parentEdge.parentId;
  }

  return ancestors;
}
```

TESTS TO ADD:
Add to packages/client-core/src/selectors.test.ts:

```typescript
describe('getAncestors with parent-edge index', () => {
  it('returns correct ancestor path', () => {
    // Create tree: root -> A -> B -> C
    const outline = createTestOutline();
    const rootEdge = addRootNode(outline, 'Root');
    const edgeA = addChild(outline, rootEdge.childId, 'A');
    const edgeB = addChild(outline, edgeA.childId, 'B');
    const edgeC = addChild(outline, edgeB.childId, 'C');
    
    const snapshot = createOutlineSnapshot(outline);
    const ancestors = getAncestors(snapshot, edgeC.childId);
    
    expect(ancestors).toEqual([rootEdge.id, edgeA.id, edgeB.id]);
  });

  it('returns empty array for root node', () => {
    const outline = createTestOutline();
    const rootEdge = addRootNode(outline, 'Root');
    
    const snapshot = createOutlineSnapshot(outline);
    const ancestors = getAncestors(snapshot, rootEdge.childId);
    
    expect(ancestors).toEqual([]);
  });

  it('handles deep hierarchies efficiently', () => {
    // Create deep tree: 100 levels
    const outline = createTestOutline();
    let currentEdge = addRootNode(outline, 'Root');
    
    for (let i = 0; i < 100; i++) {
      currentEdge = addChild(outline, currentEdge.childId, `Level ${i}`);
    }
    
    const snapshot = createOutlineSnapshot(outline);
    
    const start = performance.now();
    const ancestors = getAncestors(snapshot, currentEdge.childId);
    const time = performance.now() - start;
    
    expect(ancestors.length).toBe(100);
    expect(time).toBeLessThan(1); // <1ms even for 100-level depth
  });

  it('parent index is correctly maintained after structural changes', () => {
    const outline = createTestOutline();
    const root = addRootNode(outline, 'Root');
    const childA = addChild(outline, root.childId, 'A');
    const childB = addChild(outline, root.childId, 'B');
    
    let snapshot = createOutlineSnapshot(outline);
    
    // Move B under A
    moveNode(outline, childB.childId, childA.childId);
    snapshot = createOutlineSnapshot(outline);
    
    // B's parent should now be A
    const ancestorsB = getAncestors(snapshot, childB.childId);
    expect(ancestorsB).toContain(childA.id);
  });
});

describe('buildSearchRows performance with parent index', () => {
  it('is 10x faster for broad searches with deep hierarchies', () => {
    // Create tree: 1000 nodes, average depth 10
    const outline = createDeepTestOutline(1000, 10);
    const snapshot = createOutlineSnapshot(outline);
    
    const start = performance.now();
    const results = buildSearchRows(snapshot, { query: 'test', maxResults: 100 });
    const time = performance.now() - start;
    
    // With parent index, should be <10ms even for 100 results
    expect(time).toBeLessThan(10);
    expect(results.length).toBeGreaterThan(0);
  });
});
```

VALIDATION:
- Run: npm run typecheck
- Run: npm run test packages/client-core/src/selectors.test.ts
- Verify: Ancestor tests pass with correct paths
- Verify: Performance tests pass (<1ms for deep hierarchies)
- Manual: Test search performance in large outline with deep trees

ALIGNMENT WITH AGENTS.md:
- Rule 7: Eliminates heavy O(n) scans on every ancestor lookup
- Rule 30: Enables efficient search without degradation
- Rule 33: Efficient data structures (index for O(1) lookups)
```

---

### Step 3.2: Implement Debounced Search Index for Wiki Links

**Priority:** HIGH  
**Estimated Time:** 4-5 hours  
**Dependencies:** Phase 1 completed, Step 3.1 completed

#### LLM Prompt:

```
Implement a debounced search index for wiki link lookups to eliminate O(n) scans on every keystroke. Currently searchWikiLinkCandidates() iterates all nodes per query.

REQUIREMENTS:
1. Create SearchIndex class with text, path, and tag indexes
2. Build index incrementally using SnapshotChangeTracker
3. Debounce index updates to avoid main thread blocking
4. Implement fast O(log n) search using indexed lookups
5. Maintain AGENTS.md rule 30 (debounce non-critical operations)
6. Add comprehensive tests

FILES TO CREATE/MODIFY:
- packages/client-core/src/search/index.ts (new file)
- packages/client-core/src/wiki/search.ts
- packages/client-core/src/outlineStore/store.ts

IMPLEMENTATION DETAILS:

Create packages/client-core/src/search/searchIndex.ts:

```typescript
/**
 * Search index for fast text, path, and tag lookups.
 * 
 * Performance: O(log n) search via tokenized indexes instead of O(n) full scan.
 * Updates: Incremental, debounced to avoid blocking main thread.
 * 
 * Alignment with AGENTS.md:
 * - Rule 30: Debounced updates (non-critical operation)
 * - Rule 31: Lazy loading (index built on-demand)
 * - Rule 33: Efficient data structures (Map-based indexes)
 */

export interface SearchIndex {
  /** Token -> Set of NodeIds containing that token */
  readonly textIndex: ReadonlyMap<string, ReadonlySet<NodeId>>;
  
  /** Path segment -> Set of NodeIds in that path */
  readonly pathIndex: ReadonlyMap<string, ReadonlySet<NodeId>>;
  
  /** Tag -> Set of NodeIds with that tag */
  readonly tagIndex: ReadonlyMap<string, ReadonlySet<NodeId>>;
  
  /** Snapshot version this index was built from */
  readonly version: number;
}

export interface SearchIndexOptions {
  /** Minimum token length to index (default: 2) */
  minTokenLength?: number;
  
  /** Maximum tokens per node to index (default: 100) */
  maxTokensPerNode?: number;
  
  /** Debounce delay for index updates in ms (default: 300) */
  debounceMs?: number;
}

/**
 * Tokenizes text into searchable tokens.
 * Lowercases, splits on word boundaries, filters short tokens.
 */
function tokenizeText(text: string, minLength: number = 2): string[] {
  return text
    .toLowerCase()
    .split(/[\s\-_\/\.\,\;\:\!\?\(\)\[\]\{\}]+/)
    .filter(token => token.length >= minLength);
}

/**
 * Builds a complete search index from a snapshot.
 */
export function buildSearchIndex(
  snapshot: OutlineSnapshot,
  options: SearchIndexOptions = {}
): SearchIndex {
  const {
    minTokenLength = 2,
    maxTokensPerNode = 100
  } = options;

  const textIndex = new Map<string, Set<NodeId>>();
  const pathIndex = new Map<string, Set<NodeId>>();
  const tagIndex = new Map<string, Set<NodeId>>();

  // Index all nodes
  snapshot.nodes.forEach((node, nodeId) => {
    // Index text tokens
    const tokens = tokenizeText(node.text, minTokenLength);
    const limitedTokens = tokens.slice(0, maxTokensPerNode);
    
    for (const token of limitedTokens) {
      if (!textIndex.has(token)) {
        textIndex.set(token, new Set());
      }
      textIndex.get(token)!.add(nodeId);
    }

    // Index path segments (for wiki link paths)
    const pathSegments = node.text.split('/').map(s => s.trim().toLowerCase());
    for (const segment of pathSegments) {
      if (segment.length >= minTokenLength) {
        if (!pathIndex.has(segment)) {
          pathIndex.set(segment, new Set());
        }
        pathIndex.get(segment)!.add(nodeId);
      }
    }

    // Index tags (e.g., #tag)
    const tags = node.text.match(/#\w+/g) || [];
    for (const tag of tags) {
      const normalizedTag = tag.toLowerCase();
      if (!tagIndex.has(normalizedTag)) {
        tagIndex.set(normalizedTag, new Set());
      }
      tagIndex.get(normalizedTag)!.add(nodeId);
    }
  });

  return {
    textIndex: new Map(textIndex),
    pathIndex: new Map(pathIndex),
    tagIndex: new Map(tagIndex),
    version: snapshot.version
  };
}

/**
 * Updates search index incrementally for changed nodes.
 * Only re-indexes nodes that changed, reuses existing index data.
 */
export function updateSearchIndexIncremental(
  previousIndex: SearchIndex,
  snapshot: OutlineSnapshot,
  changedNodeIds: ReadonlySet<NodeId>,
  options: SearchIndexOptions = {}
): SearchIndex {
  const {
    minTokenLength = 2,
    maxTokensPerNode = 100
  } = options;

  // Clone indexes for mutation
  const textIndex = new Map(previousIndex.textIndex);
  const pathIndex = new Map(previousIndex.pathIndex);
  const tagIndex = new Map(previousIndex.tagIndex);

  // Remove old entries for changed nodes
  for (const [token, nodeIds] of textIndex.entries()) {
    const updatedNodeIds = new Set(nodeIds);
    let changed = false;
    for (const changedId of changedNodeIds) {
      if (updatedNodeIds.has(changedId)) {
        updatedNodeIds.delete(changedId);
        changed = true;
      }
    }
    if (changed) {
      if (updatedNodeIds.size === 0) {
        textIndex.delete(token);
      } else {
        textIndex.set(token, updatedNodeIds);
      }
    }
  }

  // Same for path and tag indexes (omitted for brevity, same pattern)
  // ...

  // Re-index changed nodes
  for (const nodeId of changedNodeIds) {
    const node = snapshot.nodes.get(nodeId);
    if (!node) continue; // Node deleted

    const tokens = tokenizeText(node.text, minTokenLength);
    const limitedTokens = tokens.slice(0, maxTokensPerNode);
    
    for (const token of limitedTokens) {
      if (!textIndex.has(token)) {
        textIndex.set(token, new Set());
      }
      textIndex.get(token)!.add(nodeId);
    }

    // Re-index paths and tags (same pattern)
    // ...
  }

  return {
    textIndex,
    pathIndex,
    tagIndex,
    version: snapshot.version
  };
}

/**
 * Searches index for nodes matching query tokens.
 * Returns intersection of all token matches for AND semantics.
 */
export function searchIndex(
  index: SearchIndex,
  query: string,
  options: { maxResults?: number } = {}
): NodeId[] {
  const { maxResults = 100 } = options;

  const queryTokens = tokenizeText(query);
  if (queryTokens.length === 0) return [];

  // Get node sets for each token
  const tokenMatches: Set<NodeId>[] = [];
  for (const token of queryTokens) {
    const matches = index.textIndex.get(token);
    if (!matches || matches.size === 0) {
      // No matches for this token = no results (AND semantics)
      return [];
    }
    tokenMatches.push(new Set(matches));
  }

  // Intersect all token matches
  const [first, ...rest] = tokenMatches;
  const results = new Set(first);
  
  for (const match of rest) {
    for (const nodeId of results) {
      if (!match.has(nodeId)) {
        results.delete(nodeId);
      }
    }
  }

  // Convert to array and limit
  return Array.from(results).slice(0, maxResults);
}
```

Update packages/client-core/src/wiki/search.ts to use index:

```typescript
import { searchIndex, type SearchIndex } from '../search/searchIndex';

/**
 * Searches wiki link candidates using search index.
 * Falls back to linear scan if index not available.
 * 
 * Performance: O(log n) with index vs O(n) without
 */
export function searchWikiLinkCandidates(
  snapshot: OutlineSnapshot,
  query: string,
  options: WikiLinkSearchOptions = {},
  searchIdx?: SearchIndex // Optional: use index if available
): WikiLinkSearchCandidate[] {
  const { maxResults = 20, excludeNodeIds = [] } = options;

  // Fast path: use search index if available and up-to-date
  if (searchIdx && searchIdx.version === snapshot.version) {
    const nodeIds = searchIndex(searchIdx, query, { maxResults: maxResults * 2 });
    
    return nodeIds
      .filter(id => !excludeNodeIds.includes(id))
      .slice(0, maxResults)
      .map(nodeId => {
        const node = snapshot.nodes.get(nodeId);
        const path = computeNodePath(snapshot, nodeId); // Uses parent-edge index from 3.1
        return {
          nodeId,
          text: node?.text || '',
          path,
          score: computeRelevanceScore(node?.text || '', query)
        };
      })
      .sort((a, b) => b.score - a.score);
  }

  // Slow path: fallback to linear scan (original implementation)
  // Keep this for backward compatibility and when index not ready
  return searchWikiLinkCandidatesSlow(snapshot, query, options);
}
```

Integrate into outlineStore with debouncing:

```typescript
// In packages/client-core/src/outlineStore/store.ts

import { buildSearchIndex, updateSearchIndexIncremental, type SearchIndex } from '../search/searchIndex';

interface OutlineStoreState {
  // ... existing fields
  searchIndex: SearchIndex | null;
  indexRebuildPending: boolean;
}

let indexRebuildTimer: NodeJS.Timeout | null = null;
const INDEX_DEBOUNCE_MS = 300;

const scheduleIndexRebuild = () => {
  state.indexRebuildPending = true;
  
  if (indexRebuildTimer) {
    clearTimeout(indexRebuildTimer);
  }

  indexRebuildTimer = setTimeout(() => {
    if (state.indexRebuildPending) {
      // Build index off main thread if possible (or just debounced)
      state.searchIndex = buildSearchIndex(snapshot);
      state.indexRebuildPending = false;
      notify();
    }
  }, INDEX_DEBOUNCE_MS);
};

// In transaction observer
sync.outline.on('afterAllTransactions', (transaction) => {
  // ... existing snapshot update logic

  // Schedule index rebuild (debounced)
  if (transaction.changed.has(sync.outline.nodes)) {
    scheduleIndexRebuild();
  }
});

// Add getter for search index
getSearchIndex(): SearchIndex | null {
  return state.searchIndex;
}
```

TESTS TO ADD:
Create packages/client-core/src/search/__tests__/searchIndex.test.ts:

```typescript
describe('SearchIndex', () => {
  it('builds index with correct token mappings', () => {
    const outline = createTestOutline();
    addNode(outline, 'Hello World');
    addNode(outline, 'World Peace');
    addNode(outline, 'Hello Peace');
    
    const snapshot = createOutlineSnapshot(outline);
    const index = buildSearchIndex(snapshot);
    
    expect(index.textIndex.get('hello')?.size).toBe(2);
    expect(index.textIndex.get('world')?.size).toBe(2);
    expect(index.textIndex.get('peace')?.size).toBe(2);
  });

  it('searches with AND semantics (all tokens must match)', () => {
    const outline = createTestOutline();
    const node1 = addNode(outline, 'React performance optimization');
    const node2 = addNode(outline, 'React component testing');
    const node3 = addNode(outline, 'Performance testing tools');
    
    const snapshot = createOutlineSnapshot(outline);
    const index = buildSearchIndex(snapshot);
    
    const results = searchIndex(index, 'react performance');
    expect(results).toEqual([node1.id]); // Only node1 has both tokens
  });

  it('updates incrementally for changed nodes', () => {
    const outline = createTestOutline();
    const node1 = addNode(outline, 'Original text');
    
    let snapshot = createOutlineSnapshot(outline);
    let index = buildSearchIndex(snapshot);
    
    expect(index.textIndex.get('original')).toBeDefined();
    
    // Update node text
    updateNodeText(outline, node1.id, 'Updated text');
    snapshot = createOutlineSnapshot(outline);
    
    index = updateSearchIndexIncremental(
      index,
      snapshot,
      new Set([node1.id])
    );
    
    expect(index.textIndex.get('original')).toBeUndefined();
    expect(index.textIndex.get('updated')).toBeDefined();
  });

  it('is 100x faster than linear search for large trees', () => {
    const outline = createLargeOutline(10000);
    const snapshot = createOutlineSnapshot(outline);
    
    // Build index once
    const buildStart = performance.now();
    const index = buildSearchIndex(snapshot);
    const buildTime = performance.now() - buildStart;
    
    // Indexed search
    const indexStart = performance.now();
    const indexedResults = searchIndex(index, 'test query');
    const indexTime = performance.now() - indexStart;
    
    // Linear search (old approach)
    const linearStart = performance.now();
    const linearResults = searchWikiLinkCandidatesSlow(snapshot, 'test query');
    const linearTime = performance.now() - linearStart;
    
    console.log(`Build: ${buildTime}ms, Indexed: ${indexTime}ms, Linear: ${linearTime}ms`);
    
    // Indexed search should be at least 10x faster
    expect(indexTime).toBeLessThan(linearTime / 10);
    expect(indexTime).toBeLessThan(5); // <5ms absolute
  });

  it('handles debounced updates without blocking', async () => {
    const store = createOutlineStore();
    const nodes = addNodes(store, 100);
    
    // Rapid updates (simulating fast typing)
    for (let i = 0; i < 10; i++) {
      updateNodeText(store, nodes[0].id, `Update ${i}`);
    }
    
    // Index should not rebuild immediately
    expect(store.getSearchIndex()).toBeNull();
    
    // Wait for debounce
    await new Promise(resolve => setTimeout(resolve, 400));
    
    // Index should now be built
    expect(store.getSearchIndex()).not.toBeNull();
    expect(store.getSearchIndex()?.version).toBe(store.getSnapshot().version);
  });
});
```

VALIDATION:
- Run: npm run typecheck
- Run: npm run test packages/client-core/src/search/__tests__/searchIndex.test.ts
- Verify: Performance tests show 10x+ improvement
- Verify: Debounced updates work correctly
- Manual: Test wiki link dialog responsiveness in large outline

ALIGNMENT WITH AGENTS.md:
- Rule 30: Debounce non-critical operations (300ms debounce on index updates)
- Rule 31: Lazy loading (index built on-demand)
- Rule 33: Efficient data structures (token maps for O(log n) search)
```

---

## PHASE 4: MEDIUM PRIORITY OPTIMIZATIONS

### Step 4.1: Optimize Reconciliation Algorithm

**Priority:** MEDIUM  
**Estimated Time:** 3-4 hours  
**Dependencies:** Phase 1 completed

#### LLM Prompt:

```
Optimize reconcileOutlineStructure() to reduce O(n²) complexity in edge cases. Currently can take 50ms+ for large trees with many inconsistencies.

REQUIREMENTS:
1. Reduce worst-case complexity from O(n²) to O(n log n)
2. Add early exit conditions for common cases
3. Batch reconciliation operations in single transaction
4. Maintain correctness and CRDT properties (AGENTS rule 26)
5. Add performance benchmarks

FILES TO MODIFY:
- packages/client-core/src/doc/edges.ts (lines 208-274)

IMPLEMENTATION DETAILS:

In packages/client-core/src/doc/edges.ts, optimize reconcileOutlineStructure:

```typescript
/**
 * Reconciles outline structure by ensuring childIds arrays match edge relationships.
 * 
 * Performance optimizations:
 * - Early exit if no edges changed
 * - Batch all fixes in single transaction
 * - Use Map lookups instead of array scans
 * - Process only affected parent nodes
 * 
 * Complexity: O(edges) instead of O(nodes * edges)
 */
export function reconcileOutlineStructure(
  outline: OutlineDoc,
  options: ReconcileOutlineStructureOptions = {}
): number {
  const { origin = null, filter } = options;

  // OPTIMIZATION: Build edge indexes once
  const parentToChildren = new Map<NodeId, Set<EdgeId>>();
  const childToParent = new Map<NodeId, EdgeId>();
  
  outline.edges.forEach((yEdge, edgeId) => {
    const parentId = yEdge.get('parentId');
    const childId = yEdge.get('childId');
    
    if (!filter || filter(edgeId, yEdge)) {
      if (parentId) {
        if (!parentToChildren.has(parentId)) {
          parentToChildren.set(parentId, new Set());
        }
        parentToChildren.get(parentId)!.add(edgeId);
      }
      
      if (childId) {
        childToParent.set(childId, edgeId);
      }
    }
  });

  // OPTIMIZATION: Track only nodes that need fixing
  const nodesToFix = new Set<NodeId>();

  // Check each node's childIds against expected edges
  outline.nodes.forEach((yNode, nodeId) => {
    const currentChildIds = yNode.get('childIds')?.toArray() || [];
    const expectedChildren = parentToChildren.get(nodeId);
    
    // Extract childIds from edges
    const expectedChildIds: NodeId[] = [];
    if (expectedChildren) {
      for (const edgeId of expectedChildren) {
        const edge = outline.edges.get(edgeId);
        const childId = edge?.get('childId');
        if (childId) {
          expectedChildIds.push(childId);
        }
      }
    }

    // Compare arrays efficiently
    if (!arraysEqual(currentChildIds, expectedChildIds)) {
      nodesToFix.add(nodeId);
    }
  });

  // OPTIMIZATION: Early exit if nothing to fix
  if (nodesToFix.size === 0) {
    return 0;
  }

  // OPTIMIZATION: Batch all fixes in single transaction
  return withTransaction(outline, () => {
    let fixCount = 0;

    for (const nodeId of nodesToFix) {
      const yNode = outline.nodes.get(nodeId);
      if (!yNode) continue;

      const expectedChildren = parentToChildren.get(nodeId);
      const expectedChildIds: NodeId[] = [];
      
      if (expectedChildren) {
        for (const edgeId of expectedChildren) {
          const edge = outline.edges.get(edgeId);
          const childId = edge?.get('childId');
          if (childId) {
            expectedChildIds.push(childId);
          }
        }
      }

      const childIdsArray = yNode.get('childIds');
      if (childIdsArray) {
        // Clear and repopulate
        childIdsArray.delete(0, childIdsArray.length);
        childIdsArray.push(expectedChildIds);
        fixCount++;
      }
    }

    return fixCount;
  }, origin);
}

/**
 * Fast array equality check.
 */
function arraysEqual<T>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
```

TESTS TO ADD:
Add to packages/client-core/src/doc/edges.test.ts:

```typescript
describe('reconcileOutlineStructure optimization', () => {
  it('early exits when structure is already consistent', () => {
    const outline = createTestOutline();
    addConsistentTree(outline, 100); // 100 nodes, all consistent
    
    const start = performance.now();
    const fixes = reconcileOutlineStructure(outline);
    const time = performance.now() - start;
    
    expect(fixes).toBe(0);
    expect(time).toBeLessThan(5); // <5ms for early exit
  });

  it('batches multiple fixes in single transaction', () => {
    const outline = createTestOutline();
    const node1 = addNode(outline, 'Node 1');
    const node2 = addNode(outline, 'Node 2');
    const node3 = addNode(outline, 'Node 3');
    
    // Create inconsistencies
    createInconsistentEdges(outline, node1.id, [node2.id, node3.id]);
    
    const transactionCount = trackTransactions(outline);
    const fixes = reconcileOutlineStructure(outline);
    
    expect(fixes).toBeGreaterThan(0);
    expect(transactionCount.get()).toBe(1); // Single transaction
  });

  it('is O(n) for large trees instead of O(n²)', () => {
    const outline = createTestOutline();
    
    // Create large tree with some inconsistencies
    const nodeCount = 5000;
    addInconsistentTree(outline, nodeCount, 0.1); // 10% inconsistent
    
    const start = performance.now();
    const fixes = reconcileOutlineStructure(outline);
    const time = performance.now() - start;
    
    console.log(`Reconciled ${nodeCount} nodes in ${time}ms`);
    
    expect(fixes).toBeGreaterThan(0);
    expect(time).toBeLessThan(50); // <50ms for 5k nodes
  });

  it('maintains CRDT properties after reconciliation', () => {
    const outline1 = createTestOutline();
    const outline2 = Y.cloneDoc(outline1);
    
    // Make divergent changes
    addNode(outline1, 'Node A');
    addNode(outline2, 'Node B');
    
    // Sync and reconcile
    syncDocs(outline1, outline2);
    const fixes1 = reconcileOutlineStructure(outline1);
    const fixes2 = reconcileOutlineStructure(outline2);
    
    // Both should converge to same structure
    expect(getStructureHash(outline1)).toBe(getStructureHash(outline2));
  });
});
```

VALIDATION:
- Run: npm run typecheck
- Run: npm run test packages/client-core/src/doc/edges.test.ts
- Verify: Performance tests show <50ms for 5k nodes
- Verify: Early exit optimization works
- Verify: CRDT properties maintained
- Manual: Test large outline with structural edits

ALIGNMENT WITH AGENTS.md:
- Rule 26: Maintains conflict-free CRDT operations
- Rule 29: Batches related operations in single transaction
- Rule 33: Efficient data structures (Map lookups instead of scans)
```

---

### Step 4.2: Add Dynamic Row Height Estimation for Virtualization

**Priority:** MEDIUM  
**Estimated Time:** 2-3 hours  
**Dependencies:** None

#### LLM Prompt:

```
Implement dynamic row height estimation for TanStack Virtual to handle variable-height content (multi-line text, rich formatting) without sync DOM reads.

REQUIREMENTS:
1. Estimate row heights based on text content length
2. Debounce measurement updates to avoid layout thrashing
3. Maintain smooth scrolling (no jumps)
4. Preserve virtualization compatibility (AGENTS rule 23)
5. Add tests for height estimation accuracy

FILES TO MODIFY:
- packages/client-react/src/outline/OutlineVirtualList.tsx
- packages/client-react/src/outline/hooks/useRowHeightEstimator.ts (new file)

IMPLEMENTATION DETAILS:

Create packages/client-react/src/outline/hooks/useRowHeightEstimator.ts:

```typescript
import { useMemo, useRef, useCallback } from 'react';
import type { PaneOutlineRow } from '@thortiq/client-core';

/**
 * Estimates row heights dynamically based on content.
 * 
 * Performance:
 * - Avoids sync DOM reads during scroll
 * - Caches measurements with debounced updates
 * - Uses content-based heuristics for initial estimate
 * 
 * Alignment with AGENTS.md:
 * - Rule 23: Maintains virtualization compatibility
 * - Rule 30: Debounced measurement updates
 * - Rule 32: Proper cleanup of observers
 */

const BASE_ROW_HEIGHT = 32;
const CHARS_PER_LINE = 80;
const LINE_HEIGHT = 24;
const PADDING = 16;

interface RowHeightCache {
  [rowId: string]: number;
}

export function useRowHeightEstimator(rows: PaneOutlineRow[]) {
  const heightCache = useRef<RowHeightCache>({});
  const measurementObserver = useRef<ResizeObserver | null>(null);

  /**
   * Estimates height based on text content length.
   * Used as initial estimate before actual measurement.
   */
  const estimateHeight = useCallback((row: PaneOutlineRow): number => {
    // Check cache first
    if (heightCache.current[row.id]) {
      return heightCache.current[row.id];
    }

    // Heuristic: estimate lines based on character count
    const text = row.text || '';
    const estimatedLines = Math.max(1, Math.ceil(text.length / CHARS_PER_LINE));
    const height = PADDING + (estimatedLines * LINE_HEIGHT);

    // Cache estimate
    heightCache.current[row.id] = height;

    return height;
  }, []);

  /**
   * Measures actual DOM height and updates cache.
   * Called by TanStack Virtual's measureElement callback.
   */
  const measureHeight = useCallback((element: Element): number => {
    const rowId = element.getAttribute('data-row-id');
    if (!rowId) {
      return BASE_ROW_HEIGHT;
    }

    const height = element.getBoundingClientRect().height;
    
    // Update cache with measured height
    heightCache.current[rowId] = height;

    return height;
  }, []);

  /**
   * Sets up ResizeObserver for dynamic content (debounced).
   */
  const observeElement = useCallback((element: Element) => {
    if (!measurementObserver.current) {
      measurementObserver.current = new ResizeObserver(
        debounce((entries) => {
          for (const entry of entries) {
            const rowId = entry.target.getAttribute('data-row-id');
            if (rowId) {
              const height = entry.contentRect.height;
              heightCache.current[rowId] = height;
            }
          }
        }, 150) // Debounce to avoid layout thrashing
      );
    }

    measurementObserver.current.observe(element);
  }, []);

  // Cleanup observer on unmount
  useEffect(() => {
    return () => {
      if (measurementObserver.current) {
        measurementObserver.current.disconnect();
      }
    };
  }, []);

  return {
    estimateHeight,
    measureHeight,
    observeElement
  };
}

function debounce<T extends (...args: any[]) => void>(
  func: T,
  wait: number
): T {
  let timeout: NodeJS.Timeout | null = null;
  
  return ((...args: any[]) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  }) as T;
}
```

Update packages/client-react/src/outline/OutlineVirtualList.tsx:

```typescript
import { useRowHeightEstimator } from './hooks/useRowHeightEstimator';

export function OutlineVirtualList({
  rows,
  // ... other props
}: OutlineVirtualListProps) {
  const { estimateHeight, measureHeight, observeElement } = useRowHeightEstimator(rows);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollParentRef.current,
    
    // Dynamic height estimation
    estimateSize: (index) => {
      const row = rows[index];
      return row ? estimateHeight(row) : BASE_ROW_HEIGHT;
    },
    
    // Actual measurement callback
    measureElement: (element) => {
      observeElement(element); // Set up resize observer
      return measureHeight(element);
    },
    
    overscan: 5,
    initialRect
  });

  // Render virtual items
  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div ref={scrollParentRef} style={{ height: '100%', overflow: 'auto' }}>
      <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
        {virtualItems.map((virtualRow) => {
          const row = rows[virtualRow.index];
          
          return (
            <div
              key={row.id}
              data-row-id={row.id}
              data-index={virtualRow.index}
              ref={(el) => {
                if (el) virtualizer.measureElement(el);
              }}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`
              }}
            >
              <OutlineRow row={row} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

TESTS TO ADD:
Add to packages/client-react/src/outline/__tests__/useRowHeightEstimator.test.tsx:

```typescript
describe('useRowHeightEstimator', () => {
  it('estimates height based on text length', () => {
    const { result } = renderHook(() => useRowHeightEstimator([]));
    
    const shortRow = { id: '1', text: 'Short' } as PaneOutlineRow;
    const longRow = { id: '2', text: 'A'.repeat(200) } as PaneOutlineRow;
    
    const shortHeight = result.current.estimateHeight(shortRow);
    const longHeight = result.current.estimateHeight(longRow);
    
    expect(longHeight).toBeGreaterThan(shortHeight);
  });

  it('caches measurements to avoid recalculation', () => {
    const { result } = renderHook(() => useRowHeightEstimator([]));
    const row = { id: '1', text: 'Test' } as PaneOutlineRow;
    
    const firstCall = result.current.estimateHeight(row);
    const secondCall = result.current.estimateHeight(row);
    
    // Should return same value from cache
    expect(secondCall).toBe(firstCall);
  });

  it('measures actual DOM height correctly', () => {
    const { result } = renderHook(() => useRowHeightEstimator([]));
    
    const element = document.createElement('div');
    element.setAttribute('data-row-id', 'row-1');
    element.style.height = '50px';
    document.body.appendChild(element);
    
    const height = result.current.measureHeight(element);
    
    expect(height).toBe(50);
    
    document.body.removeChild(element);
  });

  it('cleans up ResizeObserver on unmount', () => {
    const { result, unmount } = renderHook(() => useRowHeightEstimator([]));
    
    const element = document.createElement('div');
    element.setAttribute('data-row-id', 'row-1');
    
    result.current.observeElement(element);
    
    const disconnectSpy = vi.spyOn(ResizeObserver.prototype, 'disconnect');
    
    unmount();
    
    expect(disconnectSpy).toHaveBeenCalled();
  });
});
```

VALIDATION:
- Run: npm run typecheck
- Run: npm run test packages/client-react/src/outline/__tests__/useRowHeightEstimator.test.tsx
- Manual: Test scrolling with variable-height content (multi-line nodes)
- Manual: Verify no scrollbar jumps during scroll
- Manual: Test with 5k+ nodes, verify smooth 60fps scrolling

ALIGNMENT WITH AGENTS.md:
- Rule 23: Maintains virtualization compatibility
- Rule 30: Debounced measurement updates
- Rule 32: Proper cleanup (ResizeObserver disconnected on unmount)
```

---

## FINAL VALIDATION & TESTING

### Step 5: Comprehensive Performance Testing

**Priority:** CRITICAL  
**Estimated Time:** 2-3 hours  
**Dependencies:** All previous phases completed

#### LLM Prompt:

```
Create comprehensive performance test suite to validate all optimizations against the target metrics (10x improvement for 100k node outlines).

REQUIREMENTS:
1. Create performance test fixtures with 10k, 50k, 100k nodes
2. Measure snapshot creation, row building, search performance
3. Compare before/after metrics
4. Generate performance report
5. Ensure all AGENTS.md rules still satisfied

FILES TO CREATE:
- packages/client-core/src/__tests__/performance/large-tree-performance.test.ts
- packages/client-core/src/__tests__/performance/fixtures.ts
- docs/performance_report_1.md (generated)

IMPLEMENTATION DETAILS:

Create packages/client-core/src/__tests__/performance/fixtures.ts:

```typescript
/**
 * Performance test fixtures for large tree testing.
 * Creates realistic tree structures with 10k-100k nodes.
 */

export function createLargeTree(
  outline: OutlineDoc,
  nodeCount: number,
  options: {
    maxDepth?: number;
    branchingFactor?: number;
    avgTextLength?: number;
  } = {}
): void {
  const {
    maxDepth = 10,
    branchingFactor = 5,
    avgTextLength = 50
  } = options;

  const nodes: NodeId[] = [];

  // Create root nodes
  const rootCount = Math.min(nodeCount / 100, 20);
  for (let i = 0; i < rootCount; i++) {
    const text = generateRandomText(avgTextLength);
    const { edgeId, nodeId } = addRootNode(outline, text);
    nodes.push(nodeId);
  }

  // Recursively add children
  let createdCount = rootCount;
  let currentLevel = [...nodes];

  for (let depth = 0; depth < maxDepth && createdCount < nodeCount; depth++) {
    const nextLevel: NodeId[] = [];

    for (const parentId of currentLevel) {
      const childCount = Math.min(
        branchingFactor,
        Math.floor((nodeCount - createdCount) / currentLevel.length)
      );

      for (let i = 0; i < childCount && createdCount < nodeCount; i++) {
        const text = generateRandomText(avgTextLength);
        const { nodeId } = addChildNode(outline, parentId, text);
        nextLevel.push(nodeId);
        createdCount++;
      }

      if (createdCount >= nodeCount) break;
    }

    currentLevel = nextLevel;
  }
}

function generateRandomText(avgLength: number): string {
  const words = ['test', 'node', 'outline', 'document', 'structure', 'content'];
  const wordCount = Math.floor(avgLength / 6);
  const result: string[] = [];
  
  for (let i = 0; i < wordCount; i++) {
    result.push(words[Math.floor(Math.random() * words.length)]);
  }
  
  return result.join(' ');
}
```

Create packages/client-core/src/__tests__/performance/large-tree-performance.test.ts:

```typescript
/**
 * Performance benchmark suite for large tree operations.
 * 
 * Validates optimizations achieve 10x improvement targets:
 * - Snapshot creation: 200ms -> 20ms
 * - Row building: 50ms -> 5ms
 * - Search: 100ms -> 10ms
 */

describe('Large Tree Performance', () => {
  const SIZES = [10_000, 50_000, 100_000];

  describe.each(SIZES)('Tree with %i nodes', (nodeCount) => {
    let outline: OutlineDoc;
    let snapshot: OutlineSnapshot;

    beforeAll(() => {
      outline = createTestOutline();
      createLargeTree(outline, nodeCount);
      snapshot = createOutlineSnapshot(outline);
    });

    it('snapshot creation is < 50ms', () => {
      const iterations = 10;
      const times: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        createOutlineSnapshot(outline);
        times.push(performance.now() - start);
      }

      const avgTime = times.reduce((a, b) => a + b) / times.length;
      const maxTime = Math.max(...times);

      console.log(`Snapshot creation for ${nodeCount} nodes: avg=${avgTime.toFixed(2)}ms, max=${maxTime.toFixed(2)}ms`);

      // Target: <50ms for 100k nodes (10x improvement from 500ms baseline)
      const target = nodeCount === 100_000 ? 50 : (50 * nodeCount / 100_000);
      expect(avgTime).toBeLessThan(target);
    });

    it('incremental text update is < 5ms', () => {
      const tracker = new SnapshotChangeTracker();
      const nodeIds = Array.from(snapshot.nodes.keys()).slice(0, 10);

      tracker.markNodesChanged(nodeIds);
      const changeSet = tracker.createChangeSet();

      const start = performance.now();
      updateSnapshotIncremental(snapshot, outline, changeSet);
      const time = performance.now() - start;

      console.log(`Incremental text update (10 nodes) on ${nodeCount} tree: ${time.toFixed(2)}ms`);

      expect(time).toBeLessThan(5); // Target: <5ms regardless of tree size
    });

    it('row building with memoization is < 10ms', () => {
      const paneState: SessionPaneState = {
        rootEdgeId: null,
        focusPathEdgeIds: [],
        collapsedEdgeIds: [],
        quickFilter: null
      };

      const iterations = 10;
      const times: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        buildPaneRows(snapshot, paneState);
        times.push(performance.now() - start);
      }

      const avgTime = times.reduce((a, b) => a + b) / times.length;

      console.log(`Row building for ${nodeCount} nodes: avg=${avgTime.toFixed(2)}ms`);

      // Target: <10ms for 100k nodes (10x improvement from 100ms baseline)
      const target = nodeCount === 100_000 ? 10 : (10 * nodeCount / 100_000);
      expect(avgTime).toBeLessThan(target);
    });

    it('search with index is < 10ms', () => {
      const index = buildSearchIndex(snapshot);
      const queries = ['test', 'node document', 'structure content'];

      const times: number[] = [];

      for (const query of queries) {
        const start = performance.now();
        searchIndex(index, query);
        times.push(performance.now() - start);
      }

      const avgTime = times.reduce((a, b) => a + b) / times.length;

      console.log(`Search on ${nodeCount} nodes: avg=${avgTime.toFixed(2)}ms`);

      expect(avgTime).toBeLessThan(10); // Target: <10ms for any tree size
    });

    it('ancestor resolution with index is < 1ms', () => {
      const nodeIds = Array.from(snapshot.nodes.keys()).slice(0, 100);
      const times: number[] = [];

      for (const nodeId of nodeIds) {
        const start = performance.now();
        getAncestors(snapshot, nodeId);
        times.push(performance.now() - start);
      }

      const avgTime = times.reduce((a, b) => a + b) / times.length;

      console.log(`Ancestor resolution on ${nodeCount} tree: avg=${avgTime.toFixed(6)}ms`);

      expect(avgTime).toBeLessThan(1); // Target: <1ms per lookup
    });
  });

  it('memory usage is < 100MB for 100k node tree', () => {
    const outline = createTestOutline();
    createLargeTree(outline, 100_000);

    const memBefore = process.memoryUsage().heapUsed / 1024 / 1024;

    const snapshot = createOutlineSnapshot(outline);

    const memAfter = process.memoryUsage().heapUsed / 1024 / 1024;
    const memUsed = memAfter - memBefore;

    console.log(`Memory usage for 100k snapshot: ${memUsed.toFixed(2)}MB`);

    // Target: <100MB for snapshot (4x reduction from 400MB baseline)
    expect(memUsed).toBeLessThan(100);
  });
});
```

Run performance tests and generate report:

```bash
npm run test:performance > performance_results.txt
```

VALIDATION STEPS:
1. Run: npm run typecheck && npm run lint
2. Run: npm run test (all unit tests pass)
3. Run: npm run test:performance (performance benchmarks pass)
4. Manual: Open web app with 5k+ node outline
5. Manual: Test typing speed (should be instant, no lag)
6. Manual: Test scrolling (should be 60fps)
7. Manual: Test search (results in <100ms)
8. Manual: Test wiki link dialog (no typing lag)

EXPECTED RESULTS (100k node tree):
- Snapshot creation: <50ms (was ~200ms)
- Incremental text update: <5ms (was ~50ms per keystroke)
- Row building: <10ms (was ~100ms)
- Search with index: <10ms (was ~100ms)
- Ancestor resolution: <1ms (was ~10ms per node)
- Memory usage: <100MB (was ~200MB)

ALIGNMENT WITH AGENTS.md:
- Rule 1: Keep repo buildable (all tests pass)
- Rule 7: Eliminates heavy computations on every update
- Rule 30: Implements debouncing for non-critical operations
- Rule 33: Uses efficient data structures throughout
```

---

## COMPLETION CHECKLIST

Before considering the performance refactoring complete, verify:

- [ ] All tests pass: `npm run test`
- [ ] Type checking passes: `npm run typecheck`
- [ ] Linting passes: `npm run lint`
- [ ] Performance benchmarks meet targets (see table below)
- [ ] Manual testing with 5k+ node outline shows smooth performance
- [ ] No AGENTS.md rules violated (review checklist below)
- [ ] Documentation updated (architecture docs, AGENTS.md references)

### Performance Target Validation

| Metric | Baseline (100k nodes) | Target | Status |
|--------|----------------------|--------|--------|
| Snapshot Creation | 200ms | <50ms | ⏳ |
| Text Edit (10 nodes) | 50ms | <5ms | ⏳ |
| Row Building | 100ms | <10ms | ⏳ |
| Search Query | 100ms | <10ms | ⏳ |
| Ancestor Lookup | 10ms | <1ms | ⏳ |
| Memory Usage | 200MB | <100MB | ⏳ |

### AGENTS.md Compliance Validation

- [ ] Rule 3: All Yjs mutations in transactions
- [ ] Rule 7: No heavy computations on every update
- [ ] Rule 23: Virtualization compatibility maintained
- [ ] Rule 25: Performance optimization, stable node IDs
- [ ] Rule 29: Transaction boundaries respected
- [ ] Rule 30: Non-critical operations debounced
- [ ] Rule 32: Event listeners properly disposed
- [ ] Rule 33: Efficient data structures used
- [ ] Rule 39: Incremental changes, backward compatible

---

## TROUBLESHOOTING

### Common Issues

**Issue:** Performance tests fail on CI but pass locally
- **Cause:** CI machines may be slower/different
- **Solution:** Adjust target thresholds by 1.5x for CI, or use relative improvements instead of absolute times

**Issue:** Memoization not working (same deps but rebuilding)
- **Cause:** Non-stable references in dependency arrays
- **Solution:** Use JSON.stringify for arrays/objects or implement deep comparison

**Issue:** Search index out of sync with snapshot
- **Cause:** Debounced updates may lag behind snapshot versions
- **Solution:** Check index.version matches snapshot.version before using index, fallback to linear search if mismatch

**Issue:** Virtualization scrollbar jumps after optimizations
- **Cause:** Dynamic height estimation inaccurate
- **Solution:** Increase initial height estimates, add more measurement points

**Issue:** Memory usage not improving
- **Cause:** Old snapshots/indexes not garbage collected
- **Solution:** Verify no references held in closures, use WeakMap for caches

---

## NEXT STEPS (FUTURE PHASES)

After Phase 1 completion, consider:

1. **Web Worker Offloading** - Move search indexing to background thread
2. **Lazy Node Loading** - Load node content on-demand for massive trees
3. **Persistent Cache** - Cache search index to IndexedDB/localStorage
4. **Further Memoization** - Apply useMemo to more expensive computations
5. **Memory Profiling** - Identify and eliminate memory leaks
6. **E2E Performance Tests** - Automated browser performance testing

---

## REFERENCES

- **Original Issues:**
  - docs/reviews/cursor_review_1.md
  - docs/reviews/codex_review_1.md
  
- **AGENTS.md Rules:**
  - Rule 7: Virtualize rows, avoid heavy computations
  - Rule 30: Debounce non-critical operations
  - Rule 31: Lazy loading
  - Rule 32: Memory management
  - Rule 33: Efficient data structures

- **Architecture Docs:**
  - docs/architecture/thortiq_layers.md
  - docs/architecture/virtualization.md

---

**Document Version:** 1.0  
**Last Updated:** October 6, 2025  
**Status:** Ready for Implementation


