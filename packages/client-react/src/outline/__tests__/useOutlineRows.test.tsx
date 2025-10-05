import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  addEdge,
  createNode,
  createOutlineDoc,
  createOutlineSnapshot,
  type EdgeId,
  type OutlineSnapshot
} from "@thortiq/client-core";
import type {
  SessionPaneFocusHistoryEntry,
  SessionPaneState
} from "@thortiq/sync-core";

import { useOutlineRows } from "../useOutlineRows";

const TEST_ORIGIN = { source: "useOutlineRows-test" } as const;

type OutlineFixture = {
  readonly snapshot: OutlineSnapshot;
  readonly rootEdgeId: EdgeId;
  readonly parentNodeId: string;
  readonly childEdgeIds: readonly EdgeId[];
};

const createOutlineFixture = (): OutlineFixture => {
  const outline = createOutlineDoc();

  const parentNodeId = createNode(outline, { text: "Parent", origin: TEST_ORIGIN });
  const { edgeId: rootEdgeId } = addEdge(outline, {
    parentNodeId: null,
    childNodeId: parentNodeId,
    origin: TEST_ORIGIN
  });

  const firstChildNode = createNode(outline, { text: "Child Alpha", origin: TEST_ORIGIN });
  const { edgeId: firstChildEdgeId } = addEdge(outline, {
    parentNodeId,
    childNodeId: firstChildNode,
    origin: TEST_ORIGIN
  });

  const secondChildNode = createNode(outline, { text: "Child Beta", origin: TEST_ORIGIN });
  const { edgeId: secondChildEdgeId } = addEdge(outline, {
    parentNodeId,
    childNodeId: secondChildNode,
    origin: TEST_ORIGIN
  });

  const snapshot = createOutlineSnapshot(outline);

  return {
    snapshot,
    rootEdgeId,
    parentNodeId,
    childEdgeIds: [firstChildEdgeId, secondChildEdgeId]
  } satisfies OutlineFixture;
};

const createPaneState = (overrides: Partial<SessionPaneState>): SessionPaneState => ({
  paneId: "outline",
  rootEdgeId: null,
  activeEdgeId: null,
  collapsedEdgeIds: [] as EdgeId[],
  pendingFocusEdgeId: null,
  quickFilter: undefined,
  focusPathEdgeIds: undefined,
  focusHistory: [{ rootEdgeId: null }] as SessionPaneFocusHistoryEntry[],
  focusHistoryIndex: 0,
  searchActive: false,
  ...overrides
});

describe("useOutlineRows", () => {
  it("returns ordered rows and index maps for an unfocused pane", () => {
    const { snapshot, rootEdgeId, childEdgeIds } = createOutlineFixture();
    const pane = createPaneState({ collapsedEdgeIds: [childEdgeIds[0]], quickFilter: undefined });

    const { result } = renderHook(() => useOutlineRows(snapshot, pane));

    expect(result.current.focusContext).toBeNull();
    expect(result.current.appliedFilter).toBeUndefined();

    const edgeIds = result.current.rows.map((row) => row.edgeId);
    expect(edgeIds).toEqual([rootEdgeId, ...childEdgeIds]);

    const firstChildRow = result.current.rowMap.get(childEdgeIds[0]);
    expect(firstChildRow?.collapsed).toBe(true);
    expect(firstChildRow?.treeDepth).toBe(1);

    expect(result.current.edgeIndexMap.get(rootEdgeId)).toBe(0);
    expect(result.current.edgeIndexMap.get(childEdgeIds[0])).toBe(1);
    expect(result.current.edgeIndexMap.get(childEdgeIds[1])).toBe(2);
  });

  it("normalises quick filters and exposes focus context when the pane is scoped", () => {
    const { snapshot, rootEdgeId, childEdgeIds } = createOutlineFixture();
    const pane = createPaneState({
      rootEdgeId,
      focusPathEdgeIds: [rootEdgeId],
      quickFilter: "   Child   "
    });

    const { result } = renderHook(() => useOutlineRows(snapshot, pane));

    expect(result.current.focusContext).not.toBeNull();
    expect(result.current.focusContext?.edge.id).toBe(rootEdgeId);
    expect(result.current.appliedFilter).toBe("Child");

    expect(result.current.rows).toHaveLength(2);
    result.current.rows.forEach((row, index) => {
      expect(row.edgeId).toBe(childEdgeIds[index]);
      expect(row.depth).toBe(0);
      expect(row.treeDepth).toBe(1);
    });
  });
});
