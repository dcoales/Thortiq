import { describe, expect, it } from "vitest";

import { executeOutlineSearch } from "./execute";
import { OutlineSearchIndex } from "./index";
import type { OutlineSnapshot, NodeSnapshot, EdgeSnapshot } from "../types";
import type { EdgeId, NodeId } from "../ids";

const createNodeSnapshot = (
  id: NodeId,
  text: string,
  tags: readonly string[] = []
): NodeSnapshot => ({
  id,
  text,
  inlineContent: [],
  metadata: {
    createdAt: Date.parse("2024-01-01T00:00:00Z"),
    updatedAt: Date.parse("2024-01-02T00:00:00Z"),
    tags: [...tags]
  }
});

const createEdgeSnapshot = (
  id: EdgeId,
  parentNodeId: NodeId | null,
  childNodeId: NodeId,
  position: number
): EdgeSnapshot => ({
  id,
  parentNodeId,
  childNodeId,
  collapsed: false,
  mirrorOfNodeId: null,
  position
});

const createSnapshot = (): OutlineSnapshot => {
  const rootNode = createNodeSnapshot("node-root" as NodeId, "Root Outline");
  const childNode = createNodeSnapshot("node-child" as NodeId, "Project Alpha", ["work"]);
  const grandchildNode = createNodeSnapshot("node-grandchild" as NodeId, "Nested Task");
  const siblingNode = createNodeSnapshot("node-sibling" as NodeId, "Reference");

  const rootEdge = createEdgeSnapshot("edge-root" as EdgeId, null, rootNode.id, 0);
  const childEdge = createEdgeSnapshot("edge-child" as EdgeId, rootNode.id, childNode.id, 0);
  const grandchildEdge = createEdgeSnapshot("edge-grandchild" as EdgeId, childNode.id, grandchildNode.id, 0);
  const siblingEdge = createEdgeSnapshot("edge-sibling" as EdgeId, rootNode.id, siblingNode.id, 1);

  return {
    nodes: new Map<NodeId, NodeSnapshot>([
      [rootNode.id, rootNode],
      [childNode.id, childNode],
      [grandchildNode.id, grandchildNode],
      [siblingNode.id, siblingNode]
    ]),
    edges: new Map<EdgeId, EdgeSnapshot>([
      [rootEdge.id, rootEdge],
      [childEdge.id, childEdge],
      [grandchildEdge.id, grandchildEdge],
      [siblingEdge.id, siblingEdge]
    ]),
    rootEdgeIds: [rootEdge.id],
    childrenByParent: new Map<NodeId, readonly EdgeId[]>([
      [rootNode.id, [childEdge.id, siblingEdge.id]],
      [childNode.id, [grandchildEdge.id]]
    ])
  };
};

describe("executeOutlineSearch", () => {
  it("matches nodes and surfaces partial ancestors", () => {
    const snapshot = createSnapshot();
    const index = OutlineSearchIndex.fromSnapshot(snapshot);

    const result = executeOutlineSearch("text:Alpha", index, snapshot);

    expect(result.errors).toHaveLength(0);
    expect(Array.from(result.matchedEdgeIds)).toEqual(["edge-child"]);
    expect(Array.from(result.visibleEdgeIds)).toEqual(["edge-child", "edge-root"]);
    expect(Array.from(result.partiallyVisibleEdgeIds)).toContain("edge-root");
  });

  it("updates index entries when node text changes", () => {
    const snapshot = createSnapshot();
    const index = OutlineSearchIndex.fromSnapshot(snapshot);

    const updatedNode = {
      ...snapshot.nodes.get("node-child" as NodeId)!,
      text: "Renamed Initiative",
      metadata: {
        ...snapshot.nodes.get("node-child" as NodeId)!.metadata,
        updatedAt: Date.parse("2024-02-01T00:00:00Z")
      }
    } satisfies NodeSnapshot;
    index.updateNode(updatedNode.id, updatedNode);
    const updatedNodes = new Map<NodeId, NodeSnapshot>(snapshot.nodes);
    updatedNodes.set(updatedNode.id, updatedNode);
    const updatedSnapshot: OutlineSnapshot = {
      ...snapshot,
      nodes: updatedNodes
    };

    const result = executeOutlineSearch("text:Renamed", index, updatedSnapshot);
    expect(Array.from(result.matchedEdgeIds)).toEqual(["edge-child"]);
  });

  it("supports tag queries", () => {
    const snapshot = createSnapshot();
    const index = OutlineSearchIndex.fromSnapshot(snapshot);

    const result = executeOutlineSearch("tag:WORK", index, snapshot);
    expect(Array.from(result.matchedEdgeIds)).toEqual(["edge-child"]);
  });

  it("limits matches to scoped descendants", () => {
    const snapshot = createSnapshot();
    const index = OutlineSearchIndex.fromSnapshot(snapshot);

    const outsideScope = executeOutlineSearch("text:Reference", index, snapshot, {
      scopeRootEdgeId: "edge-child" as EdgeId
    });
    expect(Array.from(outsideScope.matchedEdgeIds)).toHaveLength(0);

    const scopedResult = executeOutlineSearch("text:Nested", index, snapshot, {
      scopeRootEdgeId: "edge-child" as EdgeId
    });

    expect(Array.from(scopedResult.matchedEdgeIds)).toEqual(["edge-grandchild"]);
    expect(Array.from(scopedResult.visibleEdgeIds)).toEqual(["edge-grandchild", "edge-child"]);
    expect(Array.from(scopedResult.partiallyVisibleEdgeIds)).toEqual([]);
  });
});
