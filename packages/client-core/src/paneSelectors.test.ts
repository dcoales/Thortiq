import { describe, expect, it } from "vitest";

import type { OutlineSnapshot } from "./types";
import type { EdgeId } from "./ids";
import { buildPaneRows, planBreadcrumbVisibility, type PaneStateLike } from "./selectors";

describe("buildPaneRows", () => {
  const snapshot: OutlineSnapshot = {
    nodes: new Map([
      [
        "node-root",
        {
          id: "node-root",
          text: "Root",
          inlineContent: [],
          metadata: { createdAt: 0, updatedAt: 0, tags: [], layout: "standard" }
        }
      ],
      [
        "node-child",
        {
          id: "node-child",
          text: "Child",
          inlineContent: [],
          metadata: { createdAt: 0, updatedAt: 0, tags: [], layout: "standard" }
        }
      ],
      [
        "node-sibling",
        {
          id: "node-sibling",
          text: "Sibling",
          inlineContent: [],
          metadata: { createdAt: 0, updatedAt: 0, tags: [], layout: "standard" }
        }
      ],
      [
        "node-grandchild",
        {
          id: "node-grandchild",
          text: "Grandchild",
          inlineContent: [],
          metadata: { createdAt: 0, updatedAt: 0, tags: [], layout: "standard" }
        }
      ]
    ]),
    edges: new Map([
      ["edge-root", {
        id: "edge-root" as EdgeId,
        canonicalEdgeId: "edge-root" as EdgeId,
        parentNodeId: null,
        childNodeId: "node-root",
        collapsed: false,
        mirrorOfNodeId: null,
        position: 0
      }],
      ["edge-sibling", {
        id: "edge-sibling" as EdgeId,
        canonicalEdgeId: "edge-sibling" as EdgeId,
        parentNodeId: null,
        childNodeId: "node-sibling",
        collapsed: false,
        mirrorOfNodeId: null,
        position: 1
      }],
      ["edge-child", {
        id: "edge-child" as EdgeId,
        canonicalEdgeId: "edge-child" as EdgeId,
        parentNodeId: "node-root",
        childNodeId: "node-child",
        collapsed: false,
        mirrorOfNodeId: null,
        position: 0
      }],
      ["edge-grandchild", {
        id: "edge-grandchild" as EdgeId,
        canonicalEdgeId: "edge-grandchild" as EdgeId,
        parentNodeId: "node-child",
        childNodeId: "node-grandchild",
        collapsed: false,
        mirrorOfNodeId: null,
        position: 0
      }]
    ]),
    rootEdgeIds: ["edge-root" as EdgeId, "edge-sibling" as EdgeId],
    childrenByParent: new Map([
      ["node-root", ["edge-child" as EdgeId]],
      ["node-child", ["edge-grandchild" as EdgeId]]
    ]),
    childEdgeIdsByParentEdge: new Map([
      ["edge-root", ["edge-child" as EdgeId]],
      ["edge-child", ["edge-grandchild" as EdgeId]],
      ["edge-grandchild", []],
      ["edge-sibling", []]
    ]),
    canonicalEdgeIdsByEdgeId: new Map([
      ["edge-root", "edge-root"],
      ["edge-sibling", "edge-sibling"],
      ["edge-child", "edge-child"],
      ["edge-grandchild", "edge-grandchild"]
    ])
  };

  const basePane: PaneStateLike = {
    rootEdgeId: null,
    collapsedEdgeIds: [],
    search: undefined
  };

  it("flattens the entire outline when no root override is provided", () => {
    const result = buildPaneRows(snapshot, basePane);

    expect(result.rows.map((row) => [row.edge.id, row.depth])).toEqual([
      ["edge-root", 0],
      ["edge-child", 1],
      ["edge-grandchild", 2],
      ["edge-sibling", 0]
    ]);
    const grandchildRow = result.rows.find((row) => row.edge.id === "edge-grandchild");
    expect(grandchildRow?.treeDepth).toBe(2);
    expect(grandchildRow?.ancestorEdgeIds).toEqual(["edge-root", "edge-child"]);
    expect(result.appliedFilter).toBeUndefined();
  });

  it("focuses on a specific subtree when rootEdgeId is provided", () => {
    const result = buildPaneRows(snapshot, { ...basePane, rootEdgeId: "edge-child" as EdgeId });

    expect(result.rows.map((row) => row.edge.id)).toEqual(["edge-grandchild"]);
    expect(result.rows[0]?.depth).toBe(0);
    expect(result.rows[0]?.treeDepth).toBe(2);
    expect(result.rows[0]?.ancestorEdgeIds).toEqual(["edge-root", "edge-child"]);
    expect(result.focus?.edge.id).toBe("edge-child");
    expect(result.focus?.path.map((segment) => segment.edge.id)).toEqual(["edge-root", "edge-child"]);
  });

  it("uses provided focus path hints when available", () => {
    const result = buildPaneRows(snapshot, {
      ...basePane,
      rootEdgeId: "edge-child" as EdgeId,
      focusPathEdgeIds: ["edge-root" as EdgeId, "edge-child" as EdgeId]
    });

    expect(result.focus?.path.map((segment) => segment.edge.id)).toEqual(["edge-root", "edge-child"]);
    expect(result.rows.map((row) => row.edge.id)).toEqual(["edge-grandchild"]);
  });

  it("applies collapse overrides from the pane state", () => {
    const result = buildPaneRows(snapshot, {
      ...basePane,
      collapsedEdgeIds: ["edge-child" as EdgeId]
    });

    const childRow = result.rows.find((row) => row.edge.id === "edge-child");
    expect(childRow?.collapsed).toBe(true);
    expect(result.rows.map((row) => row.edge.id)).toEqual(["edge-root", "edge-child", "edge-sibling"]);
  });

  it("returns a trimmed search string when present", () => {
    const result = buildPaneRows(snapshot, {
      ...basePane,
      search: { submitted: "  tag:urgent  ", resultEdgeIds: [] }
    });

    expect(result.appliedFilter).toBe("tag:urgent");
  });

  it("assigns list ordinals per parent edge for numbered layouts", () => {
    const numberingSnapshot: OutlineSnapshot = {
      nodes: new Map([
        [
          "node-first",
          {
            id: "node-first",
            text: "First",
            inlineContent: [],
            metadata: { createdAt: 0, updatedAt: 0, tags: [], layout: "numbered" }
          }
        ],
        [
          "node-second",
          {
            id: "node-second",
            text: "Second",
            inlineContent: [],
            metadata: { createdAt: 0, updatedAt: 0, tags: [], layout: "standard" }
          }
        ],
        [
          "node-third",
          {
            id: "node-third",
            text: "Third",
            inlineContent: [],
            metadata: { createdAt: 0, updatedAt: 0, tags: [], layout: "numbered" }
          }
        ],
        [
          "node-parent",
          {
            id: "node-parent",
            text: "Parent",
            inlineContent: [],
            metadata: { createdAt: 0, updatedAt: 0, tags: [], layout: "standard" }
          }
        ],
        [
          "node-child-numbered",
          {
            id: "node-child-numbered",
            text: "Child Numbered",
            inlineContent: [],
            metadata: { createdAt: 0, updatedAt: 0, tags: [], layout: "numbered" }
          }
        ],
        [
          "node-child-standard",
          {
            id: "node-child-standard",
            text: "Child Standard",
            inlineContent: [],
            metadata: { createdAt: 0, updatedAt: 0, tags: [], layout: "standard" }
          }
        ],
        [
          "node-child-numbered-two",
          {
            id: "node-child-numbered-two",
            text: "Child Numbered Two",
            inlineContent: [],
            metadata: { createdAt: 0, updatedAt: 0, tags: [], layout: "numbered" }
          }
        ]
      ]),
      edges: new Map([
        [
          "edge-first",
          {
            id: "edge-first" as EdgeId,
            canonicalEdgeId: "edge-first" as EdgeId,
            parentNodeId: null,
            childNodeId: "node-first",
            collapsed: false,
            mirrorOfNodeId: null,
            position: 0
          }
        ],
        [
          "edge-second",
          {
            id: "edge-second" as EdgeId,
            canonicalEdgeId: "edge-second" as EdgeId,
            parentNodeId: null,
            childNodeId: "node-second",
            collapsed: false,
            mirrorOfNodeId: null,
            position: 1
          }
        ],
        [
          "edge-third",
          {
            id: "edge-third" as EdgeId,
            canonicalEdgeId: "edge-third" as EdgeId,
            parentNodeId: null,
            childNodeId: "node-third",
            collapsed: false,
            mirrorOfNodeId: null,
            position: 2
          }
        ],
        [
          "edge-parent",
          {
            id: "edge-parent" as EdgeId,
            canonicalEdgeId: "edge-parent" as EdgeId,
            parentNodeId: null,
            childNodeId: "node-parent",
            collapsed: false,
            mirrorOfNodeId: null,
            position: 3
          }
        ],
        [
          "edge-parent-child-1",
          {
            id: "edge-parent-child-1" as EdgeId,
            canonicalEdgeId: "edge-parent-child-1" as EdgeId,
            parentNodeId: "node-parent",
            childNodeId: "node-child-numbered",
            collapsed: false,
            mirrorOfNodeId: null,
            position: 0
          }
        ],
        [
          "edge-parent-child-2",
          {
            id: "edge-parent-child-2" as EdgeId,
            canonicalEdgeId: "edge-parent-child-2" as EdgeId,
            parentNodeId: "node-parent",
            childNodeId: "node-child-standard",
            collapsed: false,
            mirrorOfNodeId: null,
            position: 1
          }
        ],
        [
          "edge-parent-child-3",
          {
            id: "edge-parent-child-3" as EdgeId,
            canonicalEdgeId: "edge-parent-child-3" as EdgeId,
            parentNodeId: "node-parent",
            childNodeId: "node-child-numbered-two",
            collapsed: false,
            mirrorOfNodeId: null,
            position: 2
          }
        ]
      ]),
      rootEdgeIds: [
        "edge-first" as EdgeId,
        "edge-second" as EdgeId,
        "edge-third" as EdgeId,
        "edge-parent" as EdgeId
      ],
      childrenByParent: new Map([
        [
          "node-parent",
          [
            "edge-parent-child-1" as EdgeId,
            "edge-parent-child-2" as EdgeId,
            "edge-parent-child-3" as EdgeId
          ]
        ]
      ]),
      childEdgeIdsByParentEdge: new Map([
        ["edge-first" as EdgeId, []],
        ["edge-second" as EdgeId, []],
        ["edge-third" as EdgeId, []],
        [
          "edge-parent" as EdgeId,
          [
            "edge-parent-child-1" as EdgeId,
            "edge-parent-child-2" as EdgeId,
            "edge-parent-child-3" as EdgeId
          ]
        ],
        ["edge-parent-child-1" as EdgeId, []],
        ["edge-parent-child-2" as EdgeId, []],
        ["edge-parent-child-3" as EdgeId, []]
      ]),
      canonicalEdgeIdsByEdgeId: new Map([
        ["edge-first" as EdgeId, "edge-first" as EdgeId],
        ["edge-second" as EdgeId, "edge-second" as EdgeId],
        ["edge-third" as EdgeId, "edge-third" as EdgeId],
        ["edge-parent" as EdgeId, "edge-parent" as EdgeId],
        ["edge-parent-child-1" as EdgeId, "edge-parent-child-1" as EdgeId],
        ["edge-parent-child-2" as EdgeId, "edge-parent-child-2" as EdgeId],
        ["edge-parent-child-3" as EdgeId, "edge-parent-child-3" as EdgeId]
      ])
    };

    const result = buildPaneRows(numberingSnapshot, basePane);
    const ordinalByEdge = new Map(result.rows.map((row) => [row.edge.id, row.listOrdinal]));

    expect(ordinalByEdge.get("edge-first")).toBe(1);
    expect(ordinalByEdge.get("edge-third")).toBe(2);
    expect(ordinalByEdge.get("edge-second")).toBeNull();
    expect(ordinalByEdge.get("edge-parent-child-1")).toBe(1);
    expect(ordinalByEdge.get("edge-parent-child-2")).toBeNull();
    expect(ordinalByEdge.get("edge-parent-child-3")).toBe(2);
  });

  it("derives search metadata for matches and ancestors", () => {
    const searchState = {
      submitted: "text:child",
      resultEdgeIds: ["edge-root" as EdgeId, "edge-child" as EdgeId],
      manuallyExpandedEdgeIds: ["edge-root" as EdgeId],
      manuallyCollapsedEdgeIds: [],
      appendedEdgeIds: []
    } as const;

    const runtime = {
      matches: new Set<EdgeId>(["edge-child" as EdgeId]),
      ancestorEdgeIds: new Set<EdgeId>(["edge-root" as EdgeId])
    };

    const result = buildPaneRows(snapshot, { ...basePane, search: searchState }, runtime);

    expect(result.rows.map((row) => row.edge.id)).toEqual(["edge-root", "edge-child"]);
    const rootRow = result.rows[0];
    const childRow = result.rows[1];
    expect(rootRow?.search?.kind).toBe("ancestor");
    expect(rootRow?.showsSubsetOfChildren).toBe(false);
    expect(childRow?.search?.kind).toBe("match");
    expect(childRow?.showsSubsetOfChildren).toBe(true);
    expect(result.appliedFilter).toBe("text:child");
    expect(result.focus).toBeNull();
  });

  it("marks appended rows and preserves order", () => {
    const searchState = {
      submitted: "text:child",
      resultEdgeIds: [
        "edge-root" as EdgeId,
        "edge-child" as EdgeId,
        "edge-grandchild" as EdgeId
      ],
      manuallyExpandedEdgeIds: ["edge-root" as EdgeId],
      manuallyCollapsedEdgeIds: [],
      appendedEdgeIds: ["edge-grandchild" as EdgeId]
    } as const;

    const runtime = {
      matches: new Set<EdgeId>(["edge-child" as EdgeId]),
      ancestorEdgeIds: new Set<EdgeId>(["edge-root" as EdgeId])
    };

    const result = buildPaneRows(snapshot, { ...basePane, search: searchState }, runtime);

    expect(result.rows.map((row) => row.edge.id)).toEqual([
      "edge-root",
      "edge-child",
      "edge-grandchild"
    ]);
    const appendedRow = result.rows[2];
    expect(appendedRow?.search?.kind).toBe("appended");
    expect(appendedRow?.showsSubsetOfChildren).toBe(false);
  });
});

describe("planBreadcrumbVisibility", () => {
  it("keeps all items visible when space permits", () => {
    const plan = planBreadcrumbVisibility([{ width: 40 }, { width: 60 }], 200, 24);
    expect(plan.visibleIndices).toEqual([0, 1]);
    expect(plan.collapsedRanges).toHaveLength(0);
    expect(plan.fitsWithinWidth).toBe(true);
  });

  it("collapses middle segments when width is constrained", () => {
    const plan = planBreadcrumbVisibility(
      [{ width: 80 }, { width: 120 }, { width: 110 }, { width: 90 }],
      210,
      24
    );

    expect(plan.visibleIndices.includes(0)).toBe(true);
    expect(plan.visibleIndices.includes(3)).toBe(true);
    expect(plan.collapsedRanges).toEqual([[1, 2]]);
  });

  it("collapses a single contiguous range even when multiple gaps would fit individually", () => {
    const plan = planBreadcrumbVisibility(
      [{ width: 64 }, { width: 48 }, { width: 82 }, { width: 56 }, { width: 96 }],
      200,
      24
    );

    expect(plan.visibleIndices).toEqual([0, 4]);
    expect(plan.collapsedRanges).toEqual([[1, 3]]);
  });

  it("drops the leading crumbs when only the focused node fits", () => {
    const plan = planBreadcrumbVisibility(
      [{ width: 96 }, { width: 88 }, { width: 120 }],
      140,
      24
    );

    expect(plan.visibleIndices).toEqual([2]);
    expect(plan.collapsedRanges).toEqual([[0, 1]]);
  });
});
