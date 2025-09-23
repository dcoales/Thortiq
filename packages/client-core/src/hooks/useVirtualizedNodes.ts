import {useMemo} from 'react';
import type * as Y from 'yjs';

import {createResolverFromDoc} from '../yjs/doc';
import type {EdgeRecord, NodeRecord} from '../types';
import {useYDoc} from './yDocContext';
import {useDocVersion} from './useDocVersion';

export interface VirtualizedNodeRow {
  readonly node: NodeRecord;
  readonly edge: EdgeRecord | null;
  readonly depth: number;
  readonly isRoot: boolean;
}

export interface UseVirtualizedNodesOptions {
  readonly rootId: string;
  readonly collapsedEdgeIds?: ReadonlySet<string>;
  readonly initialDepth?: number;
}

const buildVirtualRows = (
  doc: Y.Doc,
  rootId: string,
  collapsedEdgeIds: ReadonlySet<string>,
  initialDepth: number
): VirtualizedNodeRow[] => {
  const resolver = createResolverFromDoc(doc);
  const nodes = doc.getMap<NodeRecord>('nodes');

  const rows: VirtualizedNodeRow[] = [];
  const stack: Array<{nodeId: string; depth: number; viaEdge: EdgeRecord | null}> = [
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

    rows.push({
      node,
      edge: current.viaEdge,
      depth: current.depth,
      isRoot: current.viaEdge === null
    });

    const edges = resolver(current.nodeId);
    if (edges.length === 0) {
      continue;
    }

    for (let i = edges.length - 1; i >= 0; i -= 1) {
      const edge = edges[i];
      if (collapsedEdgeIds.has(edge.id)) {
        continue;
      }
      stack.push({nodeId: edge.childId, depth: current.depth + 1, viaEdge: edge});
    }
  }

  return rows;
};

export const useVirtualizedNodes = (options: UseVirtualizedNodesOptions): VirtualizedNodeRow[] => {
  const doc = useYDoc();
  const version = useDocVersion();
  const collapsedIds = useMemo(() => {
    if (!options.collapsedEdgeIds) {
      return [] as string[];
    }
    return [...options.collapsedEdgeIds].sort();
  }, [options.collapsedEdgeIds]);
  const collapsedKey = useMemo(() => collapsedIds.join('|'), [collapsedIds]);
  const initialDepth = options.initialDepth ?? 0;

  return useMemo(() => {
    const collapsedSet = new Set(collapsedIds);
    return buildVirtualRows(doc, options.rootId, collapsedSet, initialDepth);
  }, [doc, options.rootId, collapsedKey, initialDepth, version]);
};
