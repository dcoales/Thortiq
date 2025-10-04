import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  MutableRefObject,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent
} from "react";

import {
  addEdge,
  createOutlineDoc,
  createOutlineSnapshot,
  type EdgeId,
  type NodeId
} from "@thortiq/client-core";

import { useOutlineDragAndDrop } from "../useOutlineDragAndDrop";
import type { OutlinePendingCursor } from "../useOutlineDragAndDrop";
import type { OutlineRow } from "../useOutlineRows";
import type { SessionPaneState } from "@thortiq/sync-core";

const TEST_ORIGIN = { scope: "useOutlineDragAndDrop-test" } as const;

type OutlineFixture = {
  readonly pane: SessionPaneState;
  readonly rows: OutlineRow[];
  readonly rowMap: ReadonlyMap<EdgeId, OutlineRow>;
  readonly edgeIndexMap: ReadonlyMap<EdgeId, number>;
  readonly orderedSelectedEdgeIds: readonly EdgeId[];
  readonly selectedEdgeIds: ReadonlySet<EdgeId>;
  readonly selectedEdgeId: EdgeId;
  readonly outlineDoc: ReturnType<typeof createOutlineDoc>;
  readonly snapshot: ReturnType<typeof createOutlineSnapshot>;
};

const createFixture = (): OutlineFixture => {
  const outline = createOutlineDoc();
  const rootNodeId = addEdge(outline, {
    parentNodeId: null,
    origin: TEST_ORIGIN
  }).nodeId;
  const rootEdgeId = outline.rootEdges.toArray()[0] as EdgeId;

  addEdge(outline, {
    parentNodeId: rootNodeId as NodeId,
    origin: TEST_ORIGIN
  });
  addEdge(outline, {
    parentNodeId: rootNodeId as NodeId,
    origin: TEST_ORIGIN
  });

  const snapshot = createOutlineSnapshot(outline);
  const rootEdge = snapshot.edges.get(rootEdgeId)!;
  const childEdgeA = snapshot.childrenByParent.get(rootEdge.childNodeId)![0]!;
  const childEdgeB = snapshot.childrenByParent.get(rootEdge.childNodeId)![1]!;

  const rows: OutlineRow[] = [rootEdgeId, childEdgeA, childEdgeB].map((edgeId, index) => {
    const edge = snapshot.edges.get(edgeId)!;
    const node = snapshot.nodes.get(edge.childNodeId)!;
    const depth = index === 0 ? 0 : 1;
    return {
      edgeId,
      nodeId: node.id,
      depth,
      treeDepth: depth,
      text: node.text,
      inlineContent: node.inlineContent,
      metadata: node.metadata,
      collapsed: edge.collapsed,
      parentNodeId: edge.parentNodeId,
      hasChildren: snapshot.childrenByParent.get(node.id)?.length ? true : false,
      ancestorEdgeIds: depth === 0 ? [] : [rootEdgeId],
      ancestorNodeIds: depth === 0 ? [] : [rootEdge.childNodeId]
    } satisfies OutlineRow;
  });

  const rowMap = new Map<EdgeId, OutlineRow>(rows.map((row) => [row.edgeId, row]));
  const edgeIndexMap = new Map<EdgeId, number>(rows.map((row, index) => [row.edgeId, index]));
  const pane: SessionPaneState = {
    paneId: "outline",
    rootEdgeId,
    activeEdgeId: childEdgeA,
    collapsedEdgeIds: [],
    pendingFocusEdgeId: null,
    quickFilter: undefined,
    focusPathEdgeIds: undefined,
    focusHistory: [{ rootEdgeId: null }],
    focusHistoryIndex: 0,
    selectionRange: undefined
  };

  return {
    pane,
    rows,
    rowMap,
    edgeIndexMap,
    orderedSelectedEdgeIds: [childEdgeA],
    selectedEdgeIds: new Set<EdgeId>([childEdgeA]),
    selectedEdgeId: childEdgeA,
    outlineDoc: outline,
    snapshot
  } satisfies OutlineFixture;
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useOutlineDragAndDrop", () => {
  it("collapses and expands guideline edges using the provided plan", () => {
    const fixture = createFixture();
    const setSelectionRange = vi.fn();
    const setSelectedEdgeId = vi.fn();
    const setPendingCursor = vi.fn();
    const setPendingFocusEdgeId = vi.fn();
    const setCollapsed = vi.fn();
    const computeGuidelinePlan = vi
      .fn()
      .mockReturnValue({ toCollapse: [fixture.selectedEdgeId], toExpand: [] });

    const parentRef = { current: document.createElement("div") } as MutableRefObject<HTMLDivElement | null>;

    const { result } = renderHook(() =>
      useOutlineDragAndDrop({
        outline: fixture.outlineDoc,
        localOrigin: TEST_ORIGIN,
        snapshot: fixture.snapshot,
        rowMap: fixture.rowMap,
        edgeIndexMap: fixture.edgeIndexMap,
        orderedSelectedEdgeIds: fixture.orderedSelectedEdgeIds,
        selectedEdgeIds: fixture.selectedEdgeIds,
        selectionRange: null,
        setSelectionRange,
        setSelectedEdgeId,
        setPendingCursor,
        setPendingFocusEdgeId,
        setCollapsed,
        isEditorEvent: () => false,
        parentRef,
        computeGuidelinePlan
      })
    );

    act(() => {
      result.current.handleGuidelineClick(fixture.selectedEdgeId);
    });

    expect(computeGuidelinePlan).toHaveBeenCalledWith(fixture.selectedEdgeId);
    expect(setCollapsed).toHaveBeenCalledWith(fixture.selectedEdgeId, true);
  });

  it("requests a trailing text cursor when clicking inside the text cell gutter", () => {
    const fixture = createFixture();
    const setSelectionRange = vi.fn();
    const setSelectedEdgeId = vi.fn();
    const setPendingCursor = vi.fn();
    const setPendingFocusEdgeId = vi.fn();
    const setCollapsed = vi.fn();

    const container = document.createElement("div");
    const rowElement = document.createElement("div");
    rowElement.dataset.outlineRow = "true";
    rowElement.dataset.edgeId = fixture.selectedEdgeId;
    const textCell = document.createElement("div");
    textCell.setAttribute("data-outline-text-cell", "true");
    const textContent = document.createElement("span");
    textContent.setAttribute("data-outline-text-content", "true");
    textContent.getBoundingClientRect = () => ({
      left: 0,
      right: 40,
      top: 0,
      bottom: 10,
      width: 40,
      height: 10,
      x: 0,
      y: 0,
      toJSON() {
        return {};
      }
    });
    textCell.append(textContent);
    rowElement.append(textCell);
    container.append(rowElement);
    document.body.append(container);

    const parentRef = { current: container } as MutableRefObject<HTMLDivElement | null>;

    const { result } = renderHook(() =>
      useOutlineDragAndDrop({
        outline: fixture.outlineDoc,
        localOrigin: TEST_ORIGIN,
        snapshot: fixture.snapshot,
        rowMap: fixture.rowMap,
        edgeIndexMap: fixture.edgeIndexMap,
        orderedSelectedEdgeIds: fixture.orderedSelectedEdgeIds,
        selectedEdgeIds: fixture.selectedEdgeIds,
        selectionRange: null,
        setSelectionRange,
        setSelectedEdgeId,
        setPendingCursor,
        setPendingFocusEdgeId,
        setCollapsed,
        isEditorEvent: () => false,
        parentRef,
        computeGuidelinePlan: () => null
      })
    );

    const preventDefault = vi.fn();
    const event = {
      target: textCell,
      clientX: 60,
      clientY: 4,
      preventDefault
    } as unknown as ReactMouseEvent<HTMLDivElement>;

    act(() => {
      result.current.handleRowMouseDown(event, fixture.selectedEdgeId);
    });

    expect(preventDefault).toHaveBeenCalled();
    const pendingCursor = setPendingCursor.mock.calls.at(-1)?.[0] as OutlinePendingCursor | undefined;
    expect(pendingCursor).toEqual({ edgeId: fixture.selectedEdgeId, placement: "text-end" });
    expect(setPendingFocusEdgeId).toHaveBeenCalledWith(fixture.selectedEdgeId);
    expect(setSelectedEdgeId).toHaveBeenCalledWith(fixture.selectedEdgeId);
  });

  it("clears selection and reselects the requested edge on pointer capture", () => {
    const fixture = createFixture();
    const setSelectionRange = vi.fn();
    const setSelectedEdgeId = vi.fn();
    const setPendingCursor = vi.fn();
    const setPendingFocusEdgeId = vi.fn();
    const setCollapsed = vi.fn();

    const parentRef = { current: document.createElement("div") } as MutableRefObject<HTMLDivElement | null>;

    const { result } = renderHook(() =>
      useOutlineDragAndDrop({
        outline: fixture.outlineDoc,
        localOrigin: TEST_ORIGIN,
        snapshot: fixture.snapshot,
        rowMap: fixture.rowMap,
        edgeIndexMap: fixture.edgeIndexMap,
        orderedSelectedEdgeIds: fixture.orderedSelectedEdgeIds,
        selectedEdgeIds: fixture.selectedEdgeIds,
        selectionRange: null,
        setSelectionRange,
        setSelectedEdgeId,
        setPendingCursor,
        setPendingFocusEdgeId,
        setCollapsed,
        isEditorEvent: () => false,
        parentRef,
        computeGuidelinePlan: () => null
      })
    );

    const event = {
      isPrimary: true,
      button: 0,
      pointerId: 7,
      target: null
    } as unknown as ReactPointerEvent<HTMLDivElement>;

    act(() => {
      result.current.handleRowPointerDownCapture(event, fixture.selectedEdgeId);
    });

    expect(setSelectionRange).toHaveBeenCalledWith(null);
    expect(setSelectedEdgeId).toHaveBeenCalledWith(fixture.selectedEdgeId);
  });
});
