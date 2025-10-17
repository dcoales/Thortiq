import { describe, expect, it } from "vitest";

import {
  addEdge,
  createNode,
  createOutlineDoc,
  createOutlineSnapshot
} from "../../doc";
import type { NodeId } from "../../ids";
import { searchMoveTargets } from "../searchMoveTargets";

const buildSampleSnapshot = () => {
  const outline = createOutlineDoc();
  const origin = Symbol("test");
  const rootA = createNode(outline, { text: "Alpha project", origin });
  const rootB = createNode(outline, { text: "Gamma initiatives", origin });
  addEdge(outline, { parentNodeId: null, childNodeId: rootA, origin });
  addEdge(outline, { parentNodeId: null, childNodeId: rootB, origin });

  const childA = createNode(outline, { text: "Beta tasks", origin });
  addEdge(outline, { parentNodeId: rootA, childNodeId: childA, origin });

  return {
    outline,
    snapshot: createOutlineSnapshot(outline),
    nodes: { rootA, rootB, childA }
  };
};

describe("searchMoveTargets", () => {
  it("includes the root candidate when no query is provided", () => {
    const { snapshot } = buildSampleSnapshot();
    const results = searchMoveTargets(snapshot, "", { limit: 5 });
    expect(results.length).toBeGreaterThan(0);
    const [first] = results;
    expect(first.isRoot).toBe(true);
    expect(first.parentNodeId).toBeNull();
  });

  it("filters candidates using multi-term queries", () => {
    const { snapshot, nodes } = buildSampleSnapshot();
    const results = searchMoveTargets(snapshot, "alpha project");
    const labels = results.map((candidate) => candidate.text);
    expect(labels).toContain("Alpha project");
    expect(labels).not.toContain("Beta tasks");
    expect(labels).not.toContain("Gamma initiatives");
    const alphaEntry = results.find((candidate) => candidate.text === "Alpha project");
    expect(alphaEntry?.parentNodeId).toBe(nodes.rootA);
  });

  it("excludes forbidden node ids", () => {
    const { snapshot, nodes } = buildSampleSnapshot();
    const forbidden = new Set<NodeId>([nodes.rootA]);
    const results = searchMoveTargets(snapshot, "alpha", { forbiddenNodeIds: forbidden });
    expect(results.some((candidate) => candidate.parentNodeId === nodes.rootA)).toBe(false);
  });

  it("omits the root candidate when the query tokens do not match it", () => {
    const { snapshot } = buildSampleSnapshot();
    const results = searchMoveTargets(snapshot, "alpha");
    expect(results.some((candidate) => candidate.isRoot)).toBe(false);
  });

  it("respects the supplied result limit even when many candidates match", () => {
    const outline = createOutlineDoc();
    const origin = Symbol("test");
    for (let index = 0; index < 10; index += 1) {
      const node = createNode(outline, { text: `Project ${index}`, origin });
      addEdge(outline, { parentNodeId: null, childNodeId: node, origin });
    }
    const snapshot = createOutlineSnapshot(outline);
    const limit = 5;
    const results = searchMoveTargets(snapshot, "project", { limit });
    expect(results.length).toBe(limit);
  });
});
