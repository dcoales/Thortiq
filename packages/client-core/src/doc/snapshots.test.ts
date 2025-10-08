import { describe, expect, it } from "vitest";

import { createOutlineDoc } from "./transactions";
import { createNode } from "./nodes";
import { addEdge, reconcileOutlineStructure } from "./index";
import { createMirrorEdge } from "../mirror/createMirrorEdge";
import { createOutlineSnapshot } from "./snapshots";

describe("snapshots module", () => {
  it("produces a plain-data snapshot of nodes, edges, and children", () => {
    const outline = createOutlineDoc();
    const rootNode = createNode(outline, { text: "root" });
    const { edgeId } = addEdge(outline, { parentNodeId: null, childNodeId: rootNode });
    const childNode = createNode(outline, { text: "child" });
    const { edgeId: childEdgeId } = addEdge(outline, { parentNodeId: rootNode, childNodeId: childNode });

    const snapshot = createOutlineSnapshot(outline);

    expect(snapshot.nodes.get(rootNode)?.text).toBe("root");
    expect(snapshot.edges.get(edgeId)?.childNodeId).toBe(rootNode);
    expect(snapshot.childrenByParent.get(rootNode)).toEqual([childEdgeId]);
    const projectedChildIds = snapshot.childEdgeIdsByParentEdge.get(edgeId);
    expect(projectedChildIds).toEqual([childEdgeId]);
    expect(snapshot.canonicalEdgeIdsByEdgeId.get(childEdgeId)).toBe(childEdgeId);
    expect(Array.isArray(snapshot.rootEdgeIds)).toBe(true);
  });

  it("assigns stable child edge instance ids for mirror parents across reconciliation", () => {
    const outline = createOutlineDoc();
    const originalRoot = addEdge(outline, { parentNodeId: null });
    const mirrorSource = addEdge(outline, { parentNodeId: originalRoot.nodeId });
    const nestedChild = addEdge(outline, { parentNodeId: mirrorSource.nodeId });

    const mirror = createMirrorEdge({
      outline,
      mirrorNodeId: mirrorSource.nodeId,
      insertParentNodeId: null,
      insertIndex: 1
    });

    expect(mirror).not.toBeNull();
    const mirrorEdgeId = mirror!.edgeId;

    const firstSnapshot = createOutlineSnapshot(outline);
    const originalChildren = firstSnapshot.childEdgeIdsByParentEdge.get(mirrorSource.edgeId) ?? [];
    const mirrorInstanceIds = firstSnapshot.childEdgeIdsByParentEdge.get(mirrorEdgeId) ?? [];

    expect(originalChildren).toEqual([nestedChild.edgeId]);
    expect(mirrorInstanceIds).toHaveLength(1);
    const mirrorInstance = mirrorInstanceIds[0]!;
    expect(mirrorInstance).not.toBe(nestedChild.edgeId);
    expect(firstSnapshot.canonicalEdgeIdsByEdgeId.get(mirrorInstance)).toBe(nestedChild.edgeId);

    expect(reconcileOutlineStructure(outline)).toBe(0);

    const secondSnapshot = createOutlineSnapshot(outline);
    expect(secondSnapshot.childEdgeIdsByParentEdge.get(mirrorSource.edgeId)).toEqual(originalChildren);
    expect(secondSnapshot.childEdgeIdsByParentEdge.get(mirrorEdgeId)).toEqual(mirrorInstanceIds);
  });
});
