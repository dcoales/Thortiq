import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  addEdge,
  createNode,
  createOutlineDoc,
  createOutlineSnapshot,
  buildPaneRows,
  createMirrorEdge,
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

const buildRowsForOutline = (
  outline: ReturnType<typeof createOutlineDoc>
): { rows: OutlineRow[]; edgeIndexMap: ReadonlyMap<EdgeId, number> } => {
  const snapshot = createOutlineSnapshot(outline);
  const paneRows = buildPaneRows(snapshot, {
    rootEdgeId: null,
    collapsedEdgeIds: [],
    search: undefined,
    focusPathEdgeIds: undefined
  });

  const rows: OutlineRow[] = paneRows.rows.map((row) => ({
    edgeId: row.edge.id,
    canonicalEdgeId: row.edge.canonicalEdgeId,
    nodeId: row.node.id,
    depth: row.depth,
    treeDepth: row.treeDepth,
    text: row.node.text,
    inlineContent: row.node.inlineContent,
    metadata: row.node.metadata,
    listOrdinal: row.listOrdinal,
    collapsed: row.collapsed,
    parentNodeId: row.parentNodeId,
    hasChildren: row.hasChildren,
    ancestorEdgeIds: row.ancestorEdgeIds,
    ancestorNodeIds: row.ancestorNodeIds,
    mirrorOfNodeId: row.edge.mirrorOfNodeId,
    mirrorCount: 0,
    showsSubsetOfChildren: row.showsSubsetOfChildren,
    search: row.search
  }));

  const edgeIndexEntries = rows.map<[EdgeId, number]>((row, index) => [row.edgeId, index]);
  rows.forEach((row, index) => {
    if (!edgeIndexEntries.some(([key]) => key === row.canonicalEdgeId)) {
      edgeIndexEntries.push([row.canonicalEdgeId, index]);
    }
  });

  return {
    rows,
    edgeIndexMap: new Map<EdgeId, number>(edgeIndexEntries)
  };
};

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

  const { rows, edgeIndexMap } = buildRowsForOutline(outline);

  return {
    rows,
    edgeIndexMap,
    outline,
    rootEdgeId,
    siblingEdgeIds: [firstChildEdgeId, secondChildEdgeId]
  } satisfies SelectionHarnessSetup;
};

const createMirrorSelectionFixture = () => {
  const outline = createOutlineDoc();
  const root = addEdge(outline, {
    parentNodeId: null,
    text: "Original root",
    origin: TEST_ORIGIN
  });
  const child = addEdge(outline, {
    parentNodeId: root.nodeId,
    text: "Child node",
    origin: TEST_ORIGIN
  });

  const mirror = createMirrorEdge({
    outline,
    mirrorNodeId: root.nodeId,
    insertParentNodeId: null,
    insertIndex: 1,
    origin: TEST_ORIGIN
  });
  if (!mirror) {
    throw new Error("Failed to create mirror edge for fixture");
  }

  const snapshot = createOutlineSnapshot(outline);
  const paneRows = buildPaneRows(snapshot, {
    rootEdgeId: null,
    collapsedEdgeIds: [],
    search: undefined,
    focusPathEdgeIds: undefined
  });

  const mirrorCounts = new Map<string, number>();
  snapshot.edges.forEach((edge) => {
    if (edge.mirrorOfNodeId) {
      const current = mirrorCounts.get(edge.mirrorOfNodeId) ?? 0;
      mirrorCounts.set(edge.mirrorOfNodeId, current + 1);
    }
  });

  const rows: OutlineRow[] = paneRows.rows.map((row) => ({
    edgeId: row.edge.id,
    canonicalEdgeId: row.edge.canonicalEdgeId,
    nodeId: row.node.id,
    depth: row.depth,
    treeDepth: row.treeDepth,
    text: row.node.text,
    inlineContent: row.node.inlineContent,
    metadata: row.node.metadata,
    listOrdinal: row.listOrdinal,
    collapsed: row.collapsed,
    parentNodeId: row.parentNodeId,
    hasChildren: row.hasChildren,
    ancestorEdgeIds: row.ancestorEdgeIds,
    ancestorNodeIds: row.ancestorNodeIds,
    mirrorOfNodeId: row.edge.mirrorOfNodeId,
    mirrorCount: mirrorCounts.get(row.node.id) ?? 0,
    showsSubsetOfChildren: row.showsSubsetOfChildren,
    search: row.search
  }));

  const edgeIndexEntries = rows.map<[EdgeId, number]>((row, index) => [row.edgeId, index]);
  rows.forEach((row, index) => {
    if (!edgeIndexEntries.some(([key]) => key === row.canonicalEdgeId)) {
      edgeIndexEntries.push([row.canonicalEdgeId, index]);
    }
  });
  const edgeIndexMap = new Map<EdgeId, number>(edgeIndexEntries);

  const mirrorChildRow = rows.find(
    (row) => row.canonicalEdgeId === child.edgeId && row.edgeId !== row.canonicalEdgeId
  );
  if (!mirrorChildRow) {
    throw new Error("Mirror child row not found in fixture");
  }
  if (!mirrorChildRow.edgeId.includes("::")) {
    throw new Error(`Mirror child edge id was not projected: ${mirrorChildRow.edgeId}`);
  }

  return {
    outline,
    rows,
    edgeIndexMap,
    mirrorChildEdgeId: mirrorChildRow.edgeId,
    canonicalChildEdgeId: child.edgeId,
    originalEdgeId: root.edgeId
  } as const;
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
      setCollapsed,
      onAppendEdge: undefined
    })
  );

    expect(result.current.selectionRange).toEqual(expectedRange);
    expect(result.current.selectionHighlightActive).toBe(true);
    const selectedEdgeIds = Array.from(result.current.selectedEdgeIds.values());
    const canonicalSelected = selectedEdgeIds.map((edgeId) => {
      const row = rows.find((candidate) => candidate.edgeId === edgeId || candidate.canonicalEdgeId === edgeId);
      return row?.canonicalEdgeId;
    });
    expect(canonicalSelected).toEqual(siblingEdgeIds);

    const orderedCanonical = result.current.orderedSelectedEdgeIds.map((edgeId) => {
      const row = rows.find((candidate) => candidate.edgeId === edgeId || candidate.canonicalEdgeId === edgeId);
      return row?.canonicalEdgeId;
    });
    expect(orderedCanonical).toEqual(siblingEdgeIds);
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

  it("prompts before deleting large selections", () => {
    const outline = createOutlineDoc();
    const rootNodeId = createNode(outline, { text: "bulk root", origin: TEST_ORIGIN });
    const { edgeId: rootEdgeId } = addEdge(outline, {
      parentNodeId: null,
      childNodeId: rootNodeId,
      origin: TEST_ORIGIN
    });
    for (let index = 0; index < 35; index += 1) {
      const childNode = createNode(outline, { text: `child ${index}`, origin: TEST_ORIGIN });
      addEdge(outline, { parentNodeId: rootNodeId, childNodeId: childNode, origin: TEST_ORIGIN });
    }

    const { rows, edgeIndexMap } = buildRowsForOutline(outline);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const setSelectionRange = vi.fn();
    const setSelectedEdgeId = vi.fn();

    const { result } = renderHook(() =>
      useOutlineSelection({
        rows,
        edgeIndexMap,
        paneSelectionRange: undefined,
        selectedEdgeId: rootEdgeId,
        outline,
        localOrigin: TEST_ORIGIN,
        setSelectionRange,
        setSelectedEdgeId,
        setCollapsed: vi.fn()
      })
    );

    const handled = result.current.handleDeleteSelection();

    expect(handled).toBe(true);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy).toHaveBeenCalledWith(
      "Delete 36 nodes? This also removes their descendants."
    );
    expect(setSelectedEdgeId).toHaveBeenLastCalledWith(null);

    confirmSpy.mockRestore();
  });

  it("prompts when deleting originals with surviving mirrors", () => {
    const fixture = createMirrorSelectionFixture();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const setSelectionRange = vi.fn();
    const setSelectedEdgeId = vi.fn();

    const { result } = renderHook(() =>
      useOutlineSelection({
        rows: fixture.rows,
        edgeIndexMap: fixture.edgeIndexMap,
        paneSelectionRange: undefined,
        selectedEdgeId: fixture.originalEdgeId,
        outline: fixture.outline,
        localOrigin: TEST_ORIGIN,
        setSelectionRange,
        setSelectedEdgeId,
        setCollapsed: vi.fn()
      })
    );

    const handled = result.current.handleDeleteSelection();

    expect(handled).toBe(false);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy).toHaveBeenCalledWith(
      "Delete 2 nodes? This also removes their descendants.\n\n"
      + "This selection includes 1 original node that still has a mirror; that mirror will become the primary copy."
    );
    expect(setSelectedEdgeId).not.toHaveBeenCalled();

    confirmSpy.mockRestore();
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

  it("invokes the append callback when inserting a child edge", () => {
    const outline = createOutlineDoc();
    const { rows, edgeIndexMap, siblingEdgeIds } = createRows(outline);

    const setSelectionRange = vi.fn();
    const setSelectedEdgeId = vi.fn();
    const onAppendEdge = vi.fn();

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
        setCollapsed: vi.fn(),
        onAppendEdge
      })
    );

    act(() => {
      const handled = result.current.handleCommand("outline.insertChild");
      expect(handled).toBe(true);
    });

    expect(onAppendEdge).toHaveBeenCalledTimes(1);
  });

  it("retains mirror edge instances when updating the active selection", () => {
    const { outline, rows, edgeIndexMap, mirrorChildEdgeId, canonicalChildEdgeId } = createMirrorSelectionFixture();

    const setSelectionRange = vi.fn();
    const setSelectedEdgeId = vi.fn();

    const { result } = renderHook(() =>
      useOutlineSelection({
        rows,
        edgeIndexMap,
        paneSelectionRange: undefined,
        selectedEdgeId: mirrorChildEdgeId,
        outline,
        localOrigin: TEST_ORIGIN,
        setSelectionRange,
        setSelectedEdgeId,
        setCollapsed: vi.fn()
      })
    );

    expect(result.current.selectedRow?.edgeId).toBe(mirrorChildEdgeId);
    expect(result.current.selectionAdapter.getPrimaryEdgeId()).toBe(canonicalChildEdgeId);
    expect(result.current.selectionAdapter.getOrderedEdgeIds()).toEqual([canonicalChildEdgeId]);

    act(() => {
      result.current.selectionAdapter.setPrimaryEdgeId(mirrorChildEdgeId);
    });

    const lastSelectionCall = setSelectedEdgeId.mock.calls.at(-1);
    expect(lastSelectionCall?.[0]).toBe(mirrorChildEdgeId);
    expect(lastSelectionCall?.[1]).toBeUndefined();
  });
});
