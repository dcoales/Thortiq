/**
 * React-friendly hook that projects an outline snapshot plus session pane metadata into immutable
 * row view models. It keeps data derivation pure so platform adapters can memoise the results
 * without touching Yjs structures or leaking implementation details beyond this module.
 */
import { useMemo } from "react";

import {
  buildPaneRows,
  type OutlineSnapshot,
  type InlineSpan,
  type PaneFocusContext
} from "@thortiq/client-core";
import type { EdgeId, NodeId, NodeMetadata } from "@thortiq/client-core";
import type { SessionPaneState } from "@thortiq/sync-core";

export interface OutlineRow {
  readonly edgeId: EdgeId;
  readonly nodeId: NodeId;
  readonly depth: number;
  readonly treeDepth: number;
  readonly text: string;
  readonly inlineContent: ReadonlyArray<InlineSpan>;
  readonly metadata: NodeMetadata;
  readonly collapsed: boolean;
  readonly parentNodeId: NodeId | null;
  readonly hasChildren: boolean;
  readonly ancestorEdgeIds: ReadonlyArray<EdgeId>;
  readonly ancestorNodeIds: ReadonlyArray<NodeId>;
}

export interface OutlineRowsResult {
  readonly rows: OutlineRow[];
  readonly rowMap: ReadonlyMap<EdgeId, OutlineRow>;
  readonly edgeIndexMap: ReadonlyMap<EdgeId, number>;
  readonly focusContext: PaneFocusContext | null;
  readonly appliedFilter?: string;
}

export const useOutlineRows = (
  snapshot: OutlineSnapshot,
  pane: SessionPaneState
): OutlineRowsResult => {
  const paneRowsResult = useMemo(
    () =>
      buildPaneRows(snapshot, {
        rootEdgeId: pane.rootEdgeId,
        collapsedEdgeIds: pane.collapsedEdgeIds,
        quickFilter: pane.quickFilter,
        focusPathEdgeIds: pane.focusPathEdgeIds
      }),
    [pane.collapsedEdgeIds, pane.focusPathEdgeIds, pane.quickFilter, pane.rootEdgeId, snapshot]
  );

  const rows = useMemo<OutlineRow[]>(
    () =>
      paneRowsResult.rows.map((row) => ({
        edgeId: row.edge.id,
        nodeId: row.node.id,
        depth: row.depth,
        treeDepth: row.treeDepth,
        text: row.node.text,
        inlineContent: row.node.inlineContent,
        metadata: row.node.metadata,
        collapsed: row.collapsed,
        parentNodeId: row.parentNodeId,
        hasChildren: row.hasChildren,
        ancestorEdgeIds: row.ancestorEdgeIds,
        ancestorNodeIds: row.ancestorNodeIds
      })),
    [paneRowsResult.rows]
  );

  const rowMap = useMemo(() => {
    const map = new Map<EdgeId, OutlineRow>();
    rows.forEach((row) => {
      map.set(row.edgeId, row);
    });
    return map as ReadonlyMap<EdgeId, OutlineRow>;
  }, [rows]);

  const edgeIndexMap = useMemo(() => {
    const map = new Map<EdgeId, number>();
    rows.forEach((row, index) => {
      map.set(row.edgeId, index);
    });
    return map as ReadonlyMap<EdgeId, number>;
  }, [rows]);

  return {
    rows,
    rowMap,
    edgeIndexMap,
    focusContext: paneRowsResult.focus ?? null,
    appliedFilter: paneRowsResult.appliedFilter
  } satisfies OutlineRowsResult;
};
