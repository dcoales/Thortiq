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

const getSiblingEdgeIds = (
  snapshot: OutlineSnapshot,
  parentEdgeId: EdgeId | null
): ReadonlyArray<EdgeId> => {
  if (!parentEdgeId) {
    return snapshot.rootEdgeIds;
  }
  return snapshot.childEdgeIdsByParentEdge.get(parentEdgeId) ?? [];
};

export const projectEdgeIdAfterIndent = (
  snapshot: OutlineSnapshot,
  options: {
    readonly currentEdgeId: EdgeId | null;
    readonly currentParentEdgeId: EdgeId | null;
    readonly canonicalEdgeId: EdgeId | null;
  }
): EdgeId | null => {
  const { currentEdgeId, currentParentEdgeId, canonicalEdgeId } = options;
  if (!canonicalEdgeId) {
    return null;
  }
  if (!currentEdgeId) {
    return canonicalEdgeId;
  }
  const siblings = getSiblingEdgeIds(snapshot, currentParentEdgeId);
  if (siblings.length === 0) {
    return canonicalEdgeId;
  }
  const canonicalMap = snapshot.canonicalEdgeIdsByEdgeId;
  const currentCanonical = canonicalMap.get(currentEdgeId) ?? currentEdgeId;

  let currentIndex = -1;
  let previousCanonical: EdgeId | null = null;

  for (let index = 0; index < siblings.length; index += 1) {
    const sibling = siblings[index];
    const siblingCanonical = canonicalMap.get(sibling) ?? sibling;
    if (siblingCanonical !== currentCanonical) {
      continue;
    }
    currentIndex = index;
    if (index > 0) {
      previousCanonical = canonicalMap.get(siblings[index - 1]!) ?? siblings[index - 1] ?? null;
    }
    break;
  }

  if (currentIndex <= 0 || !previousCanonical) {
    return canonicalEdgeId;
  }

  const previousProjection = projectEdgeIdForParent(snapshot, currentParentEdgeId, previousCanonical);
  return projectEdgeIdForParent(snapshot, previousProjection, canonicalEdgeId);
};

export const projectEdgeIdAfterOutdent = (
  snapshot: OutlineSnapshot,
  options: {
    readonly canonicalEdgeId: EdgeId | null;
    readonly newParentEdgeId: EdgeId | null;
  }
): EdgeId | null => {
  const { canonicalEdgeId, newParentEdgeId } = options;
  if (!canonicalEdgeId) {
    return null;
  }
  return projectEdgeIdForParent(snapshot, newParentEdgeId ?? null, canonicalEdgeId);
};
