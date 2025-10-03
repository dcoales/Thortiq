import { describe, expect, it } from "vitest";

import { createOutlineDoc } from "./transactions";
import { createNode } from "./nodes";
import { addEdge } from "./index";
import { createOutlineSnapshot } from "./snapshots";

describe("snapshots module", () => {
  it("produces a plain-data snapshot of nodes, edges, and children", () => {
    const outline = createOutlineDoc();
    const rootNode = createNode(outline, { text: "root" });
    const { edgeId } = addEdge(outline, { parentNodeId: null, childNodeId: rootNode });
    const childNode = createNode(outline, { text: "child" });
    const { edgeId: childEdgeId } = addEdge(outline, { parentNodeId: rootNode, childNodeId: childNode });

    const snapshot = createOutlineSnapshot(outline);

    expect(snapshot.nodes.get(rootNode)?.text).toBe("root");
    expect(snapshot.edges.get(edgeId)?.childNodeId).toBe(rootNode);
    expect(snapshot.childrenByParent.get(rootNode)).toEqual([childEdgeId]);
    expect(Array.isArray(snapshot.rootEdgeIds)).toBe(true);
  });
});
