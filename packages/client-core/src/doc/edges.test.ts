import { describe, expect, it } from "vitest";

import { createOutlineDoc, withTransaction } from "./transactions";
import { createNode, nodeExists } from "./nodes";
import {
  OutlineError,
  addEdge,
  getChildEdgeIds,
  getEdgeSnapshot,
  getParentEdgeId,
  getRootEdgeIds,
  moveEdge,
  reconcileOutlineStructure,
  removeEdge,
  toggleEdgeCollapsed
} from "./index";

describe("edges module", () => {
  it("adds edges and maintains ordering", () => {
    const outline = createOutlineDoc();
    const rootNode = createNode(outline, { text: "root" });
    const childOne = addEdge(outline, { parentNodeId: null, childNodeId: rootNode });
    const childTwo = addEdge(outline, { parentNodeId: rootNode, text: "first child" });
    const childThree = addEdge(outline, { parentNodeId: rootNode, text: "prepending", position: 0 });

    expect(getRootEdgeIds(outline)).toEqual([childOne.edgeId]);
    expect(getChildEdgeIds(outline, rootNode)).toEqual([childThree.edgeId, childTwo.edgeId]);

    const snapshot = getEdgeSnapshot(outline, childThree.edgeId);
    expect(snapshot.position).toBe(0);
  });

  it("prevents cycles when linking nodes", () => {
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

  it("moves edges between parents and toggles collapse state", () => {
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

  it("reconciles stray placements back to expected parents", () => {
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
    expect(getChildEdgeIds(outline, nodeRoot)).toEqual([edgeA]);
  });

  it("removes orphan edges and prunes child nodes", () => {
    const outline = createOutlineDoc();
    const rootNode = createNode(outline, { text: "root" });
    const { edgeId: rootEdgeId } = addEdge(outline, { parentNodeId: null, childNodeId: rootNode });

    const childNode = createNode(outline, { text: "child" });
    const { edgeId: childEdgeId } = addEdge(outline, { parentNodeId: rootNode, childNodeId: childNode });

    removeEdge(outline, childEdgeId);

    expect(getChildEdgeIds(outline, rootNode)).toEqual([]);
    expect(outline.edges.has(childEdgeId)).toBe(false);
    expect(nodeExists(outline, childNode)).toBe(false);
    expect(getRootEdgeIds(outline)).toEqual([rootEdgeId]);
  });
});
