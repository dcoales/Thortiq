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
  getParentEdgeId,
  moveEdge,
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

const getSiblingEdges = (outline: OutlineDoc, parentNodeId: NodeId | null): EdgeId[] => {
  return parentNodeId === null ? outline.rootEdges.toArray() : [...getChildEdgeIds(outline, parentNodeId)];
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
