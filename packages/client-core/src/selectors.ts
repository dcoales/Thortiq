/**
 * Pure selectors that convert the collaborative outline snapshot into immutable tree
 * structures suitable for rendering. These helpers never leak live Yjs references and can
 * therefore be safely memoised inside UI layers.
 */
import type { EdgeId, NodeId } from "./ids";
import { OutlineError } from "./doc";
import type { OutlineSnapshot, OutlineTreeNode } from "./types";

export const getSnapshotChildEdgeIds = (
  snapshot: OutlineSnapshot,
  parentNodeId: NodeId
): ReadonlyArray<EdgeId> => {
  return snapshot.childrenByParent.get(parentNodeId) ?? [];
};

export const buildOutlineForest = (snapshot: OutlineSnapshot): ReadonlyArray<OutlineTreeNode> => {
  const buildTree = (edgeId: EdgeId, visited: Set<EdgeId>): OutlineTreeNode => {
    if (visited.has(edgeId)) {
      throw new OutlineError(`Snapshot already visited edge ${edgeId}; cycle suspected`);
    }

    const edge = snapshot.edges.get(edgeId);
    if (!edge) {
      throw new OutlineError(`Edge ${edgeId} missing from snapshot`);
    }

    const node = snapshot.nodes.get(edge.childNodeId);
    if (!node) {
      throw new OutlineError(`Node ${edge.childNodeId} missing from snapshot`);
    }

    visited.add(edgeId);
    const childEdgeIds = getSnapshotChildEdgeIds(snapshot, edge.childNodeId);
    const children = childEdgeIds.map((childId) => buildTree(childId, visited));
    visited.delete(edgeId);

    return {
      edge,
      node,
      children
    };
  };

  return snapshot.rootEdgeIds.map((edgeId) => buildTree(edgeId, new Set<EdgeId>()));
};
