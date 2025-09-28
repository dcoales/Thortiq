import type { EdgeId, NodeId, OutlineSnapshot } from "@thortiq/sync-core";

export interface OutlineRow {
  readonly edgeId: EdgeId;
  readonly nodeId: NodeId;
  readonly depth: number;
  readonly text: string;
  readonly collapsed: boolean;
}

export const flattenSnapshot = (snapshot: OutlineSnapshot): OutlineRow[] => {
  const rows: OutlineRow[] = [];

  const visitEdge = (edgeId: EdgeId, depth: number): void => {
    const edge = snapshot.edges.get(edgeId);
    if (!edge) {
      return;
    }

    const node = snapshot.nodes.get(edge.childNodeId);
    if (!node) {
      return;
    }

    rows.push({
      edgeId,
      nodeId: node.id,
      depth,
      text: node.text,
      collapsed: edge.collapsed
    });

    if (edge.collapsed) {
      return;
    }

    const children = snapshot.childrenByParent.get(node.id) ?? [];
    children.forEach((childEdgeId: EdgeId) => visitEdge(childEdgeId, depth + 1));
  };

  snapshot.rootEdgeIds.forEach((edgeId: EdgeId) => visitEdge(edgeId, 0));

  return rows;
};
