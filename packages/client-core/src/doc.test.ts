import { describe, expect, it, vi } from "vitest";

import {
  OutlineError,
  addEdge,
  createNode,
  createOutlineDoc,
  createOutlineSnapshot,
  getChildEdgeIds,
  getNodeMetadata,
  getNodeText,
  getRootEdgeIds,
  setNodeText,
  updateNodeMetadata
} from "./index";

describe("outline document helpers", () => {
  it("creates an empty collaborative document", () => {
    const outline = createOutlineDoc();

    expect(getRootEdgeIds(outline)).toHaveLength(0);
    expect(outline.nodes.size).toBe(0);
    expect(outline.edges.size).toBe(0);
  });

  it("creates nodes with default metadata", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));

    const outline = createOutlineDoc();
    const nodeId = createNode(outline, { text: "hello" });

    expect(getNodeText(outline, nodeId)).toBe("hello");
    const metadata = getNodeMetadata(outline, nodeId);
    expect(metadata.createdAt).toBeGreaterThan(0);
    expect(metadata.updatedAt).toBe(metadata.createdAt);
    expect(metadata.tags).toEqual([]);

    vi.useRealTimers();
  });

  it("updates node text inside a transaction", () => {
    const outline = createOutlineDoc();
    const nodeId = createNode(outline, { text: "initial" });

    const before = getNodeMetadata(outline, nodeId).updatedAt;
    setNodeText(outline, nodeId, "updated");
    const after = getNodeMetadata(outline, nodeId).updatedAt;

    expect(getNodeText(outline, nodeId)).toBe("updated");
    expect(after).toBeGreaterThanOrEqual(before);
  });

  it("adds edges respecting root and child ordering", () => {
    const outline = createOutlineDoc();
    const rootNode = createNode(outline, { text: "root" });
    const childOne = addEdge(outline, { parentNodeId: null, childNodeId: rootNode });
    const childTwo = addEdge(outline, { parentNodeId: rootNode, text: "first child" });
    const childThree = addEdge(outline, {
      parentNodeId: rootNode,
      text: "prepending child",
      position: 0
    });

    expect(getRootEdgeIds(outline)).toEqual([childOne.edgeId]);
    expect(getChildEdgeIds(outline, rootNode)).toEqual([childThree.edgeId, childTwo.edgeId]);

    const snapshot = createOutlineSnapshot(outline);
    const firstEdge = snapshot.edges.get(childThree.edgeId);
    const secondEdge = snapshot.edges.get(childTwo.edgeId);

    expect(firstEdge?.position).toBe(0);
    expect(secondEdge?.position).toBe(1);
    expect(snapshot.childrenByParent.get(rootNode)).toEqual([
      childThree.edgeId,
      childTwo.edgeId
    ]);
  });

  it("blocks cycle creation when linking edges", () => {
    const outline = createOutlineDoc();
    const rootNode = createNode(outline, { text: "root" });
    addEdge(outline, { parentNodeId: null, childNodeId: rootNode });

    const child = addEdge(outline, { parentNodeId: rootNode, text: "child" });
    const grandChild = addEdge(outline, { parentNodeId: child.nodeId, text: "grandchild" });

    expect(() =>
      addEdge(outline, {
        parentNodeId: grandChild.nodeId,
        childNodeId: rootNode
      })
    ).toThrow(OutlineError);
  });

  it("merges metadata patches and clears nullable fields", () => {
    const outline = createOutlineDoc();
    const nodeId = createNode(outline, { metadata: { tags: ["initial"], color: "#abc" } });

    updateNodeMetadata(outline, nodeId, {
      tags: ["updated"],
      color: "#def"
    });

    let metadata = getNodeMetadata(outline, nodeId);
    expect(metadata.tags).toEqual(["updated"]);
    expect(metadata.color).toBe("#def");

    updateNodeMetadata(outline, nodeId, { color: undefined });
    metadata = getNodeMetadata(outline, nodeId);
    expect(metadata.color).toBeUndefined();
  });
});
