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
  getNodeMetadata,
  getNodeText,
  getParentEdgeId,
  edgeExists,
  moveEdge,
  removeEdge,
  setNodeLayout,
  setNodeText,
  toggleEdgeCollapsed,
  updateTodoDoneStates,
  EDGE_MIRROR_KEY,
  withTransaction,
  type EdgeId,
  type NodeLayout,
  type NodeId,
  type OutlineDoc,
  type TodoDoneUpdate
} from "@thortiq/client-core";
import * as Y from "yjs";

export interface CommandContext {
  readonly outline: OutlineDoc;
  readonly origin?: unknown;
}

export interface CommandResult {
  readonly edgeId: EdgeId;
  readonly nodeId: NodeId;
}

export type CommandCursorPlacement = "start" | "end" | { readonly type: "offset"; readonly index: number };

export type MoveToInsertionPosition = "start" | "end";

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

  const parentChildState = new Map<EdgeId, boolean>();
  for (const target of targets) {
    if (parentChildState.has(target.parentEdgeId)) {
      continue;
    }
    const existingChildren = getChildEdgeIds(outline, target.parentNodeId);
    parentChildState.set(target.parentEdgeId, existingChildren.length > 0);
  }

  const executionTargets = [...targets].sort((left, right) => {
    if (left.parentOrder !== right.parentOrder) {
      return left.parentOrder - right.parentOrder;
    }
    return left.sourceIndex - right.sourceIndex;
  });

  withTransaction(
    outline,
    () => {
      // Batch indent operations so undo/redo treats the multi-edge move as a single step.
      for (const target of executionTargets) {
        const position = getChildEdgeIds(outline, target.parentNodeId).length;
        moveEdge(outline, target.edgeId, target.parentNodeId, position, origin);
      }

      for (const [parentEdgeId, hadChildren] of parentChildState) {
        if (!hadChildren) {
          toggleEdgeCollapsed(outline, parentEdgeId, false, origin);
        }
      }
    },
    origin
  );

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
  withTransaction(
    outline,
    () => {
      // Group outdent moves so a multi-selection collapse into a single undo entry.
      for (const target of targets) {
        moveEdge(outline, target.edgeId, target.parentNodeId, target.position, origin);
        results.push({ edgeId: target.edgeId, nodeId: target.nodeId });
      }
    },
    origin
  );

  return results;
};

export const toggleTodoDoneCommand = (
  context: CommandContext,
  edgeIds: ReadonlyArray<EdgeId>
): CommandResult[] | null => {
  const { outline, origin } = context;
  const uniqueEdgeIds = dedupeEdgeIds(edgeIds);
  if (uniqueEdgeIds.length === 0) {
    return null;
  }

  const updates: TodoDoneUpdate[] = [];
  const results: CommandResult[] = [];

  for (const edgeId of uniqueEdgeIds) {
    if (!edgeExists(outline, edgeId)) {
      continue;
    }
    const snapshot = getEdgeSnapshot(outline, edgeId);
    const nodeId = snapshot.childNodeId;
    const metadata = getNodeMetadata(outline, nodeId);
    const currentDone = metadata.todo?.done ?? false;
    updates.push({ nodeId, done: !currentDone });
    results.push({ edgeId, nodeId });
  }

  if (updates.length === 0) {
    return null;
  }

  // updateTodoDoneStates wraps updates in a transaction so multi-node toggles undo in one step.
  updateTodoDoneStates(outline, updates, origin);
  return results;
};

const applyLayoutCommand = (
  context: CommandContext,
  edgeIds: ReadonlyArray<EdgeId>,
  layout: NodeLayout
): CommandResult[] | null => {
  const { outline, origin } = context;
  const uniqueEdgeIds = dedupeEdgeIds(edgeIds);
  if (uniqueEdgeIds.length === 0) {
    return null;
  }

  const targetNodeIds: NodeId[] = [];
  const results: CommandResult[] = [];

  for (const edgeId of uniqueEdgeIds) {
    if (!edgeExists(outline, edgeId)) {
      continue;
    }
    const snapshot = getEdgeSnapshot(outline, edgeId);
    const nodeId = snapshot.childNodeId;
    const metadata = getNodeMetadata(outline, nodeId);
    if (metadata.layout === layout) {
      continue;
    }
    targetNodeIds.push(nodeId);
    results.push({ edgeId, nodeId });
  }

  if (targetNodeIds.length === 0) {
    return null;
  }

  setNodeLayout(outline, targetNodeIds, layout, origin);
  return results;
};

export const applyParagraphLayoutCommand = (
  context: CommandContext,
  edgeIds: ReadonlyArray<EdgeId>
): CommandResult[] | null => applyLayoutCommand(context, edgeIds, "paragraph");

export const applyNumberedLayoutCommand = (
  context: CommandContext,
  edgeIds: ReadonlyArray<EdgeId>
): CommandResult[] | null => applyLayoutCommand(context, edgeIds, "numbered");

export const applyStandardLayoutCommand = (
  context: CommandContext,
  edgeIds: ReadonlyArray<EdgeId>
): CommandResult[] | null => applyLayoutCommand(context, edgeIds, "standard");

export const moveEdgesToParent = (
  context: CommandContext,
  edgeIds: ReadonlyArray<EdgeId>,
  targetParentNodeId: NodeId | null,
  position: MoveToInsertionPosition
): CommandResult[] | null => {
  const { outline, origin } = context;
  const uniqueEdgeIds = dedupeEdgeIds(edgeIds);
  if (uniqueEdgeIds.length === 0) {
    return [];
  }

  const selection = new Set(uniqueEdgeIds);
  const targets: Array<{ edgeId: EdgeId; nodeId: NodeId }> = [];

  for (const edgeId of uniqueEdgeIds) {
    if (!edgeExists(outline, edgeId)) {
      continue;
    }
    if (hasAncestorInSelection(outline, edgeId, selection)) {
      continue;
    }
    const snapshot = getEdgeSnapshot(outline, edgeId);
    targets.push({ edgeId, nodeId: snapshot.childNodeId });
  }

  if (targets.length === 0) {
    return [];
  }

  if (targetParentNodeId !== null) {
    for (const target of targets) {
      if (targetParentNodeId === target.nodeId) {
        return null;
      }
      if (isNodeDescendantOf(outline, targetParentNodeId, target.nodeId)) {
        return null;
      }
    }
  }

  const targetEdgeIds = targets.map((target) => target.edgeId);
  const targetEdgeIdSet = new Set(targetEdgeIds);
  const existingChildren = targetParentNodeId === null
    ? outline.rootEdges.toArray()
    : [...getChildEdgeIds(outline, targetParentNodeId)];
  const remainingChildren = existingChildren.filter((edgeId) => !targetEdgeIdSet.has(edgeId));

  const orderedEdgeIds = position === "start"
    ? [...targetEdgeIds, ...remainingChildren]
    : [...remainingChildren, ...targetEdgeIds];

  const indexByEdgeId = new Map<EdgeId, number>();
  orderedEdgeIds.forEach((edgeId, index) => {
    indexByEdgeId.set(edgeId, index);
  });

  const sortedTargets = [...targets].sort((left, right) => {
    const leftIndex = indexByEdgeId.get(left.edgeId) ?? 0;
    const rightIndex = indexByEdgeId.get(right.edgeId) ?? 0;
    return leftIndex - rightIndex;
  });

  const results: CommandResult[] = [];

  withTransaction(
    outline,
    () => {
      for (const target of sortedTargets) {
        const insertionIndex = indexByEdgeId.get(target.edgeId);
        if (insertionIndex === undefined) {
          continue;
        }
        moveEdge(outline, target.edgeId, targetParentNodeId, insertionIndex, origin);
        results.push({ edgeId: target.edgeId, nodeId: target.nodeId });
      }
    },
    origin
  );

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
      withTransaction(
        outline,
        () => {
          let insertionIndex = getChildEdgeIds(outline, previousSnapshot.childNodeId).length;
          for (const childEdgeId of childEdgeIds) {
            moveEdge(outline, childEdgeId, previousSnapshot.childNodeId, insertionIndex, origin);
            insertionIndex += 1;
          }
          removeEdge(outline, edgeId, { origin });
        },
        origin
      );
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
    withTransaction(
      outline,
      () => {
        let insertionIndex = currentIndex;
        for (const childEdgeId of childEdgeIds) {
          moveEdge(outline, childEdgeId, parentNodeId, insertionIndex, origin);
          insertionIndex += 1;
        }
        removeEdge(outline, edgeId, { origin });
      },
      origin
    );

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
  withTransaction(
    outline,
    () => {
      // Merge text + children in one transaction so undo restores the original node coherently.
      setNodeText(outline, previousSnapshot.childNodeId, `${previousText}${nodeText}`, origin);

      let insertionIndex = previousChildren.length;
      for (const childEdgeId of childEdgeIds) {
        moveEdge(outline, childEdgeId, previousSnapshot.childNodeId, insertionIndex, origin);
        insertionIndex += 1;
      }

      removeEdge(outline, edgeId, { origin });
    },
    origin
  );
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
    if (snapshot.mirrorOfNodeId !== null) {
      return;
    }
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
  const removalSet = new Set(plan.removalOrder);
  const topLevelSet = new Set(plan.topLevelEdgeIds);

  const nodeReferenceMap = new Map<NodeId, { originals: EdgeId[]; mirrors: EdgeId[] }>();
  outline.edges.forEach((_record, id) => {
    const edgeId = id as EdgeId;
    const snapshot = getEdgeSnapshot(outline, edgeId);
    const entry = nodeReferenceMap.get(snapshot.childNodeId) ?? { originals: [], mirrors: [] };
    if (snapshot.mirrorOfNodeId === null) {
      entry.originals.push(edgeId);
    } else {
      entry.mirrors.push(edgeId);
    }
    nodeReferenceMap.set(snapshot.childNodeId, entry);
  });

  const promotions = new Map<EdgeId, NodeId>();
  const promotedNodes = new Set<NodeId>();

  for (const edgeId of plan.removalOrder) {
    const snapshot = getEdgeSnapshot(outline, edgeId);
    if (snapshot.mirrorOfNodeId !== null) {
      continue;
    }
    const nodeId = snapshot.childNodeId;
    if (promotedNodes.has(nodeId)) {
      continue;
    }
    const references = nodeReferenceMap.get(nodeId);
    if (!references) {
      continue;
    }
    const survivingOriginal = references.originals.find((originalEdgeId) => originalEdgeId !== edgeId && !removalSet.has(originalEdgeId));
    if (survivingOriginal) {
      continue;
    }
    const candidate = references.mirrors.find((mirrorEdgeId) => !removalSet.has(mirrorEdgeId));
    if (candidate) {
      promotions.set(candidate, nodeId);
      promotedNodes.add(nodeId);
    }
  }

  const survivingNodeIds = new Set<NodeId>();
  nodeReferenceMap.forEach((references, nodeId) => {
    const hasSurvivingOriginal = references.originals.some((edgeId) => !removalSet.has(edgeId));
    const hasSurvivingMirror = references.mirrors.some((edgeId) => !removalSet.has(edgeId));
    if (hasSurvivingOriginal || hasSurvivingMirror) {
      survivingNodeIds.add(nodeId);
    }
  });

  const deletedEdgeIds: EdgeId[] = [];
  withTransaction(
    outline,
    () => {
      promotions.forEach((_nodeId, edgeId) => {
        const record = outline.edges.get(edgeId);
        if (record instanceof Y.Map) {
          record.set(EDGE_MIRROR_KEY, null);
        }
        // Mark the promoted node as surviving to prevent child pruning.
        const promotedSnapshot = getEdgeSnapshot(outline, edgeId);
        survivingNodeIds.add(promotedSnapshot.childNodeId);
      });

      for (const edgeId of plan.removalOrder) {
        if (!edgeExists(outline, edgeId)) {
          continue;
        }

        const snapshot = getEdgeSnapshot(outline, edgeId);
        const parentNodeId = snapshot.parentNodeId;
        const shouldPreserveDescendant =
          !topLevelSet.has(edgeId)
          && parentNodeId !== null
          && survivingNodeIds.has(parentNodeId);
        if (shouldPreserveDescendant) {
          survivingNodeIds.add(snapshot.childNodeId);
          continue;
        }

        removeEdge(outline, edgeId, { origin, suppressTransaction: true });
        deletedEdgeIds.push(edgeId);
      }
    },
    origin
  );

  const resolvedNext = plan.nextEdgeId && edgeExists(outline, plan.nextEdgeId)
    ? plan.nextEdgeId
    : null;

  return {
    deletedEdgeIds,
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

const isNodeDescendantOf = (
  outline: OutlineDoc,
  potentialDescendant: NodeId,
  ancestorCandidate: NodeId
): boolean => {
  if (potentialDescendant === ancestorCandidate) {
    return true;
  }
  const visited = new Set<NodeId>();
  const queue: NodeId[] = [ancestorCandidate];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) {
      continue;
    }
    visited.add(current);
    if (current === potentialDescendant) {
      return true;
    }
    const childEdges = getChildEdgeIds(outline, current);
    childEdges.forEach((edgeId) => {
      const snapshot = getEdgeSnapshot(outline, edgeId);
      queue.push(snapshot.childNodeId);
    });
  }

  return false;
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
  readonly parentEdgeId: EdgeId;
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
    if (hasAncestorInSelection(outline, edgeId, selection)) {
      continue;
    }
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
      parentEdgeId: newParentEdgeId,
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

  const selection = new Set(uniqueEdgeIds);
  const targets: OutdentTarget[] = [];
  const positionOffsets = new Map<NodeId | null, number>();
  for (const edgeId of uniqueEdgeIds) {
    if (hasAncestorInSelection(outline, edgeId, selection)) {
      continue;
    }
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
