/**
 * Unit tests for the search query executor.
 */
import { describe, it, expect } from "vitest";
import { executeSearchQuery } from "../queryExecutor";
import type { SearchIndex, SearchQuery } from "../types";
import type { OutlineSnapshot, NodeSnapshot } from "../../types";
import type { NodeId } from "../../ids";

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

const createMockSnapshot = (): OutlineSnapshot => {
  const nodes = new Map<NodeId, NodeSnapshot>();
  const edges = new Map();
  const childrenByParent = new Map();

  const node1 = createMockNode("node1", "Hello World", ["greeting"]);
  const node2 = createMockNode("node2", "Important Task", ["important", "task"]);
  const node3 = createMockNode("node3", "Another Hello", ["greeting"]);

  nodes.set("node1", node1);
  nodes.set("node2", node2);
  nodes.set("node3", node3);

  return {
    nodes,
    edges,
    rootEdgeIds: [],
    childrenByParent
  };
};

const createMockIndex = (): SearchIndex => {
  const textIndex = new Map<string, Set<NodeId>>();
  const pathIndex = new Map<string, Set<NodeId>>();
  const tagIndex = new Map<string, Set<NodeId>>();
  const typeIndex = new Map<string, Set<NodeId>>();
  const createdIndex = new Map<number, Set<NodeId>>();
  const updatedIndex = new Map<number, Set<NodeId>>();

  // Index text tokens
  textIndex.set("hello", new Set(["node1", "node3"]));
  textIndex.set("world", new Set(["node1"]));
  textIndex.set("important", new Set(["node2"]));
  textIndex.set("task", new Set(["node2"]));
  textIndex.set("another", new Set(["node3"]));

  // Index tags
  tagIndex.set("greeting", new Set(["node1", "node3"]));
  tagIndex.set("important", new Set(["node2"]));
  tagIndex.set("task", new Set(["node2"]));

  // Index types
  typeIndex.set("text", new Set(["node1", "node2", "node3"]));
  typeIndex.set("tagged", new Set(["node1", "node2", "node3"]));

  return {
    textIndex,
    pathIndex,
    tagIndex,
    typeIndex,
    createdIndex,
    updatedIndex,
    version: 1
  };
};

describe("executeSearchQuery", () => {
  it("should execute simple text queries", () => {
    const index = createMockIndex();
    const snapshot = createMockSnapshot();
    const query: SearchQuery = {
      type: "field",
      field: "text",
      operator: ":",
      value: "hello"
    };

    const results = executeSearchQuery(index, query, snapshot);
    expect(results).toContain("node1");
    expect(results).toContain("node3");
    expect(results).not.toContain("node2");
  });

  it("should execute tag queries", () => {
    const index = createMockIndex();
    const snapshot = createMockSnapshot();
    const query: SearchQuery = {
      type: "field",
      field: "tag",
      operator: ":",
      value: "important"
    };

    const results = executeSearchQuery(index, query, snapshot);
    expect(results).toContain("node2");
    expect(results).not.toContain("node1");
    expect(results).not.toContain("node3");
  });

  it("should execute AND queries", () => {
    const index = createMockIndex();
    const snapshot = createMockSnapshot();
    const query: SearchQuery = {
      type: "boolean",
      operator: "AND",
      left: {
        type: "field",
        field: "text",
        operator: ":",
        value: "hello"
      },
      right: {
        type: "field",
        field: "tag",
        operator: ":",
        value: "greeting"
      }
    };

    const results = executeSearchQuery(index, query, snapshot);
    expect(results).toContain("node1");
    expect(results).toContain("node3");
    expect(results).not.toContain("node2");
  });

  it("should execute OR queries", () => {
    const index = createMockIndex();
    const snapshot = createMockSnapshot();
    const query: SearchQuery = {
      type: "boolean",
      operator: "OR",
      left: {
        type: "field",
        field: "text",
        operator: ":",
        value: "world"
      },
      right: {
        type: "field",
        field: "text",
        operator: ":",
        value: "task"
      }
    };

    const results = executeSearchQuery(index, query, snapshot);
    expect(results).toContain("node1"); // has "world"
    expect(results).toContain("node2"); // has "task"
    expect(results).not.toContain("node3");
  });

  it("should execute NOT queries", () => {
    const index = createMockIndex();
    const snapshot = createMockSnapshot();
    const query: SearchQuery = {
      type: "boolean",
      operator: "NOT",
      left: {
        type: "field",
        field: "text",
        operator: ":",
        value: "hello"
      }
    };

    const results = executeSearchQuery(index, query, snapshot);
    expect(results).not.toContain("node1");
    expect(results).not.toContain("node3");
    expect(results).toContain("node2");
  });

  it("should execute grouped queries", () => {
    const index = createMockIndex();
    const snapshot = createMockSnapshot();
    const query: SearchQuery = {
      type: "group",
      query: {
        type: "field",
        field: "text",
        operator: ":",
        value: "hello"
      }
    };

    const results = executeSearchQuery(index, query, snapshot);
    expect(results).toContain("node1");
    expect(results).toContain("node3");
    expect(results).not.toContain("node2");
  });

  it("should respect limit option", () => {
    const index = createMockIndex();
    const snapshot = createMockSnapshot();
    const query: SearchQuery = {
      type: "field",
      field: "text",
      operator: ":",
      value: "hello"
    };

    const results = executeSearchQuery(index, query, snapshot, { limit: 1 });
    expect(results.length).toBeLessThanOrEqual(1);
  });

  it("should include ancestors when requested", () => {
    const index = createMockIndex();
    const snapshot = createMockSnapshot();
    const query: SearchQuery = {
      type: "field",
      field: "text",
      operator: ":",
      value: "hello"
    };

    const results = executeSearchQuery(index, query, snapshot, { includeAncestors: true });
    expect(results.length).toBeGreaterThanOrEqual(2); // Should include ancestors
  });

  it("should handle exact match queries", () => {
    const index = createMockIndex();
    const snapshot = createMockSnapshot();
    const query: SearchQuery = {
      type: "field",
      field: "text",
      operator: "=",
      value: "hello"
    };

    const results = executeSearchQuery(index, query, snapshot);
    // Should only match exact "hello" tokens, not "hello world"
    expect(results.length).toBe(0); // No exact matches in our test data
  });

  it("should handle not equal queries", () => {
    const index = createMockIndex();
    const snapshot = createMockSnapshot();
    const query: SearchQuery = {
      type: "field",
      field: "text",
      operator: "!=",
      value: "hello"
    };

    const results = executeSearchQuery(index, query, snapshot);
    expect(results).not.toContain("node1");
    expect(results).not.toContain("node3");
    expect(results).toContain("node2");
  });
});
