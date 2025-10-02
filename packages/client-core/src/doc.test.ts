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
  getParentEdgeId,
  moveEdge,
  reconcileOutlineStructure,
  setNodeText,
  toggleEdgeCollapsed,
  updateNodeMetadata,
  withTransaction
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

  it("moves edges between parents and updates collapsed state", () => {
    const outline = createOutlineDoc();
    const rootNode = createNode(outline, { text: "root" });
    addEdge(outline, { parentNodeId: null, childNodeId: rootNode });

    const nodeOne = createNode(outline, { text: "one" });
    const edgeOne = addEdge(outline, { parentNodeId: rootNode, childNodeId: nodeOne }).edgeId;
    const nodeTwo = createNode(outline, { text: "two" });
    const edgeTwo = addEdge(outline, { parentNodeId: rootNode, childNodeId: nodeTwo }).edgeId;

    moveEdge(outline, edgeTwo, nodeOne, 0);
    expect(getChildEdgeIds(outline, nodeOne)).toEqual([edgeTwo]);

    const parentEdgeId = getParentEdgeId(outline, nodeOne);
    expect(parentEdgeId).toBe(edgeOne);

    const collapsed = toggleEdgeCollapsed(outline, edgeOne);
    expect(collapsed).toBe(true);
    expect(toggleEdgeCollapsed(outline, edgeOne, false)).toBe(false);
  });

  it("removes stray edge placements and keeps the authoritative parent", () => {
    const outline = createOutlineDoc();
    const nodeRoot = createNode(outline, { text: "root" });
    const nodeA = createNode(outline, { text: "A" });
    const nodeB = createNode(outline, { text: "B" });
    const nodeC = createNode(outline, { text: "C" });

    const rootEdge = addEdge(outline, { parentNodeId: null, childNodeId: nodeRoot }).edgeId;
    addEdge(outline, { parentNodeId: nodeRoot, childNodeId: nodeA });
    const edgeB = addEdge(outline, { parentNodeId: nodeRoot, childNodeId: nodeB }).edgeId;
    const edgeC = addEdge(outline, { parentNodeId: nodeRoot, childNodeId: nodeC }).edgeId;

    moveEdge(outline, edgeB, nodeA, 0);
    moveEdge(outline, edgeC, nodeB, 0);

    withTransaction(outline, () => {
      outline.rootEdges.insert(1, [edgeC]);
    });

    const corrections = reconcileOutlineStructure(outline);

    expect(corrections).toBeGreaterThan(0);
    expect(outline.rootEdges.toArray()[0]).toBe(rootEdge);
    expect(outline.rootEdges.toArray()).not.toContain(edgeC);
    const childEdgesForB = getChildEdgeIds(outline, nodeB);
    expect(childEdgesForB).toEqual([edgeC]);
  });

  it("re-inserts missing edges into their expected parent arrays", () => {
    const outline = createOutlineDoc();
    const nodeRoot = createNode(outline, { text: "root" });
    const nodeA = createNode(outline, { text: "A" });
    const nodeB = createNode(outline, { text: "B" });

    addEdge(outline, { parentNodeId: null, childNodeId: nodeRoot });
    const edgeA = addEdge(outline, { parentNodeId: nodeRoot, childNodeId: nodeA }).edgeId;
    const edgeB = addEdge(outline, { parentNodeId: nodeRoot, childNodeId: nodeB }).edgeId;

    moveEdge(outline, edgeB, nodeA, 0);

    withTransaction(outline, () => {
      const childArray = outline.childEdgeMap.get(nodeA);
      if (childArray) {
        childArray.delete(0, childArray.length);
      }
    });

    const corrections = reconcileOutlineStructure(outline);

    expect(corrections).toBeGreaterThan(0);
    const childEdges = getChildEdgeIds(outline, nodeA);
    expect(childEdges).toEqual([edgeB]);
    expect(outline.rootEdges.toArray()).not.toContain(edgeB);
    expect(getChildEdgeIds(outline, nodeRoot)).toEqual([edgeA]);
  });
});
