/**
 * Snapshot builders convert live Yjs data structures into plain immutable objects so consumers
 * can render or diff outline state without depending on Yjs APIs.
 */
import type { EdgeId, EdgeInstanceId, NodeId } from "../ids";
import { createEdgeInstanceId } from "../ids";
import type {
  EdgeSnapshot,
  NodeSnapshot,
  OutlineDoc,
  OutlineSnapshot
} from "../types";
import { readEdgeSnapshot } from "./edges";
import { readNodeSnapshot } from "./nodes";

export const createOutlineSnapshot = (outline: OutlineDoc): OutlineSnapshot => {
  const nodeEntries = new Map<NodeId, NodeSnapshot>();
  outline.nodes.forEach((record, id) => {
    nodeEntries.set(id as NodeId, readNodeSnapshot(id as NodeId, record));
  });

  const edgeEntries = new Map<EdgeId, EdgeSnapshot>();
  outline.edges.forEach((record, id) => {
    edgeEntries.set(id as EdgeId, readEdgeSnapshot(id as EdgeId, record));
  });

  const childrenByParent = new Map<NodeId, ReadonlyArray<EdgeId>>();
  outline.childEdgeMap.forEach((array, parentId) => {
    const snapshotArray = Object.freeze(array.toArray()) as ReadonlyArray<EdgeId>;
    childrenByParent.set(parentId as NodeId, snapshotArray);
  });

  const childEdgeIdsByParentEdge = new Map<EdgeId, ReadonlyArray<EdgeInstanceId>>();
  const canonicalEdgeIdsByEdgeId = new Map<EdgeId, EdgeId>();
  const queue: Array<{ projectionId: EdgeId; canonicalEdgeId: EdgeId }> = [];
  const processed = new Set<EdgeId>();

  edgeEntries.forEach((_snapshot, edgeId) => {
    canonicalEdgeIdsByEdgeId.set(edgeId, edgeId);
    queue.push({ projectionId: edgeId, canonicalEdgeId: edgeId });
  });

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }
    if (processed.has(current.projectionId)) {
      continue;
    }
    processed.add(current.projectionId);

    const canonicalSnapshot = edgeEntries.get(current.canonicalEdgeId);
    if (!canonicalSnapshot) {
      continue;
    }

    const canonicalChildren =
      childrenByParent.get(canonicalSnapshot.childNodeId)
      ?? (Object.freeze([] as EdgeId[]) as ReadonlyArray<EdgeId>);

    const isCanonicalProjection = current.projectionId === current.canonicalEdgeId;
    const parentIsMirror = canonicalSnapshot.mirrorOfNodeId !== null;

    if (isCanonicalProjection && !parentIsMirror) {
      childEdgeIdsByParentEdge.set(
        current.projectionId,
        canonicalChildren
      );
      canonicalChildren.forEach((childEdgeId) => {
        if (!canonicalEdgeIdsByEdgeId.has(childEdgeId)) {
          canonicalEdgeIdsByEdgeId.set(childEdgeId, childEdgeId);
        }
      });
      continue;
    }

    if (canonicalChildren.length === 0) {
      childEdgeIdsByParentEdge.set(
        current.projectionId,
        Object.freeze([]) as ReadonlyArray<EdgeInstanceId>
      );
      continue;
    }

    const instanceIds: EdgeInstanceId[] = [];

    canonicalChildren.forEach((childEdgeId) => {
      const canonicalChildId = canonicalEdgeIdsByEdgeId.get(childEdgeId) ?? childEdgeId;
      const instanceId = createEdgeInstanceId(current.projectionId, childEdgeId);
      instanceIds.push(instanceId);
      canonicalEdgeIdsByEdgeId.set(instanceId, canonicalChildId);
      if (!edgeEntries.has(instanceId)) {
        const canonicalChildSnapshot = edgeEntries.get(childEdgeId);
        if (canonicalChildSnapshot) {
          const clone: EdgeSnapshot = {
            ...canonicalChildSnapshot,
            id: instanceId,
            canonicalEdgeId: canonicalChildSnapshot.canonicalEdgeId
          };
          edgeEntries.set(instanceId, clone);
        }
      }
      queue.push({ projectionId: instanceId, canonicalEdgeId: childEdgeId });
    });

    childEdgeIdsByParentEdge.set(
      current.projectionId,
      Object.freeze(instanceIds.slice()) as ReadonlyArray<EdgeInstanceId>
    );
  }

  const snapshot: OutlineSnapshot = {
    nodes: nodeEntries as ReadonlyMap<NodeId, NodeSnapshot>,
    edges: edgeEntries as ReadonlyMap<EdgeId, EdgeSnapshot>,
    rootEdgeIds: Object.freeze(outline.rootEdges.toArray()) as ReadonlyArray<EdgeId>,
    childrenByParent: childrenByParent as ReadonlyMap<NodeId, ReadonlyArray<EdgeId>>,
    childEdgeIdsByParentEdge: childEdgeIdsByParentEdge as ReadonlyMap<EdgeId, ReadonlyArray<EdgeInstanceId>>,
    canonicalEdgeIdsByEdgeId: canonicalEdgeIdsByEdgeId as ReadonlyMap<EdgeId, EdgeId>
  };

  return snapshot;
};
