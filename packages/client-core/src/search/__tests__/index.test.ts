import { describe, expect, it } from "vitest";
import type { YEvent } from "yjs";
import type { AbstractType } from "yjs/dist/src/internals";

import {
  addEdge,
  createOutlineDoc,
  setNodeText,
  updateNodeMetadata
} from "../../doc/index";
import type { OutlineDoc } from "../../types";
import type { EdgeId, NodeId } from "../../ids";
import { createSearchIndex, type SearchIndex } from "../index";
import type { SearchComparator, SearchExpression, SearchField } from "../types";

const createStringPredicate = (
  field: SearchField,
  comparator: SearchComparator,
  value: string
): SearchExpression => ({
  type: "predicate",
  field,
  comparator,
  value: {
    kind: "string",
    value: value.toLowerCase()
  }
});

const captureNodeEvents = (
  outline: OutlineDoc,
  mutation: () => void
): Promise<ReadonlyArray<YEvent<AbstractType<unknown>>>> => {
  return new Promise((resolve, reject) => {
    const collected: Array<YEvent<AbstractType<unknown>>> = [];
    const observer = (batch: ReadonlyArray<YEvent<AbstractType<unknown>>>) => {
      batch.forEach((event) => collected.push(event));
    };

    outline.nodes.observeDeep(observer);
    try {
      mutation();
    } catch (error) {
      outline.nodes.unobserveDeep(observer);
      reject(error);
      return;
    }
    outline.nodes.unobserveDeep(observer);
    resolve(collected);
  });
};

const applyOutlineMutation = async (
  outline: OutlineDoc,
  index: SearchIndex,
  mutation: () => void
): Promise<void> => {
  const events = await captureNodeEvents(outline, mutation);
  if (events.length === 0) {
    throw new Error("Expected mutation to emit Yjs events.");
  }
  events.forEach((event) => index.applyTransactionalUpdates(event));
};

interface OutlineFixture {
  readonly outline: OutlineDoc;
  readonly index: SearchIndex;
  readonly rootEdgeId: EdgeId;
  readonly rootNodeId: NodeId;
  readonly childEdgeId: EdgeId;
  readonly childNodeId: NodeId;
}

const createFixture = (): OutlineFixture => {
  const outline = createOutlineDoc();
  const root = addEdge(outline, { parentNodeId: null, text: "Root" });
  const child = addEdge(outline, {
    parentNodeId: root.nodeId,
    text: "Child",
    metadata: {
      tags: ["alpha"],
      todo: { done: false }
    }
  });

  const index = createSearchIndex(outline);
  index.rebuildFromSnapshot();

  return {
    outline,
    index,
    rootEdgeId: root.edgeId,
    rootNodeId: root.nodeId,
    childEdgeId: child.edgeId,
    childNodeId: child.nodeId
  };
};

describe("search index", () => {
  it("returns matches for text and path predicates after rebuild", () => {
    const { index, childEdgeId } = createFixture();

    const textQuery = createStringPredicate("text", ":", "child");
    const textMatches = index.runQuery(textQuery).matches;
    expect(textMatches).toContain(childEdgeId);

    const pathQuery = createStringPredicate("path", ":", "root/child");
    const pathMatches = index.runQuery(pathQuery).matches;
    expect(pathMatches).toContain(childEdgeId);
  });

  it("updates tag metadata incrementally", async () => {
    const { outline, index, childNodeId, childEdgeId } = createFixture();

    await applyOutlineMutation(outline, index, () => {
      updateNodeMetadata(outline, childNodeId, { tags: ["alpha", "beta"] });
    });

    const tagQuery = createStringPredicate("tag", ":", "beta");
    const matches = index.runQuery(tagQuery).matches;
    expect(matches).toContain(childEdgeId);
  });

  it("requires exact tag matches when using the tag comparator", async () => {
    const { outline, index, childNodeId, childEdgeId, rootNodeId } = createFixture();

    await applyOutlineMutation(outline, index, () => {
      updateNodeMetadata(outline, childNodeId, { tags: ["john"] });
    });

    let exactEdgeId: EdgeId | null = null;
    await applyOutlineMutation(outline, index, () => {
      const { edgeId } = addEdge(outline, {
        parentNodeId: rootNodeId,
        text: "Exact Tag",
        metadata: { tags: ["jo"] }
      });
      exactEdgeId = edgeId;
    });

    if (!exactEdgeId) {
      throw new Error("Expected exact tag edge to be created.");
    }

    const exactQuery = createStringPredicate("tag", ":", "jo");
    const exactMatches = index.runQuery(exactQuery).matches;
    expect(exactMatches).toContain(exactEdgeId);
    expect(exactMatches).not.toContain(childEdgeId);

    const johnQuery = createStringPredicate("tag", ":", "john");
    const johnMatches = index.runQuery(johnQuery).matches;
    expect(johnMatches).toContain(childEdgeId);
    expect(johnMatches).not.toContain(exactEdgeId);
  });

  it("recomputes descendant paths when ancestor text changes", async () => {
    const { outline, index, rootNodeId, childEdgeId } = createFixture();

    await applyOutlineMutation(outline, index, () => {
      setNodeText(outline, rootNodeId, "Projects");
    });

    const newPathQuery = createStringPredicate("path", ":", "projects/child");
    const newMatches = index.runQuery(newPathQuery).matches;
    expect(newMatches).toContain(childEdgeId);

    const oldPathQuery = createStringPredicate("path", ":", "root/child");
    const oldMatches = index.runQuery(oldPathQuery).matches;
    expect(oldMatches).toHaveLength(0);
  });

  it("sets node type metadata for todo items", () => {
    const { index, childEdgeId, rootEdgeId } = createFixture();

    const todoQuery = createStringPredicate("type", "=", "todo");
    const todoMatches = index.runQuery(todoQuery).matches;
    expect(todoMatches).toContain(childEdgeId);
    expect(todoMatches).not.toContain(rootEdgeId);

    const defaultTypeQuery = createStringPredicate("type", "=", "node");
    const defaultMatches = index.runQuery(defaultTypeQuery).matches;
    expect(defaultMatches).toContain(rootEdgeId);
  });
});
