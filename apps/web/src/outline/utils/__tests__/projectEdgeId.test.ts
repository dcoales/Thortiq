import { describe, expect, it } from "vitest";

import {
  createEdgeInstanceId,
  type EdgeId,
  type EdgeSnapshot,
  type OutlineSnapshot
} from "@thortiq/client-core";
import {
  projectEdgeIdAfterIndent,
  projectEdgeIdAfterOutdent,
  projectEdgeIdForParent
} from "../projectEdgeId";

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
    rootEdgeIds: Object.freeze([] as EdgeId[]),
    childrenByParent: new Map(),
    childEdgeIdsByParentEdge: new Map(),
    canonicalEdgeIdsByEdgeId
  } as OutlineSnapshot;
};

const createIndentSnapshot = () => {
  const mirrorParentEdgeId: EdgeId = "mirror-parent";
  const canonicalChildA: EdgeId = "canonical-child-a";
  const canonicalChildB: EdgeId = "canonical-child-b";
  const instanceChildA = createEdgeInstanceId(mirrorParentEdgeId, canonicalChildA);
  const instanceChildB = createEdgeInstanceId(mirrorParentEdgeId, canonicalChildB);

  const edgeEntries = new Map<EdgeId, EdgeSnapshot>([
    [
      mirrorParentEdgeId,
      {
        id: mirrorParentEdgeId,
        canonicalEdgeId: mirrorParentEdgeId,
        parentNodeId: null,
        childNodeId: "node-mirror",
        collapsed: false,
        mirrorOfNodeId: "node-original",
        position: 0
      }
    ],
    [
      canonicalChildA,
      {
        id: canonicalChildA,
        canonicalEdgeId: canonicalChildA,
        parentNodeId: "node-original",
        childNodeId: "node-child-a",
        collapsed: false,
        mirrorOfNodeId: null,
        position: 0
      }
    ],
    [
      canonicalChildB,
      {
        id: canonicalChildB,
        canonicalEdgeId: canonicalChildB,
        parentNodeId: "node-original",
        childNodeId: "node-child-b",
        collapsed: false,
        mirrorOfNodeId: null,
        position: 1
      }
    ],
    [
      instanceChildA,
      {
        id: instanceChildA,
        canonicalEdgeId: canonicalChildA,
        parentNodeId: "node-mirror",
        childNodeId: "node-child-a",
        collapsed: false,
        mirrorOfNodeId: null,
        position: 0
      }
    ],
    [
      instanceChildB,
      {
        id: instanceChildB,
        canonicalEdgeId: canonicalChildB,
        parentNodeId: "node-mirror",
        childNodeId: "node-child-b",
        collapsed: false,
        mirrorOfNodeId: null,
        position: 1
      }
    ]
  ]);

  const canonicalEdgeIdsByEdgeId = new Map<EdgeId, EdgeId>([
    [mirrorParentEdgeId, mirrorParentEdgeId],
    [canonicalChildA, canonicalChildA],
    [canonicalChildB, canonicalChildB],
    [instanceChildA, canonicalChildA],
    [instanceChildB, canonicalChildB]
  ]);

  const childEdgeIdsByParentEdge = new Map<EdgeId, ReadonlyArray<EdgeId>>([
    [mirrorParentEdgeId, Object.freeze([instanceChildA, instanceChildB]) as ReadonlyArray<EdgeId>],
    [instanceChildA, Object.freeze([]) as ReadonlyArray<EdgeId>],
    [instanceChildB, Object.freeze([]) as ReadonlyArray<EdgeId>]
  ]);

  return {
    nodes: new Map(),
    edges: edgeEntries,
    rootEdgeIds: Object.freeze([mirrorParentEdgeId]) as ReadonlyArray<EdgeId>,
    childrenByParent: new Map(),
    childEdgeIdsByParentEdge,
    canonicalEdgeIdsByEdgeId
  } as OutlineSnapshot;
};

const createRootIndentSnapshot = () => {
  const rootAlpha: EdgeId = "root-alpha";
  const rootBeta: EdgeId = "root-beta";

  const edges = new Map<EdgeId, EdgeSnapshot>([
    [
      rootAlpha,
      {
        id: rootAlpha,
        canonicalEdgeId: rootAlpha,
        parentNodeId: null,
        childNodeId: "node-alpha",
        collapsed: false,
        mirrorOfNodeId: null,
        position: 0
      }
    ],
    [
      rootBeta,
      {
        id: rootBeta,
        canonicalEdgeId: rootBeta,
        parentNodeId: null,
        childNodeId: "node-beta",
        collapsed: false,
        mirrorOfNodeId: null,
        position: 1
      }
    ]
  ]);

  const canonicalEdgeIdsByEdgeId = new Map<EdgeId, EdgeId>([
    [rootAlpha, rootAlpha],
    [rootBeta, rootBeta]
  ]);

  return {
    nodes: new Map(),
    edges,
    rootEdgeIds: Object.freeze([rootAlpha, rootBeta]) as ReadonlyArray<EdgeId>,
    childrenByParent: new Map(),
    childEdgeIdsByParentEdge: new Map(),
    canonicalEdgeIdsByEdgeId
  } as OutlineSnapshot;
};

const createOutdentSnapshot = () => {
  const hostRoot: EdgeId = "host-root";
  const canonicalOuter: EdgeId = "canonical-outer";
  const outerMirror: EdgeId = "outer-mirror";
  const canonicalParent: EdgeId = "canonical-parent";
  const innerMirror: EdgeId = "mirror-parent";
  const canonicalChild: EdgeId = "canonical-child";
  const innerInstance = createEdgeInstanceId(innerMirror, canonicalChild);
  const outerInstance = createEdgeInstanceId(outerMirror, canonicalChild);

  const edges = new Map<EdgeId, EdgeSnapshot>([
    [
      hostRoot,
      {
        id: hostRoot,
        canonicalEdgeId: hostRoot,
        parentNodeId: null,
        childNodeId: "node-host",
        collapsed: false,
        mirrorOfNodeId: null,
        position: 0
      }
    ],
    [
      canonicalOuter,
      {
        id: canonicalOuter,
        canonicalEdgeId: canonicalOuter,
        parentNodeId: null,
        childNodeId: "node-outer",
        collapsed: false,
        mirrorOfNodeId: null,
        position: 1
      }
    ],
    [
      outerMirror,
      {
        id: outerMirror,
        canonicalEdgeId: canonicalOuter,
        parentNodeId: "node-host",
        childNodeId: "node-outer",
        collapsed: false,
        mirrorOfNodeId: "node-outer",
        position: 0
      }
    ],
    [
      canonicalParent,
      {
        id: canonicalParent,
        canonicalEdgeId: canonicalParent,
        parentNodeId: "node-outer",
        childNodeId: "node-parent",
        collapsed: false,
        mirrorOfNodeId: null,
        position: 0
      }
    ],
    [
      innerMirror,
      {
        id: innerMirror,
        canonicalEdgeId: canonicalParent,
        parentNodeId: "node-outer",
        childNodeId: "node-parent",
        collapsed: false,
        mirrorOfNodeId: "node-parent",
        position: 0
      }
    ],
    [
      canonicalChild,
      {
        id: canonicalChild,
        canonicalEdgeId: canonicalChild,
        parentNodeId: "node-parent",
        childNodeId: "node-child",
        collapsed: false,
        mirrorOfNodeId: null,
        position: 0
      }
    ],
    [
      innerInstance,
      {
        id: innerInstance,
        canonicalEdgeId: canonicalChild,
        parentNodeId: "node-parent",
        childNodeId: "node-child",
        collapsed: false,
        mirrorOfNodeId: null,
        position: 0
      }
    ]
  ]);

  const canonicalEdgeIdsByEdgeId = new Map<EdgeId, EdgeId>([
    [hostRoot, hostRoot],
    [canonicalOuter, canonicalOuter],
    [outerMirror, canonicalOuter],
    [canonicalParent, canonicalParent],
    [innerMirror, canonicalParent],
    [canonicalChild, canonicalChild],
    [innerInstance, canonicalChild],
    [outerInstance, canonicalChild]
  ]);

  const childEdgeIdsByParentEdge = new Map<EdgeId, ReadonlyArray<EdgeId>>([
    [hostRoot, Object.freeze([outerMirror]) as ReadonlyArray<EdgeId>],
    [outerMirror, Object.freeze([innerMirror]) as ReadonlyArray<EdgeId>],
    [canonicalOuter, Object.freeze([canonicalParent]) as ReadonlyArray<EdgeId>],
    [canonicalParent, Object.freeze([canonicalChild]) as ReadonlyArray<EdgeId>],
    [innerMirror, Object.freeze([innerInstance]) as ReadonlyArray<EdgeId>]
  ]);

  return {
    nodes: new Map(),
    edges,
    rootEdgeIds: Object.freeze([hostRoot, canonicalOuter]) as ReadonlyArray<EdgeId>,
    childrenByParent: new Map(),
    childEdgeIdsByParentEdge,
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

describe("projectEdgeIdAfterIndent", () => {
  it("falls back to the canonical edge when no previous sibling exists", () => {
    const snapshot = createIndentSnapshot();
    const canonicalChildA: EdgeId = "canonical-child-a";
    const result = projectEdgeIdAfterIndent(snapshot, {
      currentEdgeId: createEdgeInstanceId("mirror-parent", canonicalChildA),
      currentParentEdgeId: "mirror-parent",
      canonicalEdgeId: canonicalChildA
    });
    expect(result).toBe(canonicalChildA);
  });

  it("projects the canonical edge using the previous sibling instance for mirrors", () => {
    const snapshot = createIndentSnapshot();
    const canonicalChildB: EdgeId = "canonical-child-b";
    const instanceChildA = createEdgeInstanceId("mirror-parent", "canonical-child-a");
    const projected = projectEdgeIdAfterIndent(snapshot, {
      currentEdgeId: createEdgeInstanceId("mirror-parent", canonicalChildB),
      currentParentEdgeId: "mirror-parent",
      canonicalEdgeId: canonicalChildB
    });
    expect(projected).toBe(createEdgeInstanceId(instanceChildA, canonicalChildB));
  });

  it("uses root ordering when the indent target is a root edge", () => {
    const snapshot = createRootIndentSnapshot();
    const projected = projectEdgeIdAfterIndent(snapshot, {
      currentEdgeId: "root-beta",
      currentParentEdgeId: null,
      canonicalEdgeId: "root-beta"
    });
    expect(projected).toBe("root-beta");
  });
});

describe("projectEdgeIdAfterOutdent", () => {
  it("projects to the grandparent mirror when leaving a mirrored parent", () => {
    const snapshot = createOutdentSnapshot();
    const canonicalChild: EdgeId = "canonical-child";
    const projected = projectEdgeIdAfterOutdent(snapshot, {
      canonicalEdgeId: canonicalChild,
      newParentEdgeId: "outer-mirror" as EdgeId
    });
    expect(projected).toBe(createEdgeInstanceId("outer-mirror", canonicalChild));
  });

  it("returns the canonical edge when moving to the root", () => {
    const snapshot = createOutdentSnapshot();
    const canonicalChild: EdgeId = "canonical-child";
    const projected = projectEdgeIdAfterOutdent(snapshot, {
      canonicalEdgeId: canonicalChild,
      newParentEdgeId: null
    });
    expect(projected).toBe(canonicalChild);
  });
});
