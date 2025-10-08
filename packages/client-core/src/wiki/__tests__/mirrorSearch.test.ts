import { describe, expect, it } from "vitest";

import { addEdge, createNode, createOutlineDoc, removeEdge } from "../../doc";
import { createOutlineSnapshot } from "../../doc/snapshots";
import { searchMirrorCandidates } from "../mirrorSearch";

describe("searchMirrorCandidates", () => {
  it("filters out nodes whose only placement is a mirror", () => {
    const outline = createOutlineDoc();
    const holderId = createNode(outline, { text: "Holder" });
    const mirrorSourceId = createNode(outline, { text: "Mirror source" });
    const targetNodeId = createNode(outline, { text: "Target" });

    addEdge(outline, { parentNodeId: null, childNodeId: holderId });
    const original = addEdge(outline, { parentNodeId: holderId, childNodeId: mirrorSourceId });
    addEdge(outline, {
      parentNodeId: holderId,
      childNodeId: mirrorSourceId,
      mirrorOfNodeId: mirrorSourceId
    });
    const targetEdge = addEdge(outline, { parentNodeId: holderId, childNodeId: targetNodeId });

    removeEdge(outline, original.edgeId, { removeChildNodeIfOrphaned: false });

    const snapshot = createOutlineSnapshot(outline);
    const results = searchMirrorCandidates(snapshot, "", { targetEdgeId: targetEdge.edgeId });

    expect(results.map((candidate) => candidate.nodeId)).not.toContain(mirrorSourceId);
  });

  it("excludes ancestor nodes to prevent cycles but keeps descendants", () => {
    const outline = createOutlineDoc();
    const rootId = createNode(outline, { text: "Root" });
    const childId = createNode(outline, { text: "Child" });
    const grandchildId = createNode(outline, { text: "Grandchild" });
    const descendantId = createNode(outline, { text: "Descendant" });

    addEdge(outline, { parentNodeId: null, childNodeId: rootId });
    addEdge(outline, { parentNodeId: rootId, childNodeId: childId });
    const targetEdge = addEdge(outline, { parentNodeId: childId, childNodeId: grandchildId });
    addEdge(outline, { parentNodeId: grandchildId, childNodeId: descendantId });

    const snapshot = createOutlineSnapshot(outline);
    const results = searchMirrorCandidates(snapshot, "", { targetEdgeId: targetEdge.edgeId });
    const nodeIds = results.map((candidate) => candidate.nodeId);

    expect(nodeIds).not.toContain(childId);
    expect(nodeIds).not.toContain(rootId);
    expect(nodeIds).toContain(descendantId);
    expect(nodeIds).toContain(grandchildId);
  });
});
