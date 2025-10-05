import { describe, expect, it } from "vitest";

import { addEdge, createNode, createOutlineDoc } from "../../doc";
import { createOutlineSnapshot } from "../../doc/snapshots";
import type { EdgeId, NodeId } from "../../ids";
import { findEdgePathForNode } from "../path";

describe("findEdgePathForNode", () => {
  const setupOutline = () => {
    const outline = createOutlineDoc();
    const rootNode = createNode(outline, { text: "Root" });
    const childNode = createNode(outline, { text: "Child" });
    const leafNode = createNode(outline, { text: "Leaf" });
    const mirrorParent = createNode(outline, { text: "Mirror" });

    const rootEdge = addEdge(outline, { parentNodeId: null, childNodeId: rootNode });
    const childEdge = addEdge(outline, { parentNodeId: rootNode, childNodeId: childNode });
    const leafEdge = addEdge(outline, { parentNodeId: childNode, childNodeId: leafNode });
    const mirrorEdge = addEdge(outline, { parentNodeId: mirrorParent, childNodeId: childNode });

    return {
      outline,
      rootNode,
      childNode,
      leafNode,
      edges: {
        root: rootEdge.edgeId as EdgeId,
        child: childEdge.edgeId as EdgeId,
        leaf: leafEdge.edgeId as EdgeId,
        mirror: mirrorEdge.edgeId as EdgeId
      }
    };
  };

  it("returns null when the node is not present", () => {
    const { outline } = setupOutline();
    const snapshot = createOutlineSnapshot(outline);
    const missingNodeId = "not-found" as NodeId;

    expect(findEdgePathForNode(snapshot, missingNodeId)).toBeNull();
  });

  it("returns the root edge when the node is at the top level", () => {
    const { outline, rootNode, edges } = setupOutline();
    const snapshot = createOutlineSnapshot(outline);

    expect(findEdgePathForNode(snapshot, rootNode)).toEqual([edges.root]);
  });

  it("returns the path for a deeply nested node", () => {
    const { outline, leafNode, edges } = setupOutline();
    const snapshot = createOutlineSnapshot(outline);

    expect(findEdgePathForNode(snapshot, leafNode)).toEqual([edges.root, edges.child, edges.leaf]);
  });

  it("returns the first discovered path when multiple edges reference the same node", () => {
    const { outline, childNode, edges } = setupOutline();
    const snapshot = createOutlineSnapshot(outline);

    const path = findEdgePathForNode(snapshot, childNode);
    expect(path).toEqual([edges.root, edges.child]);
    expect(path?.includes(edges.mirror)).toBe(false);
  });
});
