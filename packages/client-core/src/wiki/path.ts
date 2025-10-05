/**
 * Resolve the sequence of edge ids from the outline root to the target node.
 * This stays snapshot-only so UI layers can reuse consistent focus behaviour
 * without reaching into live Yjs structures.
 */
import type { EdgeId, NodeId } from "../ids";
import type { OutlineSnapshot } from "../types";

interface EdgePathEntry {
  readonly edgeId: EdgeId;
  readonly path: EdgeId[];
}

export const findEdgePathForNode = (
  snapshot: OutlineSnapshot,
  targetNodeId: NodeId
): EdgeId[] | null => {
  if (snapshot.rootEdgeIds.length === 0) {
    return null;
  }
  const visited = new Set<EdgeId>();
  const queue: EdgePathEntry[] = snapshot.rootEdgeIds.map((edgeId) => ({ edgeId, path: [edgeId] }));

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      break;
    }
    if (visited.has(current.edgeId)) {
      continue;
    }
    visited.add(current.edgeId);

    const edge = snapshot.edges.get(current.edgeId);
    if (!edge) {
      continue;
    }
    if (edge.childNodeId === targetNodeId) {
      return current.path;
    }

    const childEdges = snapshot.childrenByParent.get(edge.childNodeId) ?? [];
    for (const childEdgeId of childEdges) {
      if (visited.has(childEdgeId)) {
        continue;
      }
      queue.push({ edgeId: childEdgeId, path: [...current.path, childEdgeId] });
    }
  }

  return null;
};
