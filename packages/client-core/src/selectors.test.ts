import { describe, expect, it } from "vitest";

import {
  addEdge,
  buildOutlineForest,
  createNode,
  createOutlineDoc,
  createOutlineSnapshot
} from "./index";

describe("outline selectors", () => {
  it("builds a nested tree from the snapshot", () => {
    const outline = createOutlineDoc();
    const rootNode = createNode(outline, { text: "root" });
    const child = addEdge(outline, { parentNodeId: null, childNodeId: rootNode });
    const childNode = addEdge(outline, { parentNodeId: rootNode, text: "child" });
    addEdge(outline, { parentNodeId: childNode.nodeId, text: "grandchild" });

    const snapshot = createOutlineSnapshot(outline);
    const forest = buildOutlineForest(snapshot);

    expect(forest).toHaveLength(1);
    const [tree] = forest;
    expect(tree.edge.id).toBe(child.edgeId);
    expect(tree.node.text).toBe("root");
    expect(tree.children[0].node.text).toBe("child");
    expect(tree.children[0].children[0].node.text).toBe("grandchild");
  });
});
