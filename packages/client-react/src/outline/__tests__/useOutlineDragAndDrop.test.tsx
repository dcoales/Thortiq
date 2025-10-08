import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  MutableRefObject,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent
} from "react";

import {
  addEdge,
  buildPaneRows,
  createOutlineDoc,
  createOutlineSnapshot,
  type EdgeId,
  type NodeId
} from "@thortiq/client-core";

import { useOutlineDragAndDrop } from "../useOutlineDragAndDrop";
import type { OutlinePendingCursor } from "../useOutlineDragAndDrop";
import type { OutlineRow } from "../useOutlineRows";
import type { SessionPaneState } from "@thortiq/sync-core";
import { defaultPaneSearchState } from "@thortiq/sync-core";

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
    collapsed: row.collapsed,
    parentNodeId: row.parentNodeId,
    hasChildren: row.hasChildren,
    ancestorEdgeIds: row.ancestorEdgeIds,
    ancestorNodeIds: row.ancestorNodeIds,
    mirrorOfNodeId: row.edge.mirrorOfNodeId,
    mirrorCount: 0
  }));

  const rowMap = new Map<EdgeId, OutlineRow>();
  rows.forEach((row) => {
    rowMap.set(row.edgeId, row);
    if (!rowMap.has(row.canonicalEdgeId)) {
      rowMap.set(row.canonicalEdgeId, row);
    }
  });

  const edgeIndexMap = new Map<EdgeId, number>();
  rows.forEach((row, index) => {
    edgeIndexMap.set(row.edgeId, index);
    if (!edgeIndexMap.has(row.canonicalEdgeId)) {
      edgeIndexMap.set(row.canonicalEdgeId, index);
    }
  });
  const pane: SessionPaneState = {
    paneId: "outline",
    rootEdgeId,
    activeEdgeId: childEdgeA,
    collapsedEdgeIds: [],
    pendingFocusEdgeId: null,
    focusPathEdgeIds: undefined,
    focusHistory: [{ rootEdgeId: null }],
    focusHistoryIndex: 0,
    selectionRange: undefined,
    search: defaultPaneSearchState()
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

const dispatchPointerEvent = (type: string, init: PointerEventInit & { readonly pointerId: number }) => {
  const eventInit: PointerEventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    pointerType: "mouse",
    ...init
  } satisfies PointerEventInit;
  if (typeof window.PointerEvent === "function") {
    const event = new window.PointerEvent(type, eventInit);
    window.dispatchEvent(event);
    return;
  }
  const fallback = new Event(type, { bubbles: true, cancelable: true }) as unknown as PointerEvent & {
    pointerId?: number;
    clientX?: number;
    clientY?: number;
    altKey?: boolean;
  };
  fallback.pointerId = init.pointerId;
  fallback.clientX = init.clientX ?? 0;
  fallback.clientY = init.clientY ?? 0;
  fallback.altKey = Boolean(init.altKey);
  window.dispatchEvent(fallback as PointerEvent);
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

  it("creates a mirror when the drag finishes with the Alt key pressed", () => {
    const fixture = createFixture();
    const setSelectionRange = vi.fn();
    const setSelectedEdgeId = vi.fn();
    const setPendingCursor = vi.fn();
    const setPendingFocusEdgeId = vi.fn();
    const setCollapsed = vi.fn();

    const container = document.createElement("div");
    container.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      right: 320,
      bottom: 200,
      width: 320,
      height: 200,
      x: 0,
      y: 0,
      toJSON() {
        return {};
      }
    });
    const parentRef = { current: container } as MutableRefObject<HTMLDivElement | null>;

    const childEdgeA = fixture.orderedSelectedEdgeIds[0]!;
    const hoveredEdgeId = fixture.rows[2]!.edgeId;

    const rowElement = document.createElement("div");
    rowElement.dataset.outlineRow = "true";
    rowElement.dataset.edgeId = hoveredEdgeId;
    rowElement.getBoundingClientRect = () => ({
      left: 0,
      top: 20,
      right: 320,
      bottom: 52,
      width: 320,
      height: 32,
      x: 0,
      y: 20,
      toJSON() {
        return {};
      }
    });
    const bulletElement = document.createElement("div");
    bulletElement.setAttribute("data-outline-bullet", "true");
    bulletElement.getBoundingClientRect = () => ({
      left: 48,
      top: 24,
      right: 60,
      bottom: 44,
      width: 12,
      height: 20,
      x: 48,
      y: 24,
      toJSON() {
        return {};
      }
    });
    rowElement.append(bulletElement);
    container.append(rowElement);
    document.body.append(container);

    const originalElementFromPoint = document.elementFromPoint;
    const elementFromPointStub = vi.fn().mockReturnValue(rowElement);
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: elementFromPointStub
    });

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

    const pointerEvent = {
      isPrimary: true,
      button: 0,
      pointerId: 11,
      clientX: 16,
      clientY: 16,
      altKey: true,
      stopPropagation: vi.fn()
    } as unknown as ReactPointerEvent<HTMLButtonElement>;

    act(() => {
      result.current.handleDragHandlePointerDown(pointerEvent, childEdgeA);
    });

    act(() => {
      dispatchPointerEvent("pointermove", { pointerId: 11, clientX: 120, clientY: 32, altKey: true });
    });

    expect(result.current.activeDrag?.plan).not.toBeNull();

    act(() => {
      dispatchPointerEvent("pointerup", { pointerId: 11, clientX: 120, clientY: 32, altKey: true });
    });

    if (originalElementFromPoint) {
      Object.defineProperty(document, "elementFromPoint", {
        configurable: true,
        value: originalElementFromPoint
      });
    } else {
      Reflect.deleteProperty(document as unknown as Record<string, unknown>, "elementFromPoint");
    }

    const updatedSnapshot = createOutlineSnapshot(fixture.outlineDoc);
    const parentNodeId = updatedSnapshot.edges.get(childEdgeA)?.parentNodeId ?? null;
    expect(parentNodeId).not.toBeNull();
    const originalChildren = fixture.snapshot.childrenByParent.get(parentNodeId!) ?? [];
    const children = updatedSnapshot.childrenByParent.get(parentNodeId!) ?? [];
    expect(children.length).toBe(originalChildren.length + 1);
    const newEdgeId = children.find((edgeId) => !originalChildren.includes(edgeId));
    expect(newEdgeId).toBeDefined();
    const newEdge = newEdgeId ? updatedSnapshot.edges.get(newEdgeId) : null;
    const sourceNodeId = updatedSnapshot.edges.get(childEdgeA)?.childNodeId;
    expect(newEdge?.mirrorOfNodeId).toBe(sourceNodeId);
    expect(newEdge?.childNodeId).toBe(sourceNodeId);
  });

  it("preserves edge order when mirroring a contiguous selection", () => {
    const fixture = createFixture();
    const rootEdgeId = fixture.rows[0]!.edgeId;
    const childEdgeA = fixture.rows[1]!.edgeId;
    const childEdgeB = fixture.rows[2]!.edgeId;

    const multiSelectedIds = new Set<EdgeId>([childEdgeA, childEdgeB]);
    const orderedSelectedEdgeIds: readonly EdgeId[] = [childEdgeA, childEdgeB];

    const setSelectionRange = vi.fn();
    const setSelectedEdgeId = vi.fn();
    const setPendingCursor = vi.fn();
    const setPendingFocusEdgeId = vi.fn();
    const setCollapsed = vi.fn();

    const container = document.createElement("div");
    container.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      right: 320,
      bottom: 200,
      width: 320,
      height: 200,
      x: 0,
      y: 0,
      toJSON() {
        return {};
      }
    });
    const parentRef = { current: container } as MutableRefObject<HTMLDivElement | null>;

    const rootRowElement = document.createElement("div");
    rootRowElement.dataset.outlineRow = "true";
    rootRowElement.dataset.edgeId = rootEdgeId;
    rootRowElement.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      right: 320,
      bottom: 32,
      width: 320,
      height: 32,
      x: 0,
      y: 0,
      toJSON() {
        return {};
      }
    });
    const rootTextCell = document.createElement("div");
    rootTextCell.setAttribute("data-outline-text-cell", "true");
    rootTextCell.getBoundingClientRect = () => ({
      left: 96,
      top: 4,
      right: 280,
      bottom: 28,
      width: 184,
      height: 24,
      x: 96,
      y: 4,
      toJSON() {
        return {};
      }
    });
    rootRowElement.append(rootTextCell);
    container.append(rootRowElement);
    document.body.append(container);

    const originalElementFromPoint = document.elementFromPoint;
    const elementFromPointStub = vi.fn().mockReturnValue(rootRowElement);
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: elementFromPointStub
    });

    const { result } = renderHook(() =>
      useOutlineDragAndDrop({
        outline: fixture.outlineDoc,
        localOrigin: TEST_ORIGIN,
        snapshot: fixture.snapshot,
        rowMap: fixture.rowMap,
        edgeIndexMap: fixture.edgeIndexMap,
        orderedSelectedEdgeIds,
        selectedEdgeIds: multiSelectedIds,
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

    const pointerEvent = {
      isPrimary: true,
      button: 0,
      pointerId: 21,
      clientX: 24,
      clientY: 24,
      altKey: true,
      stopPropagation: vi.fn()
    } as unknown as ReactPointerEvent<HTMLButtonElement>;

    act(() => {
      result.current.handleDragHandlePointerDown(pointerEvent, childEdgeA);
    });

    act(() => {
      dispatchPointerEvent("pointermove", { pointerId: 21, clientX: 140, clientY: 12, altKey: true });
    });

    act(() => {
      dispatchPointerEvent("pointerup", { pointerId: 21, clientX: 140, clientY: 12, altKey: true });
    });

    if (originalElementFromPoint) {
      Object.defineProperty(document, "elementFromPoint", {
        configurable: true,
        value: originalElementFromPoint
      });
    } else {
      Reflect.deleteProperty(document as unknown as Record<string, unknown>, "elementFromPoint");
    }

    const updatedSnapshot = createOutlineSnapshot(fixture.outlineDoc);
    const rootNodeId = updatedSnapshot.edges.get(rootEdgeId)?.childNodeId ?? null;
    expect(rootNodeId).not.toBeNull();
    const children = updatedSnapshot.childrenByParent.get(rootNodeId!);
    expect(children).toBeDefined();
    const originalChildren = fixture.snapshot.childrenByParent.get(rootNodeId!) ?? [];
    const newEdges = (children ?? []).filter((edgeId) => !originalChildren.includes(edgeId));
    expect(newEdges).toHaveLength(2);
    const [firstNew, secondNew] = newEdges;
    const firstSnapshot = updatedSnapshot.edges.get(firstNew!);
    const secondSnapshot = updatedSnapshot.edges.get(secondNew!);
    const nodeA = updatedSnapshot.edges.get(childEdgeA)?.childNodeId;
    const nodeB = updatedSnapshot.edges.get(childEdgeB)?.childNodeId;
    expect(firstSnapshot?.childNodeId).toBe(nodeA);
    expect(firstSnapshot?.mirrorOfNodeId).toBe(nodeA);
    expect(secondSnapshot?.childNodeId).toBe(nodeB);
    expect(secondSnapshot?.mirrorOfNodeId).toBe(nodeB);
    expect((children ?? []).indexOf(firstNew!)).toBeLessThan((children ?? []).indexOf(secondNew!));
  });
});
