import { createEdgeInstanceId, type EdgeId, type OutlineSnapshot } from "@thortiq/client-core";

export const projectEdgeIdForParent = (
  snapshot: OutlineSnapshot,
  parentEdgeId: EdgeId | null,
  childCanonicalEdgeId: EdgeId
): EdgeId => {
  if (!parentEdgeId) {
    return childCanonicalEdgeId;
  }
  const canonicalParentEdgeId =
    snapshot.canonicalEdgeIdsByEdgeId.get(parentEdgeId) ?? parentEdgeId;
  const parentSnapshot = snapshot.edges.get(parentEdgeId);
  const parentIsMirror = parentSnapshot?.mirrorOfNodeId !== null;
  if (!parentIsMirror && parentEdgeId === canonicalParentEdgeId) {
    return childCanonicalEdgeId;
  }
  return createEdgeInstanceId(parentEdgeId, childCanonicalEdgeId);
};
