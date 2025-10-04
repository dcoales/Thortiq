import { describe, expect, it } from "vitest";

import { addEdge, createNode, createOutlineDoc } from "../../doc";
import { createOutlineSnapshot } from "../../doc/snapshots";
import { searchWikiLinkCandidates } from "../search";

describe("searchWikiLinkCandidates", () => {
  it("returns all nodes sorted by text length when query is empty", () => {
    const outline = createOutlineDoc();
    const rootId = createNode(outline, { text: "Root" });
    const childId = createNode(outline, { text: "Child" });
    addEdge(outline, { parentNodeId: null, childNodeId: rootId });
    addEdge(outline, { parentNodeId: rootId, childNodeId: childId });

    const snapshot = createOutlineSnapshot(outline);

    const results = searchWikiLinkCandidates(snapshot, "");
    expect(results.map((candidate) => candidate.nodeId)).toEqual([rootId, childId]);
    expect(results[1]?.breadcrumb.map((segment) => segment.text)).toEqual(["Root", "Child"]);
  });

  it("filters nodes by token matches irrespective of order", () => {
    const outline = createOutlineDoc();
    const rootId = createNode(outline, { text: "Project Alpha" });
    const childId = createNode(outline, { text: "Alpha deliverable" });
    const otherId = createNode(outline, { text: "Beta tasks" });
    addEdge(outline, { parentNodeId: null, childNodeId: rootId });
    addEdge(outline, { parentNodeId: rootId, childNodeId: childId });
    addEdge(outline, { parentNodeId: null, childNodeId: otherId });

    const snapshot = createOutlineSnapshot(outline);

    const results = searchWikiLinkCandidates(snapshot, "alpha deliverable");
    expect(results).toHaveLength(1);
    expect(results[0]?.nodeId).toBe(childId);
  });

  it("respects exclusion options", () => {
    const outline = createOutlineDoc();
    const rootId = createNode(outline, { text: "Root" });
    const siblingId = createNode(outline, { text: "Sibling" });
    addEdge(outline, { parentNodeId: null, childNodeId: rootId });
    addEdge(outline, { parentNodeId: null, childNodeId: siblingId });

    const snapshot = createOutlineSnapshot(outline);

    const results = searchWikiLinkCandidates(snapshot, "", { excludeNodeId: rootId });
    expect(results.map((candidate) => candidate.nodeId)).toEqual([siblingId]);
  });
});
