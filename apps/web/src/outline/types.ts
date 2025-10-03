/**
 * Shared outline UI types used to coordinate between container hooks, drag logic, and
 * presentational components. These types intentionally avoid any React-specific structures so
 * they can be reused across platforms while keeping identifiers stable, in line with AGENTS.md.
 */
import type { EdgeId, NodeId, NodeMetadata } from "@thortiq/client-core";
import type { PendingCursorRequest } from "./ActiveNodeEditor";

export interface SelectionRange {
  readonly anchorEdgeId: EdgeId;
  readonly focusEdgeId: EdgeId;
}

export type PendingCursor = PendingCursorRequest & { readonly edgeId: EdgeId };

export interface OutlineRow {
  readonly edgeId: EdgeId;
  readonly nodeId: NodeId;
  readonly depth: number;
  readonly treeDepth: number;
  readonly text: string;
  readonly metadata: NodeMetadata;
  readonly collapsed: boolean;
  readonly parentNodeId: NodeId | null;
  readonly hasChildren: boolean;
  readonly ancestorEdgeIds: ReadonlyArray<EdgeId>;
  readonly ancestorNodeIds: ReadonlyArray<NodeId>;
}
