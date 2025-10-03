/**
 * Snapshot builders convert live Yjs data structures into plain immutable objects so consumers
 * can render or diff outline state without depending on Yjs APIs.
 */
import type { EdgeId, NodeId } from "../ids";
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

  const snapshot: OutlineSnapshot = {
    nodes: nodeEntries as ReadonlyMap<NodeId, NodeSnapshot>,
    edges: edgeEntries as ReadonlyMap<EdgeId, EdgeSnapshot>,
    rootEdgeIds: Object.freeze(outline.rootEdges.toArray()) as ReadonlyArray<EdgeId>,
    childrenByParent: childrenByParent as ReadonlyMap<NodeId, ReadonlyArray<EdgeId>>
  };

  return snapshot;
};
