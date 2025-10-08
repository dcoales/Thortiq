import { describe, expect, it } from "vitest";

import {
  createEdgeInstanceId,
  type EdgeId,
  type EdgeSnapshot,
  type OutlineSnapshot
} from "@thortiq/client-core";
import { projectEdgeIdForParent } from "../projectEdgeId";

const createSnapshot = (): OutlineSnapshot => {
  const canonicalParentEdgeId: EdgeId = "canonical-parent";
  const mirrorParentEdgeId: EdgeId = "mirror-parent";
  const instanceParentEdgeId = createEdgeInstanceId(mirrorParentEdgeId, "canonical-child");

  const edges = new Map<EdgeId, EdgeSnapshot>([
    [
      canonicalParentEdgeId,
      {
        id: canonicalParentEdgeId,
        canonicalEdgeId: canonicalParentEdgeId,
        parentNodeId: null,
        childNodeId: "node-a",
        collapsed: false,
        mirrorOfNodeId: null,
        position: 0
      }
    ],
    [
      mirrorParentEdgeId,
      {
        id: mirrorParentEdgeId,
        canonicalEdgeId: mirrorParentEdgeId,
        parentNodeId: null,
        childNodeId: "node-b",
        collapsed: false,
        mirrorOfNodeId: "node-a",
        position: 0
      }
    ],
    [
      instanceParentEdgeId,
      {
        id: instanceParentEdgeId,
        canonicalEdgeId: "canonical-child",
        parentNodeId: null,
        childNodeId: "node-c",
        collapsed: false,
        mirrorOfNodeId: null,
        position: 0
      }
    ]
  ]);

  const canonicalEdgeIdsByEdgeId = new Map<EdgeId, EdgeId>([
    [canonicalParentEdgeId, canonicalParentEdgeId],
    [mirrorParentEdgeId, mirrorParentEdgeId],
    [instanceParentEdgeId, "canonical-child"]
  ]);

  return {
    nodes: new Map(),
    edges,
    rootEdgeIds: [],
    childrenByParent: new Map(),
    childEdgeIdsByParentEdge: new Map(),
    canonicalEdgeIdsByEdgeId
  } as OutlineSnapshot;
};

describe("projectEdgeIdForParent", () => {
  it("returns the canonical edge id when the parent is canonical", () => {
    const snapshot = createSnapshot();
    const result = projectEdgeIdForParent(snapshot, "canonical-parent", "new-child");
    expect(result).toBe("new-child");
  });

  it("returns the canonical edge id when there is no parent", () => {
    const snapshot = createSnapshot();
    const result = projectEdgeIdForParent(snapshot, null, "new-child");
    expect(result).toBe("new-child");
  });

  it("returns a projected edge id when the parent is a mirror edge", () => {
    const snapshot = createSnapshot();
    const projected = projectEdgeIdForParent(snapshot, "mirror-parent", "new-child");
    expect(projected).toBe(createEdgeInstanceId("mirror-parent", "new-child"));
  });

  it("returns a projected edge id when the parent is already an instance edge", () => {
    const snapshot = createSnapshot();
    const parentInstance = createEdgeInstanceId("mirror-parent", "canonical-child");
    const projected = projectEdgeIdForParent(snapshot, parentInstance, "new-child");
    expect(projected).toBe(createEdgeInstanceId(parentInstance, "new-child"));
  });
});
