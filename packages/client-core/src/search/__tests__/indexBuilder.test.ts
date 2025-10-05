/**
 * Unit tests for the search index builder.
 */
import { describe, it, expect } from "vitest";
import { createSearchIndex, updateSearchIndex } from "../indexBuilder";
import type { OutlineSnapshot, NodeSnapshot, EdgeSnapshot } from "../../types";
import type { NodeId, EdgeId } from "../../ids";
import type { IndexUpdateEvent } from "../types";

const createMockNode = (id: NodeId, text: string, tags: string[] = []): NodeSnapshot => ({
  id,
  text,
  inlineContent: [],
  metadata: {
    createdAt: Date.now(),
    updatedAt: Date.now(),
    tags
  }
});

const createMockEdge = (id: EdgeId, parentNodeId: NodeId | null, childNodeId: NodeId): EdgeSnapshot => ({
  id,
  parentNodeId,
  childNodeId,
  collapsed: false,
  mirrorOfNodeId: null,
  position: 0
});

const createMockSnapshot = (): OutlineSnapshot => {
  const nodes = new Map<NodeId, NodeSnapshot>();
  const edges = new Map<EdgeId, EdgeSnapshot>();
  const childrenByParent = new Map<NodeId, EdgeId[]>();

  // Create root node
  const rootNode = createMockNode("node1", "Root Node", ["root"]);
  nodes.set("node1", rootNode);

  // Create child nodes
  const child1 = createMockNode("node2", "Child One", ["child"]);
  const child2 = createMockNode("node3", "Child Two", ["child", "important"]);
  nodes.set("node2", child1);
  nodes.set("node3", child2);

  // Create edges
  const rootEdge = createMockEdge("edge1", null, "node1");
  const childEdge1 = createMockEdge("edge2", "node1", "node2");
  const childEdge2 = createMockEdge("edge3", "node1", "node3");
  
  edges.set("edge1", rootEdge);
  edges.set("edge2", childEdge1);
  edges.set("edge3", childEdge2);

  // Set up parent-child relationships
  childrenByParent.set("node1", ["edge2", "edge3"]);

  return {
    nodes,
    edges,
    rootEdgeIds: ["edge1"],
    childrenByParent
  };
};

describe("createSearchIndex", () => {
  it("should create a complete search index", () => {
    const snapshot = createMockSnapshot();
    const index = createSearchIndex(snapshot);

    expect(index.textIndex).toBeDefined();
    expect(index.pathIndex).toBeDefined();
    expect(index.tagIndex).toBeDefined();
    expect(index.typeIndex).toBeDefined();
    expect(index.createdIndex).toBeDefined();
    expect(index.updatedIndex).toBeDefined();
    expect(index.version).toBeGreaterThan(0);
  });

  it("should index text content", () => {
    const snapshot = createMockSnapshot();
    const index = createSearchIndex(snapshot);

    // Check that text tokens are indexed
    expect(index.textIndex.has("root")).toBe(true);
    expect(index.textIndex.has("child")).toBe(true);
    expect(index.textIndex.has("one")).toBe(true);
    expect(index.textIndex.has("two")).toBe(true);
    
    // Check that nodes are associated with tokens
    const rootNodes = index.textIndex.get("root");
    expect(rootNodes).toBeDefined();
    expect(rootNodes?.has("node1")).toBe(true);
  });

  it("should index tags", () => {
    const snapshot = createMockSnapshot();
    const index = createSearchIndex(snapshot);

    expect(index.tagIndex.has("root")).toBe(true);
    expect(index.tagIndex.has("child")).toBe(true);
    expect(index.tagIndex.has("important")).toBe(true);

    const importantNodes = index.tagIndex.get("important");
    expect(importantNodes).toBeDefined();
    expect(importantNodes?.has("node3")).toBe(true);
  });

  it("should index node types", () => {
    const snapshot = createMockSnapshot();
    const index = createSearchIndex(snapshot);

    expect(index.typeIndex.has("text")).toBe(true);
    expect(index.typeIndex.has("tagged")).toBe(true);

    const taggedNodes = index.typeIndex.get("tagged");
    expect(taggedNodes).toBeDefined();
    expect(taggedNodes?.has("node2")).toBe(true);
    expect(taggedNodes?.has("node3")).toBe(true);
  });

  it("should index timestamps", () => {
    const snapshot = createMockSnapshot();
    const index = createSearchIndex(snapshot);

    expect(index.createdIndex.size).toBeGreaterThan(0);
    expect(index.updatedIndex.size).toBeGreaterThan(0);
  });
});

describe("updateSearchIndex", () => {
  it("should perform incremental updates", () => {
    const snapshot = createMockSnapshot();
    const index = createSearchIndex(snapshot);

    const changes: IndexUpdateEvent = {
      changedNodeIds: new Set(["node2"]),
      deletedNodeIds: new Set(),
      changedEdgeIds: new Set(),
      structuralChange: false
    };

    const updatedIndex = updateSearchIndex(index, changes, snapshot);
    expect(updatedIndex.version).toBeGreaterThan(index.version);
  });

  it("should handle structural changes", () => {
    const snapshot = createMockSnapshot();
    const index = createSearchIndex(snapshot);

    const changes: IndexUpdateEvent = {
      changedNodeIds: new Set(),
      deletedNodeIds: new Set(),
      changedEdgeIds: new Set(),
      structuralChange: true
    };

    const updatedIndex = updateSearchIndex(index, changes, snapshot);
    expect(updatedIndex.version).toBeGreaterThan(index.version);
  });

  it("should remove deleted nodes", () => {
    const snapshot = createMockSnapshot();
    const index = createSearchIndex(snapshot);

    const changes: IndexUpdateEvent = {
      changedNodeIds: new Set(),
      deletedNodeIds: new Set(["node2"]),
      changedEdgeIds: new Set(),
      structuralChange: false
    };

    const updatedIndex = updateSearchIndex(index, changes, snapshot);
    
    // Check that node2 is no longer in any index
    for (const [, nodeIds] of updatedIndex.textIndex) {
      expect(nodeIds.has("node2")).toBe(false);
    }
  });
});
