import type * as Y from 'yjs';

import {createResolverFromDoc} from '../yjs/doc';
import type {EdgeId, EdgeRecord, NodeId, NodeRecord} from '../types';

export interface VirtualizedNodeRow {
  readonly node: NodeRecord;
  readonly edge: EdgeRecord | null;
  readonly depth: number;
  readonly isRoot: boolean;
  readonly ancestorEdges: readonly EdgeRecord[];
}

export interface OutlineRowsSnapshot {
  readonly rows: readonly VirtualizedNodeRow[];
  readonly edgeToIndex: ReadonlyMap<EdgeId, number>;
  readonly hasNonRootRows: boolean;
}

export interface OutlineRowsOptions {
  readonly doc: Y.Doc;
  readonly rootId: NodeId;
  readonly collapsedEdgeIds?: ReadonlySet<EdgeId>;
  readonly initialDepth: number;
}

export const buildOutlineRowsSnapshot = (
  options: OutlineRowsOptions
): OutlineRowsSnapshot => {
  const {doc, rootId, collapsedEdgeIds, initialDepth} = options;
  const collapsedSet = collapsedEdgeIds ?? null;
  const resolver = createResolverFromDoc(doc);
  const nodes = doc.getMap<NodeRecord>('nodes');

  const rows: VirtualizedNodeRow[] = [];
  const edgeToIndex = new Map<EdgeId, number>();
  let hasNonRootRows = false;

  const stack: Array<{
    nodeId: NodeId;
    depth: number;
    viaEdge: EdgeRecord | null;
    ancestorEdges: readonly EdgeRecord[];
  }> = [
    {nodeId: rootId, depth: initialDepth, viaEdge: null, ancestorEdges: []}
  ];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    const node = nodes.get(current.nodeId);
    if (!node) {
      continue;
    }

    const row: VirtualizedNodeRow = {
      node,
      edge: current.viaEdge,
      depth: current.depth,
      isRoot: current.viaEdge === null,
      ancestorEdges: current.ancestorEdges
    };

    const nextIndex = rows.length;
    rows.push(row);

    if (row.edge) {
      edgeToIndex.set(row.edge.id, nextIndex);
      hasNonRootRows = true;
    }

    const isCurrentCollapsed = current.viaEdge
      ? (collapsedSet ? collapsedSet.has(current.viaEdge.id) : current.viaEdge.collapsed)
      : false;
    if (isCurrentCollapsed) {
      continue;
    }

    const edges = resolver(current.nodeId);
    if (edges.length === 0) {
      continue;
    }

    for (let index = edges.length - 1; index >= 0; index -= 1) {
      const edge = edges[index];
      const nextAncestors = current.viaEdge ? [...current.ancestorEdges, current.viaEdge] : current.ancestorEdges;
      stack.push({nodeId: edge.childId, depth: current.depth + 1, viaEdge: edge, ancestorEdges: nextAncestors});
    }
  }

  return {rows, edgeToIndex, hasNonRootRows};
};
