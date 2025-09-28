import type { EdgeId, NodeId, OutlineSnapshot } from "@thortiq/sync-core";

export interface OutlineRow {
  readonly edgeId: EdgeId;
  readonly nodeId: NodeId;
  readonly depth: number;
  readonly text: string;
  readonly collapsed: boolean;
  readonly parentNodeId: NodeId | null;
  readonly hasChildren: boolean;
}

export const flattenSnapshot = (snapshot: OutlineSnapshot): OutlineRow[] => {
  const rows: OutlineRow[] = [];

  const visitEdge = (edgeId: EdgeId, depth: number, parentNodeId: NodeId | null): void => {
    const edge = snapshot.edges.get(edgeId);
    if (!edge) {
      return;
    }

    const node = snapshot.nodes.get(edge.childNodeId);
    if (!node) {
      return;
    }

    const children = snapshot.childrenByParent.get(node.id) ?? [];

    rows.push({
      edgeId,
      nodeId: node.id,
      depth,
      text: node.text,
      collapsed: edge.collapsed,
      parentNodeId,
      hasChildren: children.length > 0
    });

    if (edge.collapsed) {
      return;
    }

    children.forEach((childEdgeId: EdgeId) => visitEdge(childEdgeId, depth + 1, node.id));
  };

  snapshot.rootEdgeIds.forEach((edgeId: EdgeId) => visitEdge(edgeId, 0, null));

  return rows;
};
