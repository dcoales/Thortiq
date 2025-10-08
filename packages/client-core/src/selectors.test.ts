import { describe, expect, it } from "vitest";

import {
  addEdge,
  buildOutlineForest,
  buildPaneRows,
  createMirrorEdge,
  createNode,
  createOutlineDoc,
  createOutlineSnapshot
} from "./index";

describe("outline selectors", () => {
  it("builds a nested tree from the snapshot", () => {
    const outline = createOutlineDoc();
    const rootNode = createNode(outline, { text: "root" });
    const child = addEdge(outline, { parentNodeId: null, childNodeId: rootNode });
    const childNode = addEdge(outline, { parentNodeId: rootNode, text: "child" });
    addEdge(outline, { parentNodeId: childNode.nodeId, text: "grandchild" });

    const snapshot = createOutlineSnapshot(outline);
    const forest = buildOutlineForest(snapshot);

    expect(forest).toHaveLength(1);
    const [tree] = forest;
    expect(tree.edge.id).toBe(child.edgeId);
    expect(tree.node.text).toBe("root");
    expect(tree.children[0].node.text).toBe("child");
    expect(tree.children[0].children[0].node.text).toBe("grandchild");
  });

  it("projects unique row edge ids for mirror children while sharing canonical edges", () => {
    const outline = createOutlineDoc();
    const root = addEdge(outline, { parentNodeId: null, text: "Original root" });
    const mirrorSource = addEdge(outline, { parentNodeId: root.nodeId, text: "Mirror source" });
    const nested = addEdge(outline, { parentNodeId: mirrorSource.nodeId, text: "Nested child" });

    const mirror = createMirrorEdge({
      outline,
      mirrorNodeId: mirrorSource.nodeId,
      insertParentNodeId: null,
      insertIndex: 1
    });

    expect(mirror).not.toBeNull();

    const snapshot = createOutlineSnapshot(outline);
    const paneRows = buildPaneRows(snapshot, {
      rootEdgeId: null,
      collapsedEdgeIds: [],
      search: undefined,
      focusPathEdgeIds: undefined
    });

    const nestedRows = paneRows.rows.filter((row) => row.edge.canonicalEdgeId === nested.edgeId);
    expect(nestedRows).toHaveLength(2);
    const [originalRow, mirrorRow] = nestedRows;
    expect(originalRow.edge.id).not.toBe(mirrorRow.edge.id);
    const originalAncestorPath = originalRow.ancestorEdgeIds;
    const mirrorAncestorPath = mirrorRow.ancestorEdgeIds;
    expect(originalAncestorPath).not.toEqual(mirrorAncestorPath);
  });
});
