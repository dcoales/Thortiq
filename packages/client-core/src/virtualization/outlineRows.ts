import type * as Y from 'yjs';

import {createResolverFromDoc} from '../yjs/doc';
import type {EdgeId, EdgeRecord, NodeId, NodeRecord} from '../types';

export interface VirtualizedNodeRow {
  readonly node: NodeRecord;
  readonly edge: EdgeRecord | null;
  readonly depth: number;
  readonly isRoot: boolean;
}

export interface OutlineRowsSnapshot {
  readonly rows: readonly VirtualizedNodeRow[];
  readonly edgeToIndex: ReadonlyMap<EdgeId, number>;
  readonly hasNonRootRows: boolean;
}

export interface OutlineRowsOptions {
  readonly doc: Y.Doc;
  readonly rootId: NodeId;
  readonly collapsedEdgeIds: ReadonlySet<EdgeId>;
  readonly initialDepth: number;
}

export const buildOutlineRowsSnapshot = (
  options: OutlineRowsOptions
): OutlineRowsSnapshot => {
  const {doc, rootId, collapsedEdgeIds, initialDepth} = options;
  const resolver = createResolverFromDoc(doc);
  const nodes = doc.getMap<NodeRecord>('nodes');

  const rows: VirtualizedNodeRow[] = [];
  const edgeToIndex = new Map<EdgeId, number>();
  let hasNonRootRows = false;

  const stack: Array<{nodeId: NodeId; depth: number; viaEdge: EdgeRecord | null}> = [
    {nodeId: rootId, depth: initialDepth, viaEdge: null}
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
      isRoot: current.viaEdge === null
    };

    const nextIndex = rows.length;
    rows.push(row);

    if (row.edge) {
      edgeToIndex.set(row.edge.id, nextIndex);
      hasNonRootRows = true;
    }

    const edges = resolver(current.nodeId);
    if (edges.length === 0) {
      continue;
    }

    for (let index = edges.length - 1; index >= 0; index -= 1) {
      const edge = edges[index];
      if (collapsedEdgeIds.has(edge.id)) {
        continue;
      }
      stack.push({nodeId: edge.childId, depth: current.depth + 1, viaEdge: edge});
    }
  }

  return {rows, edgeToIndex, hasNonRootRows};
};
