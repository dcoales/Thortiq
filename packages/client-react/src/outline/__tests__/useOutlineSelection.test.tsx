import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  addEdge,
  createNode,
  createOutlineDoc,
  createOutlineSnapshot,
  buildPaneRows,
  type EdgeId
} from "@thortiq/client-core";

import { useOutlineSelection } from "../useOutlineSelection";
import type { SelectionRange } from "../useOutlineSelection";
import type { OutlineRow } from "../useOutlineRows";

interface SelectionHarnessSetup {
  readonly rows: OutlineRow[];
  readonly edgeIndexMap: ReadonlyMap<EdgeId, number>;
  readonly outline: ReturnType<typeof createOutlineDoc>;
  readonly rootEdgeId: EdgeId;
  readonly siblingEdgeIds: readonly EdgeId[];
}

const TEST_ORIGIN = { scope: "useOutlineSelection-test" } as const;

const createRows = (outline: ReturnType<typeof createOutlineDoc>): SelectionHarnessSetup => {
  const parentNodeId = createNode(outline, { text: "Root", origin: TEST_ORIGIN });
  const { edgeId: rootEdgeId } = addEdge(outline, {
    parentNodeId: null,
    childNodeId: parentNodeId,
    origin: TEST_ORIGIN
  });

  const firstChildNode = createNode(outline, { text: "Child A", origin: TEST_ORIGIN });
  const { edgeId: firstChildEdgeId } = addEdge(outline, {
    parentNodeId,
    childNodeId: firstChildNode,
    origin: TEST_ORIGIN
  });

  const secondChildNode = createNode(outline, { text: "Child B", origin: TEST_ORIGIN });
  const { edgeId: secondChildEdgeId } = addEdge(outline, {
    parentNodeId,
    childNodeId: secondChildNode,
    origin: TEST_ORIGIN
  });

  const snapshot = createOutlineSnapshot(outline);
  const paneRows = buildPaneRows(snapshot, {
    rootEdgeId: null,
    collapsedEdgeIds: [],
    quickFilter: undefined,
    focusPathEdgeIds: undefined
  });

  const rows: OutlineRow[] = paneRows.rows.map((row) => ({
    edgeId: row.edge.id,
    nodeId: row.node.id,
    depth: row.depth,
    treeDepth: row.treeDepth,
    text: row.node.text,
    metadata: row.node.metadata,
    collapsed: row.collapsed,
    parentNodeId: row.parentNodeId,
    hasChildren: row.hasChildren,
    ancestorEdgeIds: row.ancestorEdgeIds,
    ancestorNodeIds: row.ancestorNodeIds
  }));

  const edgeIndexEntries = rows.map<[EdgeId, number]>((row, index) => [row.edgeId, index]);
  const edgeIndexMap = new Map<EdgeId, number>(edgeIndexEntries);

  return {
    rows,
    edgeIndexMap,
    outline,
    rootEdgeId,
    siblingEdgeIds: [firstChildEdgeId, secondChildEdgeId]
  } satisfies SelectionHarnessSetup;
};

describe("useOutlineSelection", () => {
  it("derives selection state and highlights range when provided", () => {
    const outline = createOutlineDoc();
    const { rows, edgeIndexMap, siblingEdgeIds } = createRows(outline);

    const paneSelectionRange = {
      anchorEdgeId: siblingEdgeIds[0],
      headEdgeId: siblingEdgeIds[1]
    } as const;
    const expectedRange: SelectionRange = {
      anchorEdgeId: siblingEdgeIds[0],
      focusEdgeId: siblingEdgeIds[1]
    };

    const setSelectionRange = vi.fn();
    const setSelectedEdgeId = vi.fn();
    const setCollapsed = vi.fn();

    const { result } = renderHook(() =>
      useOutlineSelection({
        rows,
        edgeIndexMap,
        paneSelectionRange,
        selectedEdgeId: siblingEdgeIds[0],
        outline,
        localOrigin: TEST_ORIGIN,
        setSelectionRange,
        setSelectedEdgeId,
        setCollapsed
      })
    );

    expect(result.current.selectionRange).toEqual(expectedRange);
    expect(result.current.selectionHighlightActive).toBe(true);
    expect(Array.from(result.current.selectedEdgeIds.values())).toEqual(siblingEdgeIds);
    expect(result.current.orderedSelectedEdgeIds).toEqual(siblingEdgeIds);
    expect(result.current.selectionAdapter.getPrimaryEdgeId()).toBe(siblingEdgeIds[0]);

    result.current.selectionAdapter.clearRange();
    expect(setSelectionRange).toHaveBeenCalledWith(null);
  });

  it("deletes the active selection and focuses the returned edge", () => {
    const outline = createOutlineDoc();
    const { rows, edgeIndexMap, siblingEdgeIds } = createRows(outline);

    const setSelectionRange = vi.fn();
    const setSelectedEdgeId = vi.fn();

    const { result } = renderHook(() =>
      useOutlineSelection({
        rows,
        edgeIndexMap,
        paneSelectionRange: undefined,
        selectedEdgeId: siblingEdgeIds[0],
        outline,
        localOrigin: TEST_ORIGIN,
        setSelectionRange,
        setSelectedEdgeId,
        setCollapsed: vi.fn()
      })
    );

    const handled = result.current.handleDeleteSelection();
    expect(handled).toBe(true);
    expect(setSelectedEdgeId).toHaveBeenLastCalledWith(siblingEdgeIds[1]);
  });

  it("inserts a sibling on Enter and forwards focus to the new edge", () => {
    const outline = createOutlineDoc();
    const { rows, edgeIndexMap, siblingEdgeIds } = createRows(outline);

    const setSelectionRange = vi.fn();
    const setSelectedEdgeId = vi.fn();

    const { result } = renderHook(() =>
      useOutlineSelection({
        rows,
        edgeIndexMap,
        paneSelectionRange: undefined,
        selectedEdgeId: siblingEdgeIds[0],
        outline,
        localOrigin: TEST_ORIGIN,
        setSelectionRange,
        setSelectedEdgeId,
        setCollapsed: vi.fn()
      })
    );

    let handled = false;
    act(() => {
      handled = result.current.handleCommand("outline.insertSiblingBelow");
    });

    expect(handled).toBe(true);

    expect(setSelectionRange).toHaveBeenCalledWith(null);
    expect(setSelectedEdgeId).toHaveBeenCalledTimes(1);
    const nextEdgeId = setSelectedEdgeId.mock.calls[0]?.[0];
    expect(nextEdgeId).not.toBeNull();
    expect(nextEdgeId).not.toBe(siblingEdgeIds[0]);
  });
});
