import { describe, expect, it } from "vitest";

import type { OutlineSnapshot } from "./types";
import type { EdgeId } from "./ids";
import { buildPaneRows, planBreadcrumbVisibility, type PaneStateLike } from "./selectors";

describe("buildPaneRows", () => {
  const snapshot: OutlineSnapshot = {
    nodes: new Map([
      ["node-root", { id: "node-root", text: "Root", metadata: { createdAt: 0, updatedAt: 0, tags: [] } }],
      ["node-child", { id: "node-child", text: "Child", metadata: { createdAt: 0, updatedAt: 0, tags: [] } }],
      ["node-sibling", { id: "node-sibling", text: "Sibling", metadata: { createdAt: 0, updatedAt: 0, tags: [] } }],
      ["node-grandchild", { id: "node-grandchild", text: "Grandchild", metadata: { createdAt: 0, updatedAt: 0, tags: [] } }]
    ]),
    edges: new Map([
      ["edge-root", { id: "edge-root" as EdgeId, parentNodeId: null, childNodeId: "node-root", collapsed: false, mirrorOfNodeId: null, position: 0 }],
      ["edge-sibling", { id: "edge-sibling" as EdgeId, parentNodeId: null, childNodeId: "node-sibling", collapsed: false, mirrorOfNodeId: null, position: 1 }],
      ["edge-child", { id: "edge-child" as EdgeId, parentNodeId: "node-root", childNodeId: "node-child", collapsed: false, mirrorOfNodeId: null, position: 0 }],
      ["edge-grandchild", { id: "edge-grandchild" as EdgeId, parentNodeId: "node-child", childNodeId: "node-grandchild", collapsed: false, mirrorOfNodeId: null, position: 0 }]
    ]),
    rootEdgeIds: ["edge-root" as EdgeId, "edge-sibling" as EdgeId],
    childrenByParent: new Map([
      ["node-root", ["edge-child" as EdgeId]],
      ["node-child", ["edge-grandchild" as EdgeId]]
    ])
  };

  const basePane: PaneStateLike = {
    rootEdgeId: null,
    collapsedEdgeIds: [],
    quickFilter: undefined
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

  it("returns a trimmed quick filter string when present", () => {
    const result = buildPaneRows(snapshot, {
      ...basePane,
      quickFilter: "  tag:urgent  "
    });

    expect(result.appliedFilter).toBe("tag:urgent");
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
