/**
 * Mirror creation command orchestrates converting empty bullets into mirrors or inserting
 * sibling mirrors when the current node already contains content. Keeping the logic in the
 * shared client-core package lets every platform reuse the same transactional behaviour.
 */
import * as Y from "yjs";

import {
  addEdge,
  getChildEdgeIds,
  getEdgeSnapshot,
  getNodeText,
  getRootEdgeIds,
  nodeExists,
  withTransaction
} from "../doc";
import { EDGE_CHILD_NODE_KEY, EDGE_MIRROR_KEY } from "../doc/constants";
import { OutlineError } from "../doc/transactions";
import type { EdgeId, NodeId } from "../ids";
import type { OutlineDoc } from "../types";

export type MirrorCreationMode = "converted" | "inserted";

export interface CreateMirrorEdgeOptions {
  readonly outline: OutlineDoc;
  readonly mirrorNodeId: NodeId;
  readonly targetEdgeId?: EdgeId | null;
  readonly insertParentNodeId?: NodeId | null;
  readonly insertIndex?: number;
  readonly origin?: unknown;
}

export interface CreateMirrorEdgeResult {
  readonly mode: MirrorCreationMode;
  readonly edgeId: EdgeId;
  readonly nodeId: NodeId;
}

const countNodeReferences = (outline: OutlineDoc, nodeId: NodeId): number => {
  let count = 0;
  outline.edges.forEach((record) => {
    if (!(record instanceof Y.Map)) {
      return;
    }
    const child = record.get(EDGE_CHILD_NODE_KEY);
    if (typeof child === "string" && (child as NodeId) === nodeId) {
      count += 1;
    }
  });
  return count;
};

const convertEdgeToMirror = (
  options: CreateMirrorEdgeOptions,
  previousNodeId: NodeId
): CreateMirrorEdgeResult => {
  const { outline, targetEdgeId, mirrorNodeId, origin } = options;
  if (!targetEdgeId) {
    throw new OutlineError("Mirror conversion requires a target edge");
  }
  withTransaction(
    outline,
    () => {
      const record = outline.edges.get(targetEdgeId);
      if (!(record instanceof Y.Map)) {
        throw new OutlineError(`Edge ${targetEdgeId} not found for mirror conversion`);
      }
      record.set(EDGE_CHILD_NODE_KEY, mirrorNodeId);
      record.set(EDGE_MIRROR_KEY, mirrorNodeId);

      if (previousNodeId !== mirrorNodeId) {
        outline.nodes.delete(previousNodeId);
      }
      outline.childEdgeMap.delete(previousNodeId);
    },
    origin
  );

  return {
    mode: "converted",
    edgeId: targetEdgeId,
    nodeId: mirrorNodeId
  };
};

const insertMirrorAtParent = (
  outline: OutlineDoc,
  mirrorNodeId: NodeId,
  parentNodeId: NodeId | null,
  position: number,
  origin?: unknown
): CreateMirrorEdgeResult => {
  const boundedPosition = Math.max(0, position);
  const { edgeId } = addEdge(outline, {
    parentNodeId,
    childNodeId: mirrorNodeId,
    position: boundedPosition,
    mirrorOfNodeId: mirrorNodeId,
    origin
  });
  return {
    mode: "inserted",
    edgeId,
    nodeId: mirrorNodeId
  };
};

export const createMirrorEdge = (
  options: CreateMirrorEdgeOptions
): CreateMirrorEdgeResult | null => {
  const { outline, targetEdgeId = null, mirrorNodeId } = options;

  if (!nodeExists(outline, mirrorNodeId)) {
    return null;
  }

  if (targetEdgeId === null) {
    if (options.insertParentNodeId === undefined || options.insertIndex === undefined) {
      return null;
    }
    const parentNodeId = options.insertParentNodeId ?? null;
    const insertIndex = options.insertIndex;
    return insertMirrorAtParent(
      outline,
      mirrorNodeId,
      parentNodeId,
      insertIndex,
      options.origin
    );
  }

  try {
    const targetSnapshot = getEdgeSnapshot(outline, targetEdgeId);
    const targetNodeId = targetSnapshot.childNodeId;
    const mirrorAlready = targetSnapshot.mirrorOfNodeId !== null;
    const trimmedText = getNodeText(outline, targetNodeId).trim();
    const hasChildren = getChildEdgeIds(outline, targetNodeId).length > 0;
    const referenceCount = countNodeReferences(outline, targetNodeId);
    const canConvert =
      !mirrorAlready
      && mirrorNodeId !== targetNodeId
      && trimmedText.length === 0
      && !hasChildren
      && referenceCount === 1;

    if (canConvert) {
      return convertEdgeToMirror(options, targetNodeId);
    }

    const parentNodeId = options.insertParentNodeId ?? targetSnapshot.parentNodeId;
    const insertIndex =
      options.insertIndex !== undefined
        ? options.insertIndex
        : (() => {
            const siblings = parentNodeId === null
              ? getRootEdgeIds(outline)
              : getChildEdgeIds(outline, parentNodeId);
            const referenceIndex = siblings.indexOf(targetEdgeId);
            return referenceIndex === -1 ? siblings.length : referenceIndex + 1;
          })();

    return insertMirrorAtParent(
      outline,
      mirrorNodeId,
      parentNodeId,
      insertIndex,
      options.origin
    );
  } catch (error) {
    if (error instanceof OutlineError) {
      return null;
    }
    throw error;
  }
};
