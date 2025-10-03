/**
 * Outline command helpers wrap transactional operations on the shared Yjs outline so that
 * platform-specific shells (web, desktop, mobile) can implement consistent keyboard and menu
 * behaviour without duplicating data manipulation logic.
 */
import {
  addEdge,
  createNode,
  getChildEdgeIds,
  getEdgeSnapshot,
  getNodeText,
  getParentEdgeId,
  edgeExists,
  moveEdge,
  removeEdge,
  setNodeText,
  toggleEdgeCollapsed,
  type EdgeId,
  type NodeId,
  type OutlineDoc
} from "@thortiq/client-core";

export interface CommandContext {
  readonly outline: OutlineDoc;
  readonly origin?: unknown;
}

export interface CommandResult {
  readonly edgeId: EdgeId;
  readonly nodeId: NodeId;
}

export type CommandCursorPlacement = "start" | "end" | { readonly type: "offset"; readonly index: number };

export interface MergeWithPreviousResult {
  readonly edgeId: EdgeId;
  readonly nodeId: NodeId;
  readonly cursor: CommandCursorPlacement;
}

export const insertRootNode = (context: CommandContext): CommandResult => {
  const { outline, origin } = context;
  const position = outline.rootEdges.length;
  const { edgeId, nodeId } = addEdge(outline, {
    parentNodeId: null,
    position,
    origin
  });

  return { edgeId, nodeId };
};

export const insertSiblingBelow = (context: CommandContext, edgeId: EdgeId): CommandResult => {
  const { outline, origin } = context;
  const snapshot = getEdgeSnapshot(outline, edgeId);
  const siblings = getSiblingEdges(outline, snapshot.parentNodeId);
  const index = siblings.indexOf(edgeId);
  const insertionIndex = index >= 0 ? index + 1 : siblings.length;

  const newNodeId = createNode(outline, { origin });
  const { edgeId: newEdgeId, nodeId } = addEdge(outline, {
    parentNodeId: snapshot.parentNodeId,
    childNodeId: newNodeId,
    position: insertionIndex,
    origin
  });

  return { edgeId: newEdgeId, nodeId };
};

export const insertSiblingAbove = (context: CommandContext, edgeId: EdgeId): CommandResult => {
  const { outline, origin } = context;
  const snapshot = getEdgeSnapshot(outline, edgeId);
  const siblings = getSiblingEdges(outline, snapshot.parentNodeId);
  const index = siblings.indexOf(edgeId);
  const insertionIndex = index >= 0 ? index : 0;

  const newNodeId = createNode(outline, { origin });
  const { edgeId: newEdgeId, nodeId } = addEdge(outline, {
    parentNodeId: snapshot.parentNodeId,
    childNodeId: newNodeId,
    position: insertionIndex,
    origin
  });

  return { edgeId: newEdgeId, nodeId };
};

const createChildEdge = (
  context: CommandContext,
  snapshot: ReturnType<typeof getEdgeSnapshot>,
  children: ReadonlyArray<EdgeId>,
  position: number
): CommandResult => {
  const { outline, origin } = context;
  const boundedPosition = Math.max(0, Math.min(position, children.length));
  const newNodeId = createNode(outline, { origin });
  const { edgeId: newEdgeId, nodeId } = addEdge(outline, {
    parentNodeId: snapshot.childNodeId,
    childNodeId: newNodeId,
    position: boundedPosition,
    origin
  });

  return { edgeId: newEdgeId, nodeId };
};

export const insertChild = (context: CommandContext, edgeId: EdgeId): CommandResult => {
  const { outline } = context;
  const snapshot = getEdgeSnapshot(outline, edgeId);
  const children = getChildEdgeIds(outline, snapshot.childNodeId);
  return createChildEdge(context, snapshot, children, children.length);
};

export const insertChildAtStart = (context: CommandContext, edgeId: EdgeId): CommandResult => {
  const { outline } = context;
  const snapshot = getEdgeSnapshot(outline, edgeId);
  const children = getChildEdgeIds(outline, snapshot.childNodeId);
  return createChildEdge(context, snapshot, children, 0);
};

export const indentEdge = (context: CommandContext, edgeId: EdgeId): CommandResult | null => {
  const { outline, origin } = context;
  const snapshot = getEdgeSnapshot(outline, edgeId);
  const siblings = getSiblingEdges(outline, snapshot.parentNodeId);
  const currentIndex = siblings.indexOf(edgeId);
  if (currentIndex <= 0) {
    return null;
  }

  const newParentEdgeId = siblings[currentIndex - 1];
  const newParentEdge = getEdgeSnapshot(outline, newParentEdgeId);

  moveEdge(outline, edgeId, newParentEdge.childNodeId, getChildEdgeIds(outline, newParentEdge.childNodeId).length, origin);

  return { edgeId, nodeId: snapshot.childNodeId };
};

export const indentEdges = (
  context: CommandContext,
  edgeIds: ReadonlyArray<EdgeId>
): CommandResult[] | null => {
  const { outline, origin } = context;
  const targets = collectIndentTargets(outline, edgeIds);
  if (!targets) {
    return null;
  }

  const executionTargets = [...targets].sort((left, right) => {
    if (left.parentOrder !== right.parentOrder) {
      return left.parentOrder - right.parentOrder;
    }
    return left.sourceIndex - right.sourceIndex;
  });

  for (const target of executionTargets) {
    const position = getChildEdgeIds(outline, target.parentNodeId).length;
    moveEdge(outline, target.edgeId, target.parentNodeId, position, origin);
  }

  return targets.map(({ edgeId, nodeId }) => ({ edgeId, nodeId }));
};

export const outdentEdge = (context: CommandContext, edgeId: EdgeId): CommandResult | null => {
  const { outline, origin } = context;
  const snapshot = getEdgeSnapshot(outline, edgeId);
  if (snapshot.parentNodeId === null) {
    return null;
  }

  const parentEdgeId = getParentEdgeId(outline, snapshot.parentNodeId);
  const parentEdge = parentEdgeId ? getEdgeSnapshot(outline, parentEdgeId) : null;
  const parentSiblings = getSiblingEdges(outline, parentEdge ? parentEdge.parentNodeId : null);
  const parentIndex = parentEdge ? parentSiblings.indexOf(parentEdge.id) : parentSiblings.length;

  moveEdge(outline, edgeId, parentEdge ? parentEdge.parentNodeId : null, parentIndex + 1, origin);

  return { edgeId, nodeId: snapshot.childNodeId };
};

export const outdentEdges = (
  context: CommandContext,
  edgeIds: ReadonlyArray<EdgeId>
): CommandResult[] | null => {
  const { outline, origin } = context;
  const targets = collectOutdentTargets(outline, edgeIds);
  if (!targets) {
    return null;
  }

  const results: CommandResult[] = [];
  for (const target of targets) {
    moveEdge(outline, target.edgeId, target.parentNodeId, target.position, origin);
    results.push({ edgeId: target.edgeId, nodeId: target.nodeId });
  }

  return results;
};

export const toggleCollapsedCommand = (
  context: CommandContext,
  edgeId: EdgeId,
  collapsed?: boolean
): boolean => {
  return toggleEdgeCollapsed(context.outline, edgeId, collapsed, context.origin);
};

export const mergeWithPrevious = (
  context: CommandContext,
  edgeId: EdgeId
): MergeWithPreviousResult | null => {
  const { outline, origin } = context;
  const snapshot = getEdgeSnapshot(outline, edgeId);
  const siblings = getSiblingEdges(outline, snapshot.parentNodeId);
  const currentIndex = siblings.indexOf(edgeId);
  if (currentIndex === -1) {
    return null;
  }

  const nodeId = snapshot.childNodeId;
  const nodeText = getNodeText(outline, nodeId);
  const isEmpty = nodeText.trim().length === 0;
  const childEdgeIds = [...getChildEdgeIds(outline, nodeId)];

  if (isEmpty) {
    if (currentIndex > 0) {
      const previousEdgeId = siblings[currentIndex - 1];
      const previousSnapshot = getEdgeSnapshot(outline, previousEdgeId);
      let insertionIndex = getChildEdgeIds(outline, previousSnapshot.childNodeId).length;
      for (const childEdgeId of childEdgeIds) {
        moveEdge(outline, childEdgeId, previousSnapshot.childNodeId, insertionIndex, origin);
        insertionIndex += 1;
      }
      removeEdge(outline, edgeId, { origin });
      return {
        edgeId: previousEdgeId,
        nodeId: previousSnapshot.childNodeId,
        cursor: "end"
      } satisfies MergeWithPreviousResult;
    }

    if (snapshot.parentNodeId === null) {
      return null;
    }

    const parentNodeId = snapshot.parentNodeId;
    const parentEdgeId = getParentEdgeId(outline, parentNodeId);
    let insertionIndex = currentIndex;
    for (const childEdgeId of childEdgeIds) {
      moveEdge(outline, childEdgeId, parentNodeId, insertionIndex, origin);
      insertionIndex += 1;
    }
    removeEdge(outline, edgeId, { origin });

    if (!parentEdgeId) {
      return null;
    }

    return {
      edgeId: parentEdgeId,
      nodeId: parentNodeId,
      cursor: "end"
    } satisfies MergeWithPreviousResult;
  }

  if (currentIndex <= 0) {
    return null;
  }

  const previousEdgeId = siblings[currentIndex - 1];
  const previousSnapshot = getEdgeSnapshot(outline, previousEdgeId);
  const previousChildren = getChildEdgeIds(outline, previousSnapshot.childNodeId);
  if (childEdgeIds.length > 0 && previousChildren.length > 0) {
    return null;
  }

  const previousText = getNodeText(outline, previousSnapshot.childNodeId);
  const mergeOffset = previousText.length;
  setNodeText(outline, previousSnapshot.childNodeId, `${previousText}${nodeText}`, origin);

  let insertionIndex = previousChildren.length;
  for (const childEdgeId of childEdgeIds) {
    moveEdge(outline, childEdgeId, previousSnapshot.childNodeId, insertionIndex, origin);
    insertionIndex += 1;
  }

  removeEdge(outline, edgeId, { origin });
  // TODO(@codex): Update wikilink targets to reference previousSnapshot.childNodeId once the
  // linking subsystem exists.
  return {
    edgeId: previousEdgeId,
    nodeId: previousSnapshot.childNodeId,
    cursor: { type: "offset", index: mergeOffset }
  } satisfies MergeWithPreviousResult;
};

export interface DeleteEdgesPlan {
  readonly topLevelEdgeIds: readonly EdgeId[];
  readonly removalOrder: readonly EdgeId[];
  readonly nextEdgeId: EdgeId | null;
}

export interface DeleteEdgesResult {
  readonly deletedEdgeIds: readonly EdgeId[];
  readonly nextEdgeId: EdgeId | null;
}

export const createDeleteEdgesPlan = (
  outline: OutlineDoc,
  edgeIds: ReadonlyArray<EdgeId>
): DeleteEdgesPlan | null => {
  const uniqueEdgeIds = dedupeEdgeIds(edgeIds);
  if (uniqueEdgeIds.length === 0) {
    return null;
  }

  const candidateSet = new Set(uniqueEdgeIds);
  const topLevel: EdgeId[] = [];
  for (const edgeId of uniqueEdgeIds) {
    if (!edgeExists(outline, edgeId)) {
      continue;
    }
    if (!hasAncestorInSelection(outline, edgeId, candidateSet)) {
      topLevel.push(edgeId);
    }
  }

  if (topLevel.length === 0) {
    return null;
  }

  const removalSet = new Set<EdgeId>();
  const depthMap = new Map<EdgeId, number>();
  const encounterOrder = new Map<EdgeId, number>();
  let encounterIndex = 0;

  const visit = (edgeId: EdgeId, depth: number) => {
    if (removalSet.has(edgeId)) {
      const previousDepth = depthMap.get(edgeId) ?? depth;
      if (depth > previousDepth) {
        depthMap.set(edgeId, depth);
      }
      return;
    }

    removalSet.add(edgeId);
    depthMap.set(edgeId, depth);
    encounterOrder.set(edgeId, encounterIndex);
    encounterIndex += 1;

    const snapshot = getEdgeSnapshot(outline, edgeId);
    const children = getChildEdgeIds(outline, snapshot.childNodeId);
    for (const childEdgeId of children) {
      visit(childEdgeId, depth + 1);
    }
  };

  for (const edgeId of topLevel) {
    visit(edgeId, 0);
  }

  if (removalSet.size === 0) {
    return null;
  }

  const removalOrder = [...removalSet].sort((left, right) => {
    const depthDelta = (depthMap.get(right) ?? 0) - (depthMap.get(left) ?? 0);
    if (depthDelta !== 0) {
      return depthDelta;
    }
    return (encounterOrder.get(left) ?? 0) - (encounterOrder.get(right) ?? 0);
  });

  const removedSet = new Set(removalOrder);
  const lastTopLevel = topLevel[topLevel.length - 1]!;
  const nextEdgeId =
    resolveNextEdge(outline, lastTopLevel, removedSet)
    ?? resolvePreviousEdge(outline, topLevel[0]!, removedSet);

  return {
    topLevelEdgeIds: topLevel,
    removalOrder,
    nextEdgeId
  } satisfies DeleteEdgesPlan;
};

export const deleteEdges = (
  context: CommandContext,
  plan: DeleteEdgesPlan
): DeleteEdgesResult => {
  const { outline, origin } = context;
  for (const edgeId of plan.removalOrder) {
    if (!edgeExists(outline, edgeId)) {
      continue;
    }
    removeEdge(outline, edgeId, { origin });
  }

  const resolvedNext = plan.nextEdgeId && edgeExists(outline, plan.nextEdgeId)
    ? plan.nextEdgeId
    : null;

  return {
    deletedEdgeIds: plan.removalOrder,
    nextEdgeId: resolvedNext
  } satisfies DeleteEdgesResult;
};

const getSiblingEdges = (outline: OutlineDoc, parentNodeId: NodeId | null): EdgeId[] => {
  return parentNodeId === null ? outline.rootEdges.toArray() : [...getChildEdgeIds(outline, parentNodeId)];
};

const hasAncestorInSelection = (
  outline: OutlineDoc,
  edgeId: EdgeId,
  selection: ReadonlySet<EdgeId>
): boolean => {
  const visited = new Set<NodeId>();
  let currentParentNodeId = getEdgeSnapshot(outline, edgeId).parentNodeId;

  while (currentParentNodeId) {
    if (visited.has(currentParentNodeId)) {
      break;
    }
    visited.add(currentParentNodeId);
    const parentEdgeId = getParentEdgeId(outline, currentParentNodeId);
    if (!parentEdgeId) {
      return false;
    }
    if (selection.has(parentEdgeId)) {
      return true;
    }
    currentParentNodeId = getEdgeSnapshot(outline, parentEdgeId).parentNodeId;
  }

  return false;
};

const resolveNextEdge = (
  outline: OutlineDoc,
  referenceEdgeId: EdgeId,
  removed: ReadonlySet<EdgeId>
): EdgeId | null => {
  const visited = new Set<EdgeId>();
  let current: EdgeId | null = referenceEdgeId;

  while (current) {
    if (visited.has(current)) {
      return null;
    }
    visited.add(current);
    const candidate = findNextEdge(outline, current);
    if (!candidate) {
      return null;
    }
    if (!removed.has(candidate)) {
      return candidate;
    }
    current = candidate;
  }

  return null;
};

const resolvePreviousEdge = (
  outline: OutlineDoc,
  referenceEdgeId: EdgeId,
  removed: ReadonlySet<EdgeId>
): EdgeId | null => {
  const visited = new Set<EdgeId>();
  let current: EdgeId | null = referenceEdgeId;

  while (current) {
    if (visited.has(current)) {
      return null;
    }
    visited.add(current);
    const candidate = findPreviousEdge(outline, current);
    if (!candidate) {
      return null;
    }
    if (!removed.has(candidate)) {
      return candidate;
    }
    current = candidate;
  }

  return null;
};

const findNextEdge = (outline: OutlineDoc, edgeId: EdgeId): EdgeId | null => {
  const snapshot = getEdgeSnapshot(outline, edgeId);
  const siblings = getSiblingEdges(outline, snapshot.parentNodeId);
  const index = siblings.indexOf(edgeId);
  if (index === -1) {
    return null;
  }
  if (index + 1 < siblings.length) {
    return siblings[index + 1] ?? null;
  }
  if (snapshot.parentNodeId === null) {
    return null;
  }
  const parentEdgeId = getParentEdgeId(outline, snapshot.parentNodeId);
  if (!parentEdgeId) {
    return null;
  }
  return findNextEdge(outline, parentEdgeId);
};

const findPreviousEdge = (outline: OutlineDoc, edgeId: EdgeId): EdgeId | null => {
  const snapshot = getEdgeSnapshot(outline, edgeId);
  const siblings = getSiblingEdges(outline, snapshot.parentNodeId);
  const index = siblings.indexOf(edgeId);
  if (index === -1) {
    return null;
  }
  if (index > 0) {
    return findDeepestDescendant(outline, siblings[index - 1]!);
  }
  if (snapshot.parentNodeId === null) {
    return null;
  }
  return getParentEdgeId(outline, snapshot.parentNodeId);
};

const findDeepestDescendant = (outline: OutlineDoc, edgeId: EdgeId): EdgeId => {
  let current = edgeId;
  let children = getChildEdgeIds(outline, getEdgeSnapshot(outline, current).childNodeId);

  while (children.length > 0) {
    current = children[children.length - 1]!;
    children = getChildEdgeIds(outline, getEdgeSnapshot(outline, current).childNodeId);
  }

  return current;
};

interface MoveTarget {
  readonly edgeId: EdgeId;
  readonly nodeId: NodeId;
}

interface IndentTarget extends MoveTarget {
  readonly parentNodeId: NodeId;
  readonly parentOrder: number;
  readonly sourceIndex: number;
}

interface OutdentTarget extends MoveTarget {
  readonly parentNodeId: NodeId | null;
  readonly position: number;
}

const collectIndentTargets = (
  outline: OutlineDoc,
  edgeIds: ReadonlyArray<EdgeId>
): ReadonlyArray<IndentTarget> | null => {
  const uniqueEdgeIds = dedupeEdgeIds(edgeIds);
  if (uniqueEdgeIds.length === 0) {
    return [];
  }

  const selection = new Set(uniqueEdgeIds);
  const parentOrderMap = new Map<NodeId, number>();
  let nextParentOrder = 0;
  const targets: IndentTarget[] = [];

  for (const edgeId of uniqueEdgeIds) {
    const snapshot = getEdgeSnapshot(outline, edgeId);
    const siblings = getSiblingEdges(outline, snapshot.parentNodeId);
    const currentIndex = siblings.indexOf(edgeId);
    if (currentIndex <= 0) {
      return null;
    }

    let newParentEdgeId: EdgeId | null = null;
    for (let candidateIndex = currentIndex - 1; candidateIndex >= 0; candidateIndex -= 1) {
      const candidateEdgeId = siblings[candidateIndex];
      if (!selection.has(candidateEdgeId)) {
        newParentEdgeId = candidateEdgeId;
        break;
      }
    }

    if (!newParentEdgeId) {
      return null;
    }

    const newParentEdge = getEdgeSnapshot(outline, newParentEdgeId);
    const parentNodeId = newParentEdge.childNodeId;
    let parentOrder = parentOrderMap.get(parentNodeId);
    if (parentOrder === undefined) {
      parentOrder = nextParentOrder;
      parentOrderMap.set(parentNodeId, parentOrder);
      nextParentOrder += 1;
    }

    targets.push({
      edgeId,
      nodeId: snapshot.childNodeId,
      parentNodeId,
      parentOrder,
      sourceIndex: currentIndex
    });
  }

  return targets;
};

const collectOutdentTargets = (
  outline: OutlineDoc,
  edgeIds: ReadonlyArray<EdgeId>
): ReadonlyArray<OutdentTarget> | null => {
  const uniqueEdgeIds = dedupeEdgeIds(edgeIds);
  if (uniqueEdgeIds.length === 0) {
    return [];
  }

  const targets: OutdentTarget[] = [];
  const positionOffsets = new Map<NodeId | null, number>();
  for (const edgeId of uniqueEdgeIds) {
    const snapshot = getEdgeSnapshot(outline, edgeId);
    if (snapshot.parentNodeId === null) {
      return null;
    }

    const parentEdgeId = getParentEdgeId(outline, snapshot.parentNodeId);
    const parentEdge = parentEdgeId ? getEdgeSnapshot(outline, parentEdgeId) : null;
    const parentSiblings = getSiblingEdges(outline, parentEdge ? parentEdge.parentNodeId : null);
    const parentIndex = parentEdge ? parentSiblings.indexOf(parentEdge.id) : parentSiblings.length;
    const targetParentNodeId = parentEdge ? parentEdge.parentNodeId : null;
    const basePosition = parentIndex + 1;
    const offset = positionOffsets.get(targetParentNodeId) ?? 0;
    positionOffsets.set(targetParentNodeId, offset + 1);

    targets.push({
      edgeId,
      nodeId: snapshot.childNodeId,
      parentNodeId: targetParentNodeId,
      position: basePosition + offset
    });
  }

  return targets;
};

const dedupeEdgeIds = (edgeIds: ReadonlyArray<EdgeId>): EdgeId[] => {
  const seen = new Set<EdgeId>();
  const unique: EdgeId[] = [];
  edgeIds.forEach((edgeId) => {
    if (!seen.has(edgeId)) {
      seen.add(edgeId);
      unique.push(edgeId);
    }
  });
  return unique;
};
