/**
 * Edge lifecycle helpers covering creation, movement, collapse state, and reconciliation. They
 * rely on node helpers for child lifecycle and enforce invariants such as cycle prevention and
 * stable ordering within each parent edge array.
 */
import * as Y from "yjs";

import { createEdgeId, type EdgeId, type NodeId } from "../ids";
import type {
  AddEdgeOptions,
  EdgeSnapshot,
  OutlineDoc,
  OutlineEdgeRecord
} from "../types";
import {
  EDGE_CHILD_NODE_KEY,
  EDGE_COLLAPSED_KEY,
  EDGE_MIRROR_KEY,
  EDGE_PARENT_NODE_KEY,
  EDGE_POSITION_KEY
} from "./constants";
import { createNode, nodeExists } from "./nodes";
import { OutlineError, withTransaction } from "./transactions";

export const edgeExists = (outline: OutlineDoc, edgeId: EdgeId): boolean => outline.edges.has(edgeId);

export const addEdge = (
  outline: OutlineDoc,
  options: AddEdgeOptions
): { edgeId: EdgeId; nodeId: NodeId } => {
  if (options.parentNodeId !== null && !nodeExists(outline, options.parentNodeId)) {
    throw new OutlineError(`Parent node ${options.parentNodeId} does not exist`);
  }

  let childNodeId = options.childNodeId;

  if (!childNodeId) {
    childNodeId = createNode(outline, {
      text: options.text,
      metadata: options.metadata,
      origin: options.origin
    });
  } else if (!nodeExists(outline, childNodeId)) {
    throw new OutlineError(`Child node ${childNodeId} does not exist`);
  }

  if (options.parentNodeId && childNodeId) {
    assertNoCycle(outline, options.parentNodeId, childNodeId);
  }

  const edgeId = createEdgeId();

  withTransaction(outline, () => {
    const record = new Y.Map<unknown>();
    record.set(EDGE_PARENT_NODE_KEY, options.parentNodeId);
    record.set(EDGE_CHILD_NODE_KEY, childNodeId);
    record.set(EDGE_COLLAPSED_KEY, options.collapsed ?? false);
    // Mirrors are represented as edges pointing at the same child node. `mirrorOfNodeId`
    // persists the canonical source so UI layers can apply mirror-specific chrome without
    // duplicating node content or breaking undo history.
    record.set(EDGE_MIRROR_KEY, options.mirrorOfNodeId ?? null);
    record.set(EDGE_POSITION_KEY, 0);

    outline.edges.set(edgeId, record);

    const targetArray = getEdgeArrayForParent(outline, options.parentNodeId);
    const insertIndex = resolveInsertIndex(targetArray, options.position);
    targetArray.insert(insertIndex, [edgeId]);

    updatePositionsForParent(outline, options.parentNodeId);
  }, options.origin);

  return { edgeId, nodeId: childNodeId! };
};

export const getEdgeSnapshot = (outline: OutlineDoc, edgeId: EdgeId): EdgeSnapshot => {
  const record = outline.edges.get(edgeId);
  if (!record) {
    throw new OutlineError(`Edge ${edgeId} not found`);
  }

  return readEdgeSnapshot(edgeId, record);
};

export const getParentEdgeId = (outline: OutlineDoc, nodeId: NodeId): EdgeId | null => {
  let parentEdgeId: EdgeId | null = null;
  outline.edges.forEach((_record, candidateId) => {
    if (parentEdgeId) {
      return;
    }
    const record = outline.edges.get(candidateId as EdgeId);
    if (!(record instanceof Y.Map)) {
      return;
    }
    const child = record.get(EDGE_CHILD_NODE_KEY);
    if (typeof child === "string" && (child as NodeId) === nodeId) {
      parentEdgeId = candidateId as EdgeId;
    }
  });
  return parentEdgeId;
};

export const getChildEdgeIds = (outline: OutlineDoc, parentNodeId: NodeId): ReadonlyArray<EdgeId> => {
  const array = outline.childEdgeMap.get(parentNodeId);
  return array ? array.toArray() : ([] as EdgeId[]);
};

export const getRootEdgeIds = (outline: OutlineDoc): ReadonlyArray<EdgeId> => {
  return outline.rootEdges.toArray();
};

export const moveEdge = (
  outline: OutlineDoc,
  edgeId: EdgeId,
  targetParentNodeId: NodeId | null,
  targetPosition: number,
  origin?: unknown
): void => {
  withTransaction(
    outline,
    () => {
      const record = outline.edges.get(edgeId);
      if (!(record instanceof Y.Map)) {
        throw new OutlineError(`Edge ${edgeId} not found`);
      }

      const currentParent = record.get(EDGE_PARENT_NODE_KEY) as NodeId | null;
      if (currentParent === targetParentNodeId) {
        repositionWithinParent(outline, edgeId, currentParent, targetPosition);
        return;
      }

      removeEdgeFromParent(outline, edgeId, currentParent);

      record.set(EDGE_PARENT_NODE_KEY, targetParentNodeId);

      insertEdgeIntoParent(outline, edgeId, targetParentNodeId, targetPosition);
    },
    origin
  );
};

export const toggleEdgeCollapsed = (
  outline: OutlineDoc,
  edgeId: EdgeId,
  collapsed?: boolean,
  origin?: unknown
): boolean => {
  let nextValue = false;
  withTransaction(
    outline,
    () => {
      const record = outline.edges.get(edgeId);
      if (!(record instanceof Y.Map)) {
        throw new OutlineError(`Edge ${edgeId} not found`);
      }
      const previous = Boolean(record.get(EDGE_COLLAPSED_KEY));
      nextValue = collapsed === undefined ? !previous : collapsed;
      record.set(EDGE_COLLAPSED_KEY, nextValue);
    },
    origin
  );
  return nextValue;
};

export interface RemoveEdgeOptions {
  readonly origin?: unknown;
  readonly removeChildNodeIfOrphaned?: boolean;
  readonly suppressTransaction?: boolean;
}

export const removeEdge = (
  outline: OutlineDoc,
  edgeId: EdgeId,
  options: RemoveEdgeOptions = {}
): void => {
  const { origin, removeChildNodeIfOrphaned = true, suppressTransaction = false } = options;

  const performRemoval = (): void => {
    const record = outline.edges.get(edgeId);
    if (!(record instanceof Y.Map)) {
      throw new OutlineError(`Edge ${edgeId} not found`);
    }

    const parentValue = record.get(EDGE_PARENT_NODE_KEY);
    const typedParent = typeof parentValue === "string" ? (parentValue as NodeId) : null;
    const childValue = record.get(EDGE_CHILD_NODE_KEY);
    if (typeof childValue !== "string") {
      throw new OutlineError(`Edge ${edgeId} has no child node`);
    }
    const childNodeId = childValue as NodeId;

    removeEdgeFromParent(outline, edgeId, typedParent);
    outline.edges.delete(edgeId);

    if (removeChildNodeIfOrphaned && !isNodeReferenced(outline, childNodeId)) {
      outline.nodes.delete(childNodeId);
      outline.childEdgeMap.delete(childNodeId);
    }
  };

  if (suppressTransaction) {
    performRemoval();
    return;
  }

  withTransaction(outline, performRemoval, origin);
};

export interface ReconcileOutlineStructureOptions {
  readonly origin?: unknown;
  readonly edgeFilter?: ReadonlySet<EdgeId> | null;
}

export const reconcileOutlineStructure = (
  outline: OutlineDoc,
  options: ReconcileOutlineStructureOptions = {}
): number => {
  const filter = options.edgeFilter ?? null;
  const expectations = collectExpectations(outline, filter);
  const placements = collectActualPlacements(outline, filter);
  const removals = new Map<ParentPlacementKey, ParentPlacement>();
  const requiredInsertions = new Map<EdgeId, EdgeExpectation>();

  placements.forEach((parentPlacements, edgeId) => {
    const expectation = expectations.get(edgeId);
    if (!expectation) {
      parentPlacements.forEach((indices, parentNodeId) => {
        const placement = ensureRemovalEntry(removals, edgeId, parentNodeId);
        placement.count += indices.length;
      });
      return;
    }

    parentPlacements.forEach((indices, parentNodeId) => {
      if (parentNodeId !== expectation.parentNodeId) {
        const placement = ensureRemovalEntry(removals, edgeId, parentNodeId);
        placement.count += indices.length;
        return;
      }

      if (indices.length > 1) {
        const placement = ensureRemovalEntry(removals, edgeId, parentNodeId);
        placement.count += indices.length - 1;
      }
    });

    if (!parentPlacements.has(expectation.parentNodeId)) {
      requiredInsertions.set(edgeId, expectation);
    }
  });

  expectations.forEach((expectation, edgeId) => {
    if (placements.has(edgeId)) {
      return;
    }
    requiredInsertions.set(edgeId, expectation);
  });

  if (removals.size === 0 && requiredInsertions.size === 0) {
    return 0;
  }

  let corrections = 0;

  withTransaction(
    outline,
    () => {
      removals.forEach((placement) => {
        corrections += removeEdgeOccurrences(outline, placement.edgeId, placement.parentNodeId, placement.count);
      });

      requiredInsertions.forEach((expectation, edgeId) => {
        corrections += insertEdgeIfMissing(outline, edgeId, expectation.parentNodeId, expectation.position);
      });
    },
    options.origin
  );

  return corrections;
};

export const readEdgeSnapshot = (edgeId: EdgeId, record: OutlineEdgeRecord): EdgeSnapshot => {
  const parentNodeId = record.get(EDGE_PARENT_NODE_KEY);
  const childNodeId = record.get(EDGE_CHILD_NODE_KEY);
  const collapsed = record.get(EDGE_COLLAPSED_KEY);
  const mirrorNodeId = record.get(EDGE_MIRROR_KEY);
  const position = record.get(EDGE_POSITION_KEY);

  return {
    id: edgeId,
    canonicalEdgeId: edgeId,
    parentNodeId: typeof parentNodeId === "string" ? (parentNodeId as NodeId) : null,
    childNodeId: typeof childNodeId === "string" ? (childNodeId as NodeId) : ("" as NodeId),
    collapsed: Boolean(collapsed),
    mirrorOfNodeId: typeof mirrorNodeId === "string" ? (mirrorNodeId as NodeId) : null,
    position: typeof position === "number" ? position : 0
  };
};

type ParentPlacementKey = string;

interface ParentPlacement {
  readonly edgeId: EdgeId;
  readonly parentNodeId: NodeId | null;
  count: number;
}

interface EdgeExpectation {
  readonly parentNodeId: NodeId | null;
  readonly position: number;
}

const removeEdgeFromParent = (
  outline: OutlineDoc,
  edgeId: EdgeId,
  parentNodeId: NodeId | null
): void => {
  const target = getEdgeArrayForParent(outline, parentNodeId);
  const currentIndex = target.toArray().indexOf(edgeId);
  if (currentIndex >= 0) {
    target.delete(currentIndex, 1);
  }

  updatePositionsForParent(outline, parentNodeId);
};

const insertEdgeIntoParent = (
  outline: OutlineDoc,
  edgeId: EdgeId,
  parentNodeId: NodeId | null,
  targetPosition: number
): void => {
  const target = getEdgeArrayForParent(outline, parentNodeId);
  const insertAt = resolveInsertIndex(target, targetPosition);
  target.insert(insertAt, [edgeId]);
  const record = outline.edges.get(edgeId);
  if (record instanceof Y.Map) {
    record.set(EDGE_POSITION_KEY, insertAt);
  }
  updatePositionsForParent(outline, parentNodeId);
};

const repositionWithinParent = (
  outline: OutlineDoc,
  edgeId: EdgeId,
  parentNodeId: NodeId | null,
  targetPosition: number
): void => {
  const target = getEdgeArrayForParent(outline, parentNodeId);
  const currentIndex = target.toArray().indexOf(edgeId);
  if (currentIndex === -1) {
    insertEdgeIntoParent(outline, edgeId, parentNodeId, targetPosition);
    return;
  }

  const desiredIndex = resolveInsertIndex(target, targetPosition);
  if (desiredIndex === currentIndex) {
    return;
  }

  target.delete(currentIndex, 1);
  const adjustedIndex = desiredIndex > currentIndex ? desiredIndex - 1 : desiredIndex;
  target.insert(adjustedIndex, [edgeId]);
  updatePositionsForParent(outline, parentNodeId);
};

const getEdgeArrayForParent = (outline: OutlineDoc, parentNodeId: NodeId | null): Y.Array<EdgeId> => {
  if (parentNodeId === null) {
    return outline.rootEdges;
  }

  let array = outline.childEdgeMap.get(parentNodeId);
  if (!array) {
    array = new Y.Array<EdgeId>();
    outline.childEdgeMap.set(parentNodeId, array);
  }
  return array;
};

const resolveInsertIndex = (target: Y.Array<EdgeId>, position?: number): number => {
  if (position === undefined || Number.isNaN(position)) {
    return target.length;
  }
  if (position < 0) {
    return 0;
  }
  if (position > target.length) {
    return target.length;
  }
  return position;
};

const updatePositionsForParent = (outline: OutlineDoc, parentNodeId: NodeId | null): void => {
  const target = getEdgeArrayForParent(outline, parentNodeId);
  target.toArray().forEach((id, index) => {
    const record = outline.edges.get(id);
    if (record instanceof Y.Map) {
      record.set(EDGE_POSITION_KEY, index);
    }
  });
};

const assertNoCycle = (outline: OutlineDoc, parentNodeId: NodeId, childNodeId: NodeId): void => {
  if (parentNodeId === childNodeId) {
    throw new OutlineError("Cannot make a node a child of itself");
  }

  const visited = new Set<NodeId>();
  const queue: NodeId[] = [childNodeId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === parentNodeId) {
      throw new OutlineError("Operation would create a cycle in the outline");
    }

    if (visited.has(current)) {
      continue;
    }
    visited.add(current);

    const childEdges = outline.childEdgeMap.get(current);
    if (!childEdges) {
      continue;
    }

    childEdges.toArray().forEach((edgeId) => {
      const record = outline.edges.get(edgeId);
      if (record instanceof Y.Map) {
        const descendant = record.get(EDGE_CHILD_NODE_KEY);
        if (typeof descendant === "string") {
          queue.push(descendant as NodeId);
        }
      }
    });
  }
};

const ensureRemovalEntry = (
  removals: Map<ParentPlacementKey, ParentPlacement>,
  edgeId: EdgeId,
  parentNodeId: NodeId | null
): ParentPlacement => {
  const key = `${edgeId}:${createParentKey(parentNodeId)}`;
  let placement = removals.get(key);
  if (!placement) {
    placement = { edgeId, parentNodeId, count: 0 };
    removals.set(key, placement);
  }
  return placement;
};

const shouldCheckEdge = (filter: ReadonlySet<EdgeId> | null, edgeId: EdgeId): boolean => {
  if (!filter) {
    return true;
  }
  return filter.has(edgeId);
};

const collectActualPlacements = (
  outline: OutlineDoc,
  filter: ReadonlySet<EdgeId> | null
): Map<EdgeId, Map<NodeId | null, number[]>> => {
  const placements = new Map<EdgeId, Map<NodeId | null, number[]>>();

  const registerPlacement = (edgeId: EdgeId, parentNodeId: NodeId | null, index: number) => {
    if (!shouldCheckEdge(filter, edgeId)) {
      return;
    }
    let parentPlacements = placements.get(edgeId);
    if (!parentPlacements) {
      parentPlacements = new Map<NodeId | null, number[]>();
      placements.set(edgeId, parentPlacements);
    }
    let indices = parentPlacements.get(parentNodeId);
    if (!indices) {
      indices = [];
      parentPlacements.set(parentNodeId, indices);
    }
    indices.push(index);
  };

  outline.rootEdges.toArray().forEach((edgeId, index) => registerPlacement(edgeId, null, index));

  outline.childEdgeMap.forEach((array, parentNodeId) => {
    const typedParent = parentNodeId as NodeId;
    array.toArray().forEach((edgeId, index) => {
      registerPlacement(edgeId, typedParent, index);
    });
  });

  return placements;
};

const collectExpectations = (
  outline: OutlineDoc,
  filter: ReadonlySet<EdgeId> | null
): Map<EdgeId, EdgeExpectation> => {
  const expectations = new Map<EdgeId, EdgeExpectation>();
  outline.edges.forEach((record, id) => {
    const edgeId = id as EdgeId;
    if (!shouldCheckEdge(filter, edgeId)) {
      return;
    }
    if (!(record instanceof Y.Map)) {
      return;
    }
    const snapshot = readEdgeSnapshot(edgeId, record);
    expectations.set(edgeId, {
      parentNodeId: snapshot.parentNodeId,
      position: snapshot.position
    });
  });
  return expectations;
};

const isNodeReferenced = (outline: OutlineDoc, nodeId: NodeId): boolean => {
  let referenced = false;
  outline.edges.forEach((record) => {
    if (referenced) {
      return;
    }
    if (!(record instanceof Y.Map)) {
      return;
    }
    const childValue = record.get(EDGE_CHILD_NODE_KEY);
    if (typeof childValue === "string" && (childValue as NodeId) === nodeId) {
      referenced = true;
    }
  });
  return referenced;
};

const removeEdgeOccurrences = (
  outline: OutlineDoc,
  edgeId: EdgeId,
  parentNodeId: NodeId | null,
  count: number
): number => {
  if (count <= 0) {
    return 0;
  }

  const target = getEdgeArrayForParent(outline, parentNodeId);
  let removed = 0;
  for (let index = target.length - 1; index >= 0 && removed < count; index -= 1) {
    if (target.get(index) === edgeId) {
      target.delete(index, 1);
      removed += 1;
    }
  }

  if (removed > 0) {
    updatePositionsForParent(outline, parentNodeId);
  }

  return removed;
};

const insertEdgeIfMissing = (
  outline: OutlineDoc,
  edgeId: EdgeId,
  parentNodeId: NodeId | null,
  position: number
): number => {
  const target = getEdgeArrayForParent(outline, parentNodeId);
  for (let index = 0; index < target.length; index += 1) {
    if (target.get(index) === edgeId) {
      return 0;
    }
  }

  insertEdgeIntoParent(outline, edgeId, parentNodeId, position);
  return 1;
};

const createParentKey = (parentNodeId: NodeId | null): string => {
  return parentNodeId ?? "<root>";
};
