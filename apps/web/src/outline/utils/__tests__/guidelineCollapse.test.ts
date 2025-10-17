import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  addEdge,
  createOutlineDoc,
  createOutlineSnapshot,
  createMirrorEdge
} from "@thortiq/client-core";
import type { SessionPaneState } from "@thortiq/sync-core";
import { defaultPaneSearchState } from "@thortiq/sync-core";
import { useOutlineRows } from "@thortiq/client-react";

import { planGuidelineCollapse } from "../guidelineCollapse";

const TEST_ORIGIN = { scope: "guidelineCollapse-test" } as const;

const createMirrorFixture = () => {
  const outline = createOutlineDoc();
  const originalRoot = addEdge(outline, {
    parentNodeId: null,
    text: "Original root",
    origin: TEST_ORIGIN
  });
  const child = addEdge(outline, {
    parentNodeId: originalRoot.nodeId,
    text: "Child",
    origin: TEST_ORIGIN
  });

  const mirror = createMirrorEdge({
    outline,
    mirrorNodeId: originalRoot.nodeId,
    insertParentNodeId: null,
    insertIndex: 1,
    origin: TEST_ORIGIN
  });

  if (!mirror) {
    throw new Error("Failed to create mirror edge for fixture");
  }

  const snapshot = createOutlineSnapshot(outline);
  const pane: SessionPaneState = {
    paneId: "outline",
    paneKind: "outline",
    rootEdgeId: null,
    activeEdgeId: null,
    collapsedEdgeIds: [],
    pendingFocusEdgeId: null,
  focusPathEdgeIds: undefined,
  focusHistory: [{ rootEdgeId: null }],
  focusHistoryIndex: 0,
  selectionRange: undefined,
  search: defaultPaneSearchState(),
  widthRatio: null
  };

  const { result } = renderHook(() => useOutlineRows(snapshot, pane));

  const rows = result.current.rows;
  const rowMap = result.current.rowMap;
  const mirrorChildRow = rows.find(
    (row) => row.edgeId !== row.canonicalEdgeId && row.canonicalEdgeId === child.edgeId
  );
  if (!mirrorChildRow) {
    throw new Error("Mirror child row not found");
  }

  return {
    snapshot,
    rowMap,
    mirrorChildEdgeId: mirrorChildRow.edgeId,
    mirrorParentEdgeId: mirror.edgeId
  };
};

describe("planGuidelineCollapse", () => {
  it("collapses and expands mirror child edges using projected edge ids", () => {
    const {
      snapshot,
      rowMap,
      mirrorChildEdgeId,
      mirrorParentEdgeId
    } = createMirrorFixture();

    const projectedChildren = snapshot.childEdgeIdsByParentEdge.get(mirrorParentEdgeId);
    expect(projectedChildren).toBeDefined();
    expect(projectedChildren?.some((edgeId) => edgeId.includes("::"))).toBe(true);
    const collapsePlan = planGuidelineCollapse({
      edgeId: mirrorParentEdgeId,
      snapshot,
      rowMap,
      collapsedEdgeIds: []
    });

    expect(collapsePlan).not.toBeNull();
    expect(collapsePlan?.toCollapse).toEqual([mirrorChildEdgeId]);
    expect(collapsePlan?.toExpand).toHaveLength(0);

    const collapsedRowMap = new Map(rowMap);
    const mirrorChildRow = rowMap.get(mirrorChildEdgeId);
    if (!mirrorChildRow) {
      throw new Error("Mirror child row missing from map");
    }
    collapsedRowMap.set(mirrorChildEdgeId, { ...mirrorChildRow, collapsed: true });

    const expandPlan = planGuidelineCollapse({
      edgeId: mirrorParentEdgeId,
      snapshot,
      rowMap: collapsedRowMap,
      collapsedEdgeIds: [mirrorChildEdgeId]
    });

    expect(expandPlan).not.toBeNull();
    expect(expandPlan?.toCollapse).toHaveLength(0);
    expect(expandPlan?.toExpand).toEqual([mirrorChildEdgeId]);
  });
});
