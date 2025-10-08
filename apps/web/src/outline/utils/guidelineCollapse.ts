/**
 * Derives collapse/expand operations for guideline toggles without coupling to React. Callers
 * provide snapshot and UI caches so decisions remain deterministic and the heavy computations
 * stay out of render loops, keeping with AGENTS.md performance guidance.
 */
import type { EdgeId, OutlineSnapshot } from "@thortiq/client-core";

import type { OutlineRow } from "../types";

export interface GuidelineCollapsePlan {
  readonly toCollapse: readonly EdgeId[];
  readonly toExpand: readonly EdgeId[];
}

interface GuidelineContext {
  readonly edgeId: EdgeId;
  readonly snapshot: OutlineSnapshot;
  readonly rowMap: ReadonlyMap<EdgeId, OutlineRow>;
  readonly collapsedEdgeIds: ReadonlyArray<EdgeId>;
}

const isEdgeCollapsed = (
  edgeId: EdgeId,
  context: GuidelineContext
): boolean => {
  const row = context.rowMap.get(edgeId);
  if (row) {
    return row.collapsed;
  }
  if (context.collapsedEdgeIds.includes(edgeId)) {
    return true;
  }
  const snapshotEdge = context.snapshot.edges.get(edgeId);
  return snapshotEdge?.collapsed ?? false;
};

export const planGuidelineCollapse = (context: GuidelineContext): GuidelineCollapsePlan | null => {
  const edgeSnapshot = context.snapshot.edges.get(context.edgeId);
  if (!edgeSnapshot) {
    return null;
  }
  const projectedChildEdges = context.snapshot.childEdgeIdsByParentEdge.get(context.edgeId);
  const childEdgeIds = projectedChildEdges
    ?? context.snapshot.childrenByParent.get(edgeSnapshot.childNodeId)
    ?? [];
  if (childEdgeIds.length === 0) {
    return null;
  }

  const shouldClose = childEdgeIds.some((childEdgeId) => !isEdgeCollapsed(childEdgeId, context));
  if (shouldClose) {
    const toCollapse = childEdgeIds.filter((childEdgeId) => !isEdgeCollapsed(childEdgeId, context));
    if (toCollapse.length === 0) {
      return null;
    }
    return { toCollapse, toExpand: [] };
  }

  const toExpand = childEdgeIds.filter((childEdgeId) => context.collapsedEdgeIds.includes(childEdgeId));
  if (toExpand.length === 0) {
    return null;
  }
  return { toCollapse: [], toExpand };
};
