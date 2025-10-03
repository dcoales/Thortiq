import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  CSSProperties,
  KeyboardEvent,
  MouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import {
  useOutlinePaneState,
  useOutlineSessionStore,
  useOutlineSnapshot,
  useOutlinePresence,
  useSyncContext,
  useAwarenessIndicatorsEnabled,
  useSyncDebugLoggingEnabled,
  type OutlinePresenceParticipant
} from "./OutlineProvider";
import { ActiveNodeEditor, type PendingCursorRequest } from "./ActiveNodeEditor";
import type { OutlineSelectionAdapter, OutlineCursorPlacement } from "@thortiq/editor-prosemirror";
import {
  indentEdges,
  insertChild,
  insertRootNode,
  insertSiblingBelow,
  outdentEdges,
  createDeleteEdgesPlan,
  deleteEdges
} from "@thortiq/outline-commands";
import {
  buildPaneRows,
  planBreadcrumbVisibility,
  type BreadcrumbDisplayPlan,
  type PaneFocusContext
} from "@thortiq/client-core";
import type { EdgeId, NodeId } from "@thortiq/client-core";
import {
  clearPaneFocus,
  focusPaneEdge,
  type FocusPanePayload,
  type SessionPaneState,
  type SessionState
} from "@thortiq/sync-core";

const ESTIMATED_ROW_HEIGHT = 32;
const ROW_INDENT_PX = 18;
const BASE_ROW_PADDING_PX = 12;
const CONTAINER_HEIGHT = 480;
const FIRST_LINE_CENTER_OFFSET_REM = 0.75; // 1.5 line-height * 0.5 with 1rem font size
const BULLET_DIAMETER_REM = 1.2;
const BULLET_RADIUS_REM = BULLET_DIAMETER_REM / 2;
const BULLET_TOP_OFFSET_REM = FIRST_LINE_CENTER_OFFSET_REM - BULLET_RADIUS_REM;
const CARET_HEIGHT_REM = 0.9;
const TOGGLE_CONTAINER_DIAMETER_REM = BULLET_DIAMETER_REM;
const NEW_NODE_BUTTON_DIAMETER_REM = 2.25;

type PendingCursor = PendingCursorRequest & { readonly edgeId: EdgeId };

interface SelectionRange {
  readonly anchorEdgeId: EdgeId;
  readonly focusEdgeId: EdgeId;
}

interface DragSelectionState {
  readonly pointerId: number;
  readonly anchorEdgeId: EdgeId;
}

const EMPTY_PRESENCE: readonly OutlinePresenceParticipant[] = [];
const EMPTY_PRESENCE_MAP: ReadonlyMap<EdgeId, readonly OutlinePresenceParticipant[]> = new Map();

const shouldRenderTestFallback = (): boolean => {
  if (import.meta.env?.MODE !== "test") {
    return false;
  }
  const globals = globalThis as {
    __THORTIQ_PROSEMIRROR_TEST__?: boolean;
    __THORTIQ_OUTLINE_VIRTUAL_FALLBACK__?: boolean;
  };
  if (globals.__THORTIQ_OUTLINE_VIRTUAL_FALLBACK__) {
    return true;
  }
  return !globals.__THORTIQ_PROSEMIRROR_TEST__;
};

type OutlineRow = {
  readonly edgeId: EdgeId;
  readonly nodeId: NodeId;
  readonly depth: number;
  readonly treeDepth: number;
  readonly text: string;
  readonly collapsed: boolean;
  readonly parentNodeId: NodeId | null;
  readonly hasChildren: boolean;
  readonly ancestorEdgeIds: ReadonlyArray<EdgeId>;
  readonly ancestorNodeIds: ReadonlyArray<NodeId>;
};

interface OutlineViewProps {
  readonly paneId: string;
}

export const OutlineView = ({ paneId }: OutlineViewProps): JSX.Element => {
  const isTestFallback = shouldRenderTestFallback();
  const prosemirrorTestsEnabled = Boolean(
    (globalThis as { __THORTIQ_PROSEMIRROR_TEST__?: boolean }).__THORTIQ_PROSEMIRROR_TEST__
  );
  const snapshot = useOutlineSnapshot();
  const pane = useOutlinePaneState(paneId);
  const awarenessIndicatorsEnabled = useAwarenessIndicatorsEnabled();
  const presence = useOutlinePresence();
  const presenceByEdgeId = awarenessIndicatorsEnabled ? presence.byEdgeId : EMPTY_PRESENCE_MAP;
  const { outline, localOrigin } = useSyncContext();
  const sessionStore = useOutlineSessionStore();
  const syncDebugLoggingEnabled = useSyncDebugLoggingEnabled();
  const parentRef = useRef<HTMLDivElement | null>(null);
  // Track whether the selection should render with the prominent highlight.
  const [showSelectionHighlight, setShowSelectionHighlight] = useState(true);
  const [pendingCursor, setPendingCursor] = useState<PendingCursor | null>(null);
  const [activeTextCell, setActiveTextCell] = useState<
    { edgeId: EdgeId; element: HTMLDivElement }
  | null>(null);
  const [dragSelection, setDragSelection] = useState<DragSelectionState | null>(null);

  if (!pane) {
    throw new Error(`Pane ${paneId} not found in session state`);
  }
  const paneSelectionRange = pane.selectionRange;
  const selectionRange = useMemo<SelectionRange | null>(() => {
    const range = paneSelectionRange;
    if (!range) {
      return null;
    }
    return {
      anchorEdgeId: range.anchorEdgeId,
      focusEdgeId: range.headEdgeId
    } satisfies SelectionRange;
  }, [paneSelectionRange]);
  const selectedEdgeId = pane.activeEdgeId;

  const paneRowsResult = useMemo(
    () =>
      buildPaneRows(snapshot, {
        rootEdgeId: pane.rootEdgeId,
        collapsedEdgeIds: pane.collapsedEdgeIds,
        quickFilter: pane.quickFilter,
        focusPathEdgeIds: pane.focusPathEdgeIds
      }),
    [pane.collapsedEdgeIds, pane.focusPathEdgeIds, pane.quickFilter, pane.rootEdgeId, snapshot]
  );

  const focusContext = paneRowsResult.focus ?? null;

  const rows = useMemo<OutlineRow[]>(
    () =>
      paneRowsResult.rows.map((row) => ({
        edgeId: row.edge.id,
        nodeId: row.node.id,
        depth: row.depth,
        treeDepth: row.treeDepth,
        text: row.node.text,
        collapsed: row.collapsed,
        parentNodeId: row.parentNodeId,
        hasChildren: row.hasChildren,
        ancestorEdgeIds: row.ancestorEdgeIds,
        ancestorNodeIds: row.ancestorNodeIds
      })),
    [paneRowsResult.rows]
  );

  const setPaneSelectionRange = useCallback(
    (range: SelectionRange | null) => {
      sessionStore.update((state) => {
        const index = state.panes.findIndex((paneState) => paneState.paneId === paneId);
        if (index === -1) {
          return state;
        }
        const paneState = state.panes[index];
        const nextPane: SessionPaneState =
          range === null
            ? (paneState.selectionRange === undefined ? paneState : { ...paneState, selectionRange: undefined })
            : {
                ...paneState,
                selectionRange: {
                  anchorEdgeId: range.anchorEdgeId,
                  headEdgeId: range.focusEdgeId
                }
              };
        if (nextPane === paneState && state.activePaneId === paneId) {
          return state;
        }
        const panes = nextPane === paneState
          ? state.panes
          : state.panes.map((current, candidateIndex) => (candidateIndex === index ? nextPane : current));
        if (state.activePaneId === paneId && panes === state.panes) {
          return state;
        }
        return {
          ...state,
          panes,
          activePaneId: paneId
        } satisfies SessionState;
      });
    },
    [paneId, sessionStore]
  );

  const setPaneActiveEdge = useCallback(
    (edgeId: EdgeId | null, { preserveRange = false }: { preserveRange?: boolean } = {}) => {
      sessionStore.update((state) => {
        const index = state.panes.findIndex((paneState) => paneState.paneId === paneId);
        if (index === -1) {
          return state;
        }
        const paneState = state.panes[index];
        let nextPane: SessionPaneState;
        if (preserveRange) {
          nextPane = paneState.activeEdgeId === edgeId ? paneState : { ...paneState, activeEdgeId: edgeId };
        } else if (paneState.activeEdgeId === edgeId && paneState.selectionRange === undefined) {
          nextPane = paneState;
        } else {
          nextPane = { ...paneState, activeEdgeId: edgeId, selectionRange: undefined };
        }
        const nextSelectedEdgeId = edgeId ?? null;
        if (
          nextPane === paneState
          && state.activePaneId === paneId
          && state.selectedEdgeId === nextSelectedEdgeId
        ) {
          return state;
        }
        const panes = nextPane === paneState
          ? state.panes
          : state.panes.map((current, candidateIndex) => (candidateIndex === index ? nextPane : current));
        return {
          ...state,
          panes,
          activePaneId: paneId,
          selectedEdgeId: nextSelectedEdgeId
        } satisfies SessionState;
      });
    },
    [paneId, sessionStore]
  );

  const setPaneCollapsed = useCallback(
    (edgeId: EdgeId, collapsed: boolean) => {
      sessionStore.update((state) => {
        const index = state.panes.findIndex((paneState) => paneState.paneId === paneId);
        if (index === -1) {
          return state;
        }
        const paneState = state.panes[index];
        const hasEdge = paneState.collapsedEdgeIds.includes(edgeId);
        if ((collapsed && hasEdge) || (!collapsed && !hasEdge)) {
          if (state.activePaneId === paneId) {
            return state;
          }
          return {
            ...state,
            activePaneId: paneId
          } satisfies SessionState;
        }
        const collapsedEdgeIds = collapsed
          ? [...paneState.collapsedEdgeIds, edgeId]
          : paneState.collapsedEdgeIds.filter((candidate) => candidate !== edgeId);
        const nextPane: SessionPaneState = {
          ...paneState,
          collapsedEdgeIds
        };
        const panes = state.panes.map((current, candidateIndex) =>
          candidateIndex === index ? nextPane : current
        );
        return {
          ...state,
          panes,
          activePaneId: paneId
        } satisfies SessionState;
      });
    },
    [paneId, sessionStore]
  );

  const setPanePendingFocusEdgeId = useCallback(
    (edgeId: EdgeId | null) => {
      sessionStore.update((state) => {
        const index = state.panes.findIndex((paneState) => paneState.paneId === paneId);
        if (index === -1) {
          return state;
        }
        const paneState = state.panes[index];
        if (paneState.pendingFocusEdgeId === edgeId && state.activePaneId === paneId) {
          return state;
        }
        const nextPane: SessionPaneState = paneState.pendingFocusEdgeId === edgeId
          ? paneState
          : { ...paneState, pendingFocusEdgeId: edgeId };
        if (nextPane === paneState && state.activePaneId === paneId) {
          return state;
        }
        const panes = nextPane === paneState
          ? state.panes
          : state.panes.map((current, candidateIndex) => (candidateIndex === index ? nextPane : current));
        return {
          ...state,
          panes,
          activePaneId: paneId
        } satisfies SessionState;
      });
    },
    [paneId, sessionStore]
  );

  const setSelectedEdgeId = useCallback(
    (
      edgeId: EdgeId | null,
      options: { preserveRange?: boolean; cursor?: OutlineCursorPlacement } = {}
    ) => {
      if (!options.preserveRange) {
        setPaneSelectionRange(null);
      }
      setShowSelectionHighlight(true);
      if (edgeId && options.cursor) {
        let pendingRequest: PendingCursorRequest;
        if (options.cursor === "end") {
          pendingRequest = { placement: "text-end" };
        } else if (options.cursor === "start") {
          pendingRequest = { placement: "text-start" };
        } else {
          pendingRequest = { placement: "text-offset", index: options.cursor.index };
        }
        setPendingCursor({ edgeId, ...pendingRequest });
        setPanePendingFocusEdgeId(edgeId);
      } else if (!edgeId && options.cursor) {
        setPendingCursor(null);
        setPanePendingFocusEdgeId(null);
      }
      setPaneActiveEdge(edgeId, { preserveRange: options.preserveRange });
    },
    [
      setPaneActiveEdge,
      setPanePendingFocusEdgeId,
      setPaneSelectionRange,
      setPendingCursor,
      setShowSelectionHighlight
    ]
  );

  const handleFocusEdge = useCallback(
    (payload: FocusPanePayload) => {
      focusPaneEdge(sessionStore, paneId, payload);
      const edgeSnapshot = snapshot.edges.get(payload.edgeId);
      if (!edgeSnapshot) {
        return;
      }
      const childEdgeIds = snapshot.childrenByParent.get(edgeSnapshot.childNodeId) ?? [];
      if (childEdgeIds.length > 0) {
        setSelectedEdgeId(childEdgeIds[0]);
      } else {
        setSelectedEdgeId(null);
      }
    },
    [paneId, sessionStore, setSelectedEdgeId, snapshot]
  );

  const handleClearFocus = useCallback(() => {
    const focusedEdgeId = pane.rootEdgeId;
    clearPaneFocus(sessionStore, paneId);
    if (focusedEdgeId) {
      setSelectedEdgeId(focusedEdgeId);
    }
  }, [pane.rootEdgeId, paneId, sessionStore, setSelectedEdgeId]);

  const edgeIndexMap = useMemo(() => {
    const map = new Map<EdgeId, number>();
    rows.forEach((row, index) => {
      map.set(row.edgeId, index);
    });
    return map;
  }, [rows]);

  const selectedEdgeIds = useMemo(() => {
    if (selectionRange) {
      const anchorIndex = edgeIndexMap.get(selectionRange.anchorEdgeId);
      const focusIndex = edgeIndexMap.get(selectionRange.focusEdgeId);
      if (anchorIndex !== undefined && focusIndex !== undefined) {
        const start = Math.min(anchorIndex, focusIndex);
        const end = Math.max(anchorIndex, focusIndex);
        const selection = new Set<EdgeId>();
        for (let index = start; index <= end; index += 1) {
          const row = rows[index];
          if (row) {
            selection.add(row.edgeId);
          }
        }
        return selection;
      }
    }
    return selectedEdgeId ? new Set<EdgeId>([selectedEdgeId]) : new Set<EdgeId>();
  }, [edgeIndexMap, rows, selectedEdgeId, selectionRange]);

  const orderedSelectedEdgeIds = useMemo(() => {
    if (selectedEdgeIds.size === 0) {
      return [] as EdgeId[];
    }
    return rows
      .filter((row) => selectedEdgeIds.has(row.edgeId))
      .map((row) => row.edgeId);
  }, [rows, selectedEdgeIds]);

  const selectedIndex = useMemo(() => {
    if (!selectedEdgeId) {
      return -1;
    }
    return rows.findIndex((row) => row.edgeId === selectedEdgeId);
  }, [rows, selectedEdgeId]);

  const selectedRow = selectedIndex >= 0 ? rows[selectedIndex] : null;

  const activeRowSummary = useMemo(() => {
    if (!selectedRow) {
      return null;
    }
    const baseDepth = selectedRow.treeDepth;
    let visibleChildCount = 0;
    for (let index = selectedIndex + 1; index < rows.length; index += 1) {
      const candidate = rows[index];
      if (!candidate) {
        break;
      }
      if (candidate.treeDepth <= baseDepth) {
        break;
      }
      if (candidate.treeDepth === baseDepth + 1) {
        visibleChildCount += 1;
      }
    }
    return {
      hasChildren: selectedRow.hasChildren,
      collapsed: selectedRow.collapsed,
      visibleChildCount
    };
  }, [rows, selectedIndex, selectedRow]);

  const selectionSnapshotRef = useRef({
    primaryEdgeId: selectedEdgeId,
    orderedEdgeIds: orderedSelectedEdgeIds as readonly EdgeId[]
  });

  useEffect(() => {
    selectionSnapshotRef.current = {
      primaryEdgeId: selectedEdgeId,
      orderedEdgeIds: orderedSelectedEdgeIds
    };
  }, [orderedSelectedEdgeIds, selectedEdgeId]);

  useEffect(() => {
    if (!selectedEdgeId) {
      setActiveTextCell(null);
      if (selectionRange) {
        setPaneSelectionRange(null);
      }
    }
  }, [selectedEdgeId, selectionRange, setPaneSelectionRange]);

  useEffect(() => {
    if (!selectionRange) {
      return;
    }
    if (
      !edgeIndexMap.has(selectionRange.anchorEdgeId)
      || !edgeIndexMap.has(selectionRange.focusEdgeId)
    ) {
      setPaneSelectionRange(null);
    }
  }, [edgeIndexMap, selectionRange, setPaneSelectionRange]);

  useEffect(() => {
    if (!syncDebugLoggingEnabled) {
      return;
    }
    if (typeof console === "undefined") {
      return;
    }
    const selectedRow = selectedEdgeId ? rows.find((row) => row.edgeId === selectedEdgeId) : undefined;
    const payload: Parameters<Console["log"]> = [
      "[outline-view]",
      "rows recalculated",
      {
        rowCount: rows.length,
        selectedEdgeId,
        selectedNodeId: selectedRow?.nodeId,
        selectedText: selectedRow?.text
      }
    ];
    if (typeof console.log === "function") {
      console.log(...payload);
      return;
    }
    if (typeof console.debug === "function") {
      console.debug(...payload);
    }
  }, [rows, selectedEdgeId, syncDebugLoggingEnabled]);

  const selectionAdapter = useMemo<OutlineSelectionAdapter>(() => ({
    getPrimaryEdgeId: () => selectionSnapshotRef.current.primaryEdgeId ?? null,
    getOrderedEdgeIds: () => [...selectionSnapshotRef.current.orderedEdgeIds],
    setPrimaryEdgeId: (edgeId, options) => {
      setShowSelectionHighlight(true);
      setSelectedEdgeId(edgeId, options?.cursor ? { cursor: options.cursor } : undefined);
    },
    clearRange: () => {
      setShowSelectionHighlight(true);
      setPaneSelectionRange(null);
    }
  }), [setPaneSelectionRange, setSelectedEdgeId, setShowSelectionHighlight]);

  const handleDeleteSelection = useCallback((): boolean => {
    const edgeIds = orderedSelectedEdgeIds;
    if (edgeIds.length === 0) {
      return false;
    }

    const plan = createDeleteEdgesPlan(outline, edgeIds);
    if (!plan || plan.removalOrder.length === 0) {
      return false;
    }

    if (plan.removalOrder.length > 30) {
      const confirmFn =
        typeof window !== "undefined" && typeof window.confirm === "function"
          ? window.confirm.bind(window)
          : null;
      const message = plan.removalOrder.length === 1
        ? "Delete the selected node? This also removes its descendants."
        : `Delete ${plan.removalOrder.length} nodes? This also removes their descendants.`;
      if (confirmFn && !confirmFn(message)) {
        return false;
      }
    }

    const result = deleteEdges({ outline, origin: localOrigin }, plan);
    const nextEdgeId = result.nextEdgeId;
    setShowSelectionHighlight(true);
    if (nextEdgeId) {
      setSelectedEdgeId(nextEdgeId);
    } else {
      setSelectedEdgeId(null);
    }
    return true;
  }, [localOrigin, orderedSelectedEdgeIds, outline, setSelectedEdgeId, setShowSelectionHighlight]);

  const isEditorEvent = (target: EventTarget | null): boolean => {
    // Don't hijack pointer/keyboard events that need to reach ProseMirror.
    if (!(target instanceof Node)) {
      return false;
    }
    const element = target instanceof HTMLElement ? target : target.parentElement;
    return Boolean(element?.closest(".thortiq-prosemirror"));
  };

  const findEdgeIdFromPoint = useCallback(
    (clientX: number, clientY: number): EdgeId | null => {
      if (typeof document === "undefined") {
        return null;
      }
      const element = document.elementFromPoint(clientX, clientY);
      if (!element) {
        return null;
      }
      const rowElement = element.closest<HTMLElement>('[data-outline-row="true"]');
      if (!rowElement) {
        return null;
      }
      const edgeId = rowElement.getAttribute("data-edge-id");
      return edgeId ? (edgeId as EdgeId) : null;
    },
    []
  );

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (isEditorEvent(event.target)) {
      return;
    }

    if (event.key === "Backspace" && event.shiftKey && (event.ctrlKey || event.metaKey)) {
      const handled = handleDeleteSelection();
      if (handled) {
        event.preventDefault();
      }
      return;
    }

    if (!rows.length || selectedIndex === -1 || !selectedEdgeId) {
      return;
    }

    const row = rows[selectedIndex];
    if (!row) {
      return;
    }

    if (event.key === "ArrowDown") {
      setPaneSelectionRange(null);
      setShowSelectionHighlight(true);
      event.preventDefault();
      const next = Math.min(selectedIndex + 1, rows.length - 1);
      setSelectedEdgeId(rows[next]?.edgeId ?? selectedEdgeId);
      return;
    }

    if (event.key === "ArrowUp") {
      setPaneSelectionRange(null);
      setShowSelectionHighlight(true);
      event.preventDefault();
      const next = Math.max(selectedIndex - 1, 0);
      setSelectedEdgeId(rows[next]?.edgeId ?? selectedEdgeId);
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      setPaneSelectionRange(null);
      setShowSelectionHighlight(true);
      event.preventDefault();
      const result = insertSiblingBelow({ outline, origin: localOrigin }, row.edgeId);
      setSelectedEdgeId(result.edgeId);
      return;
    }

    if (event.key === "Enter" && event.shiftKey) {
      setPaneSelectionRange(null);
      setShowSelectionHighlight(true);
      event.preventDefault();
      const result = insertChild({ outline, origin: localOrigin }, row.edgeId);
      setSelectedEdgeId(result.edgeId);
      return;
    }

    if (event.key === "Tab" && !event.shiftKey) {
      setShowSelectionHighlight(true);
      event.preventDefault();
      const orderedEdgeIds = rows
        .filter((candidate) => selectedEdgeIds.has(candidate.edgeId))
        .map((candidate) => candidate.edgeId);
      const edgeIdsToIndent = orderedEdgeIds.length > 0 ? orderedEdgeIds : [row.edgeId];
      const preserveRange = edgeIdsToIndent.length > 1;
      let anchorEdgeId: EdgeId | null = null;
      let focusEdgeId: EdgeId | null = null;
      if (preserveRange) {
        anchorEdgeId = edgeIdsToIndent[0] ?? null;
        focusEdgeId = edgeIdsToIndent[edgeIdsToIndent.length - 1] ?? null;
      }
      const result = indentEdges(
        { outline, origin: localOrigin },
        [...edgeIdsToIndent].reverse()
      );
      if (result) {
        if (preserveRange && anchorEdgeId && focusEdgeId) {
          setPaneSelectionRange({ anchorEdgeId, focusEdgeId });
          setSelectedEdgeId(row.edgeId, { preserveRange: true });
        } else {
          setPaneSelectionRange(null);
          setSelectedEdgeId(row.edgeId);
        }
      }
      return;
    }

    if (event.key === "Tab" && event.shiftKey) {
      setShowSelectionHighlight(true);
      event.preventDefault();
      const orderedEdgeIds = rows
        .filter((candidate) => selectedEdgeIds.has(candidate.edgeId))
        .map((candidate) => candidate.edgeId);
      const edgeIdsToOutdent = orderedEdgeIds.length > 0 ? orderedEdgeIds : [row.edgeId];
      const preserveRange = edgeIdsToOutdent.length > 1;
      let anchorEdgeId: EdgeId | null = null;
      let focusEdgeId: EdgeId | null = null;
      if (preserveRange) {
        anchorEdgeId = edgeIdsToOutdent[0] ?? null;
        focusEdgeId = edgeIdsToOutdent[edgeIdsToOutdent.length - 1] ?? null;
      }
      const result = outdentEdges({ outline, origin: localOrigin }, edgeIdsToOutdent);
      if (result) {
        if (preserveRange && anchorEdgeId && focusEdgeId) {
          setPaneSelectionRange({ anchorEdgeId, focusEdgeId });
          setSelectedEdgeId(row.edgeId, { preserveRange: true });
        } else {
          setPaneSelectionRange(null);
          setSelectedEdgeId(row.edgeId);
        }
      }
      return;
    }

    if (event.key === "ArrowLeft") {
      setPaneSelectionRange(null);
      setShowSelectionHighlight(true);
      event.preventDefault();
      if (row.hasChildren && !row.collapsed) {
        setPaneCollapsed(row.edgeId, true);
        return;
      }
      const parentRow = findParentRow(rows, row);
      if (parentRow) {
        setSelectedEdgeId(parentRow.edgeId);
      }
      return;
    }

    if (event.key === "ArrowRight") {
      setPaneSelectionRange(null);
      setShowSelectionHighlight(true);
      event.preventDefault();
      if (row.collapsed && row.hasChildren) {
        setPaneCollapsed(row.edgeId, false);
        return;
      }
      const childRow = findFirstChildRow(rows, row);
      if (childRow) {
        setSelectedEdgeId(childRow.edgeId);
      }
    }
  };

  const handleRowPointerDownCapture = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, edgeId: EdgeId) => {
      if (!event.isPrimary || event.button !== 0) {
        return;
      }
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.closest('[data-outline-toggle="true"]')) {
        return;
      }
      setShowSelectionHighlight(true);
      setPaneSelectionRange(null);
      setSelectedEdgeId(edgeId);
      setDragSelection({ pointerId: event.pointerId, anchorEdgeId: edgeId });
    },
    [setDragSelection, setPaneSelectionRange, setSelectedEdgeId, setShowSelectionHighlight]
  );

  useEffect(() => {
    if (!dragSelection) {
      return;
    }
    if (typeof window === "undefined") {
      setDragSelection(null);
      return;
    }
    if (!edgeIndexMap.has(dragSelection.anchorEdgeId)) {
      setDragSelection(null);
      return;
    }

    const handlePointerMove = (event: globalThis.PointerEvent) => {
      if (event.pointerId !== dragSelection.pointerId) {
        return;
      }
      const edgeId = findEdgeIdFromPoint(event.clientX, event.clientY);
      if (!edgeId || !edgeIndexMap.has(edgeId)) {
        return;
      }
      if (edgeId === dragSelection.anchorEdgeId) {
        if (selectionRange) {
          setPaneSelectionRange(null);
        }
        setSelectedEdgeId(dragSelection.anchorEdgeId);
        return;
      }
      if (
        selectionRange
        && selectionRange.anchorEdgeId === dragSelection.anchorEdgeId
        && selectionRange.focusEdgeId === edgeId
      ) {
        setSelectedEdgeId(edgeId, { preserveRange: true });
        setShowSelectionHighlight(true);
        return;
      }
      setPaneSelectionRange({ anchorEdgeId: dragSelection.anchorEdgeId, focusEdgeId: edgeId });
      setSelectedEdgeId(edgeId, { preserveRange: true });
      setShowSelectionHighlight(true);
    };

    const endDrag = (event: globalThis.PointerEvent) => {
      if (event.pointerId !== dragSelection.pointerId) {
        return;
      }
      setDragSelection(null);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
    };
  }, [dragSelection, edgeIndexMap, findEdgeIdFromPoint, selectionRange, setPaneSelectionRange, setSelectedEdgeId, setShowSelectionHighlight]);

  const handleRowMouseDown = (event: MouseEvent<HTMLDivElement>, edgeId: EdgeId) => {
    if (isEditorEvent(event.target)) {
      return;
    }
    if (
      event.target instanceof HTMLElement &&
      event.target.closest('[data-outline-toggle="true"]')
    ) {
      return;
    }
    event.preventDefault();
    const { clientX, clientY } = event;
    let pendingCursor: PendingCursor | null = null;
    const targetElement = event.target instanceof HTMLElement ? event.target : null;
    const textCell = targetElement?.closest('[data-outline-text-cell="true"]') ?? null;
    const textContent = targetElement?.closest('[data-outline-text-content="true"]') ?? null;
    if (textCell && !textContent) {
      // If the click landed in the text cell but outside the rendered text, place caret at the end.
      const contentElement = textCell.querySelector<HTMLElement>('[data-outline-text-content="true"]');
      if (contentElement) {
        const { right } = contentElement.getBoundingClientRect();
        if (clientX >= right) {
          pendingCursor = { edgeId, placement: "text-end" };
        }
      }
    }
    if (!pendingCursor) {
      pendingCursor = { edgeId, placement: "coords", clientX, clientY };
    }
    if (textContent) {
      setShowSelectionHighlight(false);
    } else {
      setShowSelectionHighlight(true);
    }
    setPendingCursor(pendingCursor);
    setPanePendingFocusEdgeId(pendingCursor.edgeId);
    setSelectedEdgeId(edgeId);
  };

  const handleActiveTextCellChange = useCallback(
    (edgeId: EdgeId, element: HTMLDivElement | null) => {
      // Track the text cell that should host the persistent ProseMirror view.
      setActiveTextCell((current) => {
        if (!element) {
          if (current?.edgeId === edgeId) {
            return null;
          }
          return current;
        }
        if (edgeId !== selectedEdgeId) {
          return current;
        }
        if (current?.edgeId === edgeId && current.element === element) {
          return current;
        }
        return { edgeId, element };
      });
    },
    [selectedEdgeId]
  );

  const handlePendingCursorHandled = useCallback(() => {
    setPendingCursor(null);
    setPanePendingFocusEdgeId(null);
  }, [setPanePendingFocusEdgeId]);

  const handleToggleCollapsed = (edgeId: EdgeId, collapsed?: boolean) => {
    const targetRow = rows.find((candidate) => candidate.edgeId === edgeId);
    const nextCollapsed = collapsed ?? !targetRow?.collapsed;
    setPaneCollapsed(edgeId, nextCollapsed);
  };

  const handleCreateNode = useCallback(() => {
    const result = focusContext
      ? insertChild({ outline, origin: localOrigin }, focusContext.edge.id)
      : insertRootNode({ outline, origin: localOrigin });

    setPendingCursor({ edgeId: result.edgeId, placement: "text-end" });
    setPanePendingFocusEdgeId(result.edgeId);
    setSelectedEdgeId(result.edgeId);
  }, [focusContext, localOrigin, outline, setPanePendingFocusEdgeId, setSelectedEdgeId]);

  const virtualizer = useVirtualizer({
    count: isTestFallback ? 0 : rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    overscan: 8,
    measureElement: (element) => element.getBoundingClientRect().height,
    initialRect: {
      width: 960,
      height: CONTAINER_HEIGHT
    }
  });

  if (isTestFallback) {
    return (
      <section style={styles.shell}>
        <OutlineHeader focus={focusContext} onFocusEdge={handleFocusEdge} onClearFocus={handleClearFocus} />
        <div
          style={styles.scrollContainer}
          tabIndex={0}
          onKeyDown={handleKeyDown}
          role="tree"
          aria-label="Outline"
        >
          {rows.map((row) => {
            const isSelected = selectedEdgeIds.has(row.edgeId);
            const isPrimarySelected = row.edgeId === selectedEdgeId;
            const highlight = isSelected && showSelectionHighlight;
            return (
              <Row
                key={row.edgeId}
                row={row}
                isSelected={isSelected}
                isPrimarySelected={isPrimarySelected}
                onFocusEdge={handleFocusEdge}
                highlightSelected={highlight}
                editorAttachedEdgeId={activeTextCell?.edgeId ?? null}
                onSelect={setSelectedEdgeId}
                onToggleCollapsed={handleToggleCollapsed}
                onRowPointerDownCapture={handleRowPointerDownCapture}
                onRowMouseDown={handleRowMouseDown}
                onActiveTextCellChange={prosemirrorTestsEnabled ? handleActiveTextCellChange : undefined}
                presence={presenceByEdgeId.get(row.edgeId) ?? EMPTY_PRESENCE}
                editorEnabled={prosemirrorTestsEnabled}
              />
            );
          })}
          <NewNodeButton onCreate={handleCreateNode} style={styles.newNodeButtonStatic} />
        </div>
        {prosemirrorTestsEnabled ? (
          <ActiveNodeEditor
            nodeId={selectedRow?.nodeId ?? null}
            container={activeTextCell?.element ?? null}
            pendingCursor={
              pendingCursor?.edgeId && pendingCursor.edgeId === selectedEdgeId ? pendingCursor : null
            }
            onPendingCursorHandled={handlePendingCursorHandled}
            selectionAdapter={selectionAdapter}
            activeRow={activeRowSummary}
            onDeleteSelection={handleDeleteSelection}
          />
        ) : null}
      </section>
    );
  }

  const virtualItems = virtualizer.getVirtualItems();
  const totalHeight = virtualizer.getTotalSize();

  return (
    <section style={styles.shell}>
      <OutlineHeader focus={focusContext} onFocusEdge={handleFocusEdge} onClearFocus={handleClearFocus} />
      <div
        ref={parentRef}
        style={styles.scrollContainer}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        role="tree"
        aria-label="Outline"
      >
        <div style={{ height: `${totalHeight}px`, position: "relative" }}>
        {virtualItems.map((virtualRow) => {
          const row = rows[virtualRow.index];
          if (!row) {
            return null;
          }

            const isSelected = selectedEdgeIds.has(row.edgeId);
            const isPrimarySelected = row.edgeId === selectedEdgeId;
            const highlight = isSelected && showSelectionHighlight;
            const selectionBackground = highlight
              ? isPrimarySelected
                ? "#eef2ff"
                : "#f3f4ff"
              : "transparent";
            const selectionBorder = highlight
              ? isPrimarySelected
                ? "3px solid #4f46e5"
                : "3px solid #c7d2fe"
              : "3px solid transparent";

            return (
              <div
                key={row.edgeId}
                ref={virtualizer.measureElement}
                role="treeitem"
                aria-level={row.depth + 1}
                aria-selected={isSelected}
                data-outline-row="true"
                data-edge-id={row.edgeId}
                data-index={virtualRow.index}
                data-row-index={virtualRow.index}
                style={{
                  ...styles.row,
                  transform: `translateY(${virtualRow.start}px)`,
                  paddingLeft: `${row.depth * ROW_INDENT_PX + BASE_ROW_PADDING_PX}px`,
                  backgroundColor: selectionBackground,
                  borderLeft: selectionBorder
                }}
                onPointerDownCapture={(event) => handleRowPointerDownCapture(event, row.edgeId)}
                onMouseDown={(event) => handleRowMouseDown(event, row.edgeId)}
              >
              <RowContent
                row={row}
                isSelected={isSelected}
                isPrimarySelected={isPrimarySelected}
                onFocusEdge={handleFocusEdge}
                highlightSelected={highlight}
                editorAttachedEdgeId={activeTextCell?.edgeId ?? null}
                onSelect={setSelectedEdgeId}
                onToggleCollapsed={handleToggleCollapsed}
                onActiveTextCellChange={handleActiveTextCellChange}
                  presence={presenceByEdgeId.get(row.edgeId) ?? EMPTY_PRESENCE}
                  editorEnabled
                />
              </div>
            );
          })}
        </div>
        <NewNodeButton onCreate={handleCreateNode} />
      </div>
      <ActiveNodeEditor
        nodeId={selectedRow?.nodeId ?? null}
        container={activeTextCell?.element ?? null}
        pendingCursor={
          pendingCursor?.edgeId && pendingCursor.edgeId === selectedEdgeId ? pendingCursor : null
        }
        onPendingCursorHandled={handlePendingCursorHandled}
        selectionAdapter={selectionAdapter}
        activeRow={activeRowSummary}
        onDeleteSelection={handleDeleteSelection}
      />
    </section>
  );
};

interface OutlineHeaderProps {
  readonly focus: PaneFocusContext | null;
  readonly onFocusEdge: (payload: FocusPanePayload) => void;
  readonly onClearFocus: () => void;
}

interface BreadcrumbDescriptor {
  readonly key: string;
  readonly label: string;
  readonly edgeId: EdgeId | null;
  readonly pathEdgeIds: ReadonlyArray<EdgeId>;
  readonly isCurrent: boolean;
}

const OutlineHeader = ({ focus, onFocusEdge, onClearFocus }: OutlineHeaderProps): JSX.Element => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const measurementRefs = useRef(new Map<number, HTMLSpanElement>());
  const ellipsisMeasurementRef = useRef<HTMLSpanElement | null>(null);
  const listWrapperRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [plan, setPlan] = useState<BreadcrumbDisplayPlan | null>(null);
  const [openDropdown, setOpenDropdown] = useState<
    | { readonly items: ReadonlyArray<BreadcrumbDescriptor>; readonly left: number; readonly top: number }
    | null
  >(null);

  const crumbs = useMemo<ReadonlyArray<BreadcrumbDescriptor>>(() => {
    if (!focus) {
      return [];
    }
    const entries: BreadcrumbDescriptor[] = [
      {
        key: "document",
        label: "Document",
        edgeId: null,
        pathEdgeIds: [],
        isCurrent: false
      }
    ];

    focus.path.forEach((segment, index) => {
      const accumulated = focus.path.slice(0, index + 1).map((entry) => entry.edge.id);
      entries.push({
        key: segment.edge.id,
        label: segment.node.text || "Untitled node",
        edgeId: segment.edge.id,
        pathEdgeIds: accumulated,
        isCurrent: index === focus.path.length - 1
      });
    });

    return entries;
  }, [focus]);

  const setMeasurementRef = useCallback((index: number) => (element: HTMLSpanElement | null) => {
    const map = measurementRefs.current;
    if (!element) {
      map.delete(index);
      return;
    }
    map.set(index, element);
  }, []);

  useLayoutEffect(() => {
    const target = listWrapperRef.current ?? containerRef.current;
    if (!target) {
      return;
    }

    const measure = () => {
      const rect = target.getBoundingClientRect();
      if (rect.width > 0) {
        setContainerWidth(rect.width);
        return;
      }
      const fallbackRect = target.parentElement?.getBoundingClientRect();
      setContainerWidth(fallbackRect?.width ?? rect.width);
    };

    if (typeof ResizeObserver !== "function") {
      measure();
      return;
    }

    measure();

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }
      if (entry.contentRect.width > 0) {
        setContainerWidth(entry.contentRect.width);
        return;
      }
      const fallbackRect = target.parentElement?.getBoundingClientRect();
      setContainerWidth(fallbackRect?.width ?? entry.contentRect.width);
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, [crumbs.length, focus]);

  useLayoutEffect(() => {
    if (!focus) {
      setPlan(null);
      return;
    }
    if (containerWidth <= 0) {
      return;
    }
    const measurements = crumbs.map((_, index) => ({
      width: measurementRefs.current.get(index)?.offsetWidth ?? 0
    }));
    const ellipsisWidth = ellipsisMeasurementRef.current?.offsetWidth ?? 16;
    setPlan(planBreadcrumbVisibility(measurements, containerWidth, ellipsisWidth));
  }, [containerWidth, crumbs, focus]);

  useEffect(() => {
    setOpenDropdown(null);
  }, [focus]);

  useEffect(() => {
    if (!openDropdown) {
      return;
    }
    const handlePointerDown = (event: globalThis.PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpenDropdown(null);
      }
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [openDropdown]);

  useEffect(() => {
    if (!openDropdown) {
      return;
    }
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenDropdown(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [openDropdown]);

  const collapsedRanges = plan?.collapsedRanges ?? [];
  const allowLastCrumbTruncation = (() => {
    if (!plan) {
      return false;
    }
    const lastIndex = crumbs.length - 1;
    if (lastIndex <= 0) {
      return false;
    }
    if (plan.fitsWithinWidth) {
      return false;
    }
    if (collapsedRanges.length !== 1) {
      return false;
    }
    const [start, end] = collapsedRanges[0];
    return start === 0 && end === lastIndex - 1;
  })();

  const handleCrumbSelect = (crumb: BreadcrumbDescriptor) => {
    if (crumb.edgeId === null) {
      onClearFocus();
      return;
    }
    onFocusEdge({ edgeId: crumb.edgeId, pathEdgeIds: crumb.pathEdgeIds });
  };

  const handleEllipsisClick = (
    event: MouseEvent<HTMLButtonElement>,
    range: readonly [number, number]
  ) => {
    const containerRect = containerRef.current?.getBoundingClientRect();
    const anchorRect = event.currentTarget.getBoundingClientRect();
    if (!containerRect) {
      return;
    }
    const items = crumbs.slice(range[0], range[1] + 1);
    setOpenDropdown({
      items,
      left: anchorRect.left - containerRect.left,
      top: anchorRect.bottom - containerRect.top + 8
    });
  };

  const renderCrumbs = () => {
    const nodes: ReactNode[] = [];
    let rangeIndex = 0;
    for (let index = 0; index < crumbs.length;) {
      const range = collapsedRanges[rangeIndex];
      if (range && index === range[0]) {
        const ellipsisKey = `ellipsis-${range[0]}-${range[1]}`;
        if (nodes.length > 0) {
          nodes.push(
            <span key={`${ellipsisKey}-sep`} style={styles.breadcrumbSeparator} aria-hidden>
              ›
            </span>
          );
        }
        nodes.push(
          <button
            key={ellipsisKey}
            type="button"
            style={styles.breadcrumbEllipsis}
            onClick={(event) => handleEllipsisClick(event, range)}
            aria-label="Show hidden ancestors"
          >
            …
          </button>
        );
        index = range[1] + 1;
        rangeIndex += 1;
        continue;
      }

      const crumb = crumbs[index];
      const key = `crumb-${crumb.key}`;
      if (nodes.length > 0) {
        nodes.push(
          <span key={`${key}-sep`} style={styles.breadcrumbSeparator} aria-hidden>
            ›
          </span>
        );
      }
      if (crumb.isCurrent) {
        const crumbStyle = allowLastCrumbTruncation && index === crumbs.length - 1
          ? { ...styles.breadcrumbCurrent, ...styles.breadcrumbTruncatedCurrent }
          : styles.breadcrumbCurrent;
        nodes.push(
          <span key={key} style={crumbStyle} aria-current="page">
            {crumb.label}
          </span>
        );
      } else {
        nodes.push(
          <button
            key={key}
            type="button"
            style={styles.breadcrumbButton}
            onClick={() => handleCrumbSelect(crumb)}
          >
            {crumb.label}
          </button>
        );
      }
      index += 1;
    }
    return nodes;
  };

  if (!focus) {
    return (
      <header style={styles.header}>
        <h1 style={styles.title}>Thortiq Outline</h1>
        <p style={styles.subtitle}>Keyboard arrows move selection. Editing arrives in later steps.</p>
      </header>
    );
  }

  return (
    <header style={styles.focusHeader}>
      <div ref={containerRef} style={styles.breadcrumbBar}>
        <div style={styles.breadcrumbMeasurements} aria-hidden>
          {crumbs.map((crumb, index) => (
            <span
              key={`measure-${crumb.key}`}
              ref={setMeasurementRef(index)}
              style={styles.breadcrumbMeasureItem}
            >
              {crumb.label}
            </span>
          ))}
          <span ref={ellipsisMeasurementRef} style={styles.breadcrumbMeasureItem}>
            …
          </span>
        </div>
        <nav aria-label="Focused node breadcrumbs" style={styles.breadcrumbListWrapper}>
          <div ref={listWrapperRef} style={styles.breadcrumbListViewport}>
            <div style={styles.breadcrumbList}>{renderCrumbs()}</div>
          </div>
        </nav>
        {openDropdown ? (
          <div
            style={{
              ...styles.breadcrumbDropdown,
              left: openDropdown.left,
              top: openDropdown.top
            }}
          >
            {openDropdown.items.map((crumb) => (
              <button
                key={`dropdown-${crumb.key}`}
                type="button"
                style={styles.breadcrumbDropdownButton}
                onClick={() => {
                  handleCrumbSelect(crumb);
                  setOpenDropdown(null);
                }}
              >
                {crumb.label}
              </button>
            ))}
            <button
              type="button"
              style={styles.breadcrumbDropdownButton}
              onClick={() => {
                onClearFocus();
                setOpenDropdown(null);
              }}
            >
              View entire document
            </button>
          </div>
        ) : null}
      </div>
      <h2 style={styles.focusTitle}>{focus.node.text || "Untitled node"}</h2>
    </header>
  );
};

interface RowProps {
  readonly row: OutlineRow;
  readonly isSelected: boolean;
  readonly isPrimarySelected: boolean;
  readonly onSelect: (edgeId: EdgeId) => void;
  readonly onFocusEdge?: (payload: FocusPanePayload) => void;
  readonly onToggleCollapsed: (edgeId: EdgeId, collapsed?: boolean) => void;
  readonly onRowMouseDown?: (event: MouseEvent<HTMLDivElement>, edgeId: EdgeId) => void;
  readonly onRowPointerDownCapture?: (event: ReactPointerEvent<HTMLDivElement>, edgeId: EdgeId) => void;
  readonly onActiveTextCellChange?: (edgeId: EdgeId, element: HTMLDivElement | null) => void;
  readonly editorEnabled: boolean;
  readonly highlightSelected: boolean;
  readonly editorAttachedEdgeId: EdgeId | null;
  readonly presence: readonly OutlinePresenceParticipant[];
}

const Row = ({
  row,
  isSelected,
  isPrimarySelected,
  onFocusEdge,
  highlightSelected,
  editorAttachedEdgeId,
  onSelect,
  onToggleCollapsed,
  onRowMouseDown,
  onRowPointerDownCapture,
  onActiveTextCellChange,
  editorEnabled,
  presence
}: RowProps): JSX.Element => {
  const selectionBackground = isSelected && highlightSelected
    ? isPrimarySelected
      ? "#eef2ff"
      : "#f3f4ff"
    : "transparent";
  const selectionBorder = isSelected && highlightSelected
    ? isPrimarySelected
      ? "3px solid #4f46e5"
      : "3px solid #c7d2fe"
    : "3px solid transparent";

  return (
    <div
      role="treeitem"
      aria-level={row.depth + 1}
      aria-selected={isSelected}
      data-outline-row="true"
      data-edge-id={row.edgeId}
      style={{
        ...styles.testRow,
        paddingLeft: `${row.depth * ROW_INDENT_PX + BASE_ROW_PADDING_PX}px`,
        backgroundColor: selectionBackground,
        borderLeft: selectionBorder
      }}
      onPointerDownCapture={(event) => {
        onRowPointerDownCapture?.(event, row.edgeId);
      }}
      onMouseDown={(event) => {
        if (onRowMouseDown) {
          onRowMouseDown(event, row.edgeId);
          return;
        }
        onSelect(row.edgeId);
      }}
    >
      <RowContent
        row={row}
        isSelected={isSelected}
        isPrimarySelected={isPrimarySelected}
        onFocusEdge={onFocusEdge}
        highlightSelected={highlightSelected}
        editorAttachedEdgeId={editorAttachedEdgeId}
        onSelect={onSelect}
        onToggleCollapsed={onToggleCollapsed}
        onActiveTextCellChange={onActiveTextCellChange}
        editorEnabled={editorEnabled}
        presence={presence}
      />
    </div>
  );
};

const RowContent = ({
  row,
  isSelected,
  isPrimarySelected,
  onFocusEdge,
  highlightSelected,
  editorAttachedEdgeId,
  onSelect,
  onToggleCollapsed,
  onActiveTextCellChange,
  editorEnabled,
  presence
}: RowProps): JSX.Element => {
  const textCellRef = useRef<HTMLDivElement | null>(null);

  const remotePresence = useMemo(
    () => presence.filter((participant) => !participant.isLocal),
    [presence]
  );
  const presenceLabel = remotePresence.map((participant) => participant.displayName).join(", ");

  const presenceIndicators = remotePresence.length > 0 ? (
    <span
      style={styles.presenceStack}
      data-outline-presence="true"
      aria-label={`Also viewing: ${presenceLabel}`}
    >
      {remotePresence.map((participant) => (
        <span
          key={`presence-${participant.clientId}`}
          style={{ ...styles.presenceDot, backgroundColor: participant.color }}
          title={`${participant.displayName} is viewing this node`}
          data-outline-presence-indicator="true"
        />
      ))}
    </span>
  ) : null;

  useLayoutEffect(() => {
    if (!onActiveTextCellChange) {
      return;
    }
    // Expose the live DOM cell so the persistent editor can move between rows.
    onActiveTextCellChange(row.edgeId, isSelected ? textCellRef.current : null);
    return () => {
      onActiveTextCellChange(row.edgeId, null);
    };
  }, [isSelected, onActiveTextCellChange, row.edgeId]);

  const handleToggle = () => {
    if (!row.hasChildren) {
      return;
    }
    onToggleCollapsed(row.edgeId, !row.collapsed);
    onSelect(row.edgeId);
  };

  const caret = row.hasChildren ? (
    <button
      type="button"
      style={styles.toggleButton}
      onClick={handleToggle}
      aria-label={row.collapsed ? "Expand node" : "Collapse node"}
      data-outline-toggle="true"
    >
      <span
        style={{
          ...styles.caretIconWrapper,
          ...(row.collapsed ? styles.caretIconCollapsed : styles.caretIconExpanded)
        }}
      >
        <svg viewBox="0 0 24 24" style={styles.caretSvg} aria-hidden="true" focusable="false">
          <path d="M8 5l8 7-8 7z" />
        </svg>
      </span>
    </button>
  ) : (
    <span style={styles.caretPlaceholder} data-outline-toggle-placeholder="true" />
  );

  const bulletVariant = row.hasChildren ? (row.collapsed ? "collapsed-parent" : "parent") : "leaf";
  const handleBulletMouseDown = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const handleBulletClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!onFocusEdge) {
      return;
    }
    const pathEdgeIds = [...row.ancestorEdgeIds, row.edgeId];
    onFocusEdge({ edgeId: row.edgeId, pathEdgeIds });
  };

  const bullet = (
    <button
      type="button"
      style={{
        ...styles.bulletButton,
        ...(bulletVariant === "collapsed-parent" ? styles.collapsedBullet : styles.standardBullet)
      }}
      data-outline-bullet={bulletVariant}
      onMouseDown={handleBulletMouseDown}
      onClick={handleBulletClick}
      aria-label="Focus node"
    >
      <span style={styles.bulletGlyph}>•</span>
    </button>
  );
  const showEditor = editorEnabled && editorAttachedEdgeId === row.edgeId;

  if (isSelected) {
    const selectionBackground = highlightSelected
      ? isPrimarySelected
        ? "#eef2ff"
        : "#f3f4ff"
      : "transparent";
    return (
      <div
        style={{
          ...styles.rowContentSelected,
          backgroundColor: selectionBackground
        }}
      >
        <div style={styles.iconCell}>{caret}</div>
        <div style={styles.bulletCell}>
          {bullet}
        </div>
        <div style={styles.textCell} ref={textCellRef} data-outline-text-cell="true">
          <span
            style={{
              ...styles.rowText,
              display: showEditor ? "none" : "inline"
            }}
            data-outline-text-content="true"
          >
            {row.text || "Untitled node"}
          </span>
          {presenceIndicators}
        </div>
      </div>
    );
  }

  return (
    <div style={styles.rowContentStatic}>
      <div style={styles.iconCell}>{caret}</div>
      <div style={styles.bulletCell}>
        {bullet}
      </div>
      <div style={styles.textCell} ref={textCellRef} data-outline-text-cell="true">
        <span style={styles.rowText} data-outline-text-content="true">
          {row.text || "Untitled node"}
        </span>
        {presenceIndicators}
      </div>
    </div>
  );
};

interface NewNodeButtonProps {
  readonly onCreate: () => void;
  readonly style?: CSSProperties;
}

const NewNodeButton = ({ onCreate, style }: NewNodeButtonProps): JSX.Element => {
  const containerStyle = style
    ? { ...styles.newNodeButtonRow, ...style }
    : styles.newNodeButtonRow;

  return (
    <div style={containerStyle}>
      <div style={styles.iconCell} aria-hidden />
      <div style={styles.bulletCell}>
        <button
          type="button"
          style={styles.newNodeActionButton}
          onClick={onCreate}
          aria-label="Add new node"
          title="Add new node"
        >
          <span aria-hidden style={styles.newNodeActionGlyph}>
            +
          </span>
        </button>
      </div>
      <div style={styles.newNodeButtonTextSpacer} aria-hidden />
    </div>
  );
};

const findParentRow = (rows: OutlineRow[], row: OutlineRow): OutlineRow | undefined => {
  if (!row.parentNodeId) {
    return undefined;
  }
  return rows.find((candidate) => candidate.nodeId === row.parentNodeId);
};

const findFirstChildRow = (rows: OutlineRow[], row: OutlineRow): OutlineRow | undefined => {
  return rows.find((candidate) => candidate.parentNodeId === row.nodeId);
};

const styles: Record<string, CSSProperties> = {
  shell: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    maxWidth: "960px",
    margin: "0 auto",
    padding: "1.5rem",
    boxSizing: "border-box"
  },
  header: {
    marginBottom: "1rem"
  },
  focusHeader: {
    marginBottom: "1rem",
    display: "flex",
    flexDirection: "column",
    gap: "0.75rem"
  },
  title: {
    margin: 0,
    fontSize: "1.75rem",
    fontWeight: 600
  },
  subtitle: {
    margin: 0,
    color: "#6b7280"
  },
  focusTitle: {
    margin: 0,
    fontSize: "1.5rem",
    fontWeight: 600,
    color: "#0f172a"
  },
  breadcrumbBar: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    gap: "0.25rem",
    width: "100%",
    maxWidth: "100%"
  },
  breadcrumbMeasurements: {
    position: "absolute",
    visibility: "hidden",
    pointerEvents: "none",
    height: 0,
    overflow: "hidden"
  },
  breadcrumbMeasureItem: {
    display: "inline-block",
    padding: "0.25rem 0.5rem",
    fontSize: "0.9rem",
    fontWeight: 500,
    whiteSpace: "nowrap"
  },
  breadcrumbListWrapper: {
    overflow: "hidden",
    width: "100%",
    minWidth: 0
  },
  breadcrumbListViewport: {
    width: "100%",
    overflow: "hidden"
  },
  breadcrumbList: {
    display: "flex",
    alignItems: "center",
    flexWrap: "nowrap",
    gap: "0.25rem",
    minWidth: 0,
    width: "100%"
  },
  breadcrumbButton: {
    border: "none",
    background: "transparent",
    padding: "0.25rem 0.5rem",
    borderRadius: "0.375rem",
    color: "#1f2937",
    fontSize: "0.9rem",
    fontWeight: 500,
    cursor: "pointer",
    transition: "background-color 120ms ease, color 120ms ease",
    whiteSpace: "nowrap",
    flexShrink: 0
  },
  breadcrumbCurrent: {
    padding: "0.25rem 0.5rem",
    borderRadius: "0.375rem",
    backgroundColor: "#e0e7ff",
    color: "#312e81",
    fontSize: "0.9rem",
    fontWeight: 600,
    whiteSpace: "nowrap",
    flexShrink: 0
  },
  breadcrumbSeparator: {
    color: "#9ca3af",
    fontSize: "0.85rem"
  },
  breadcrumbTruncatedCurrent: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    flexShrink: 1,
    maxWidth: "100%",
    minWidth: 0
  },
  breadcrumbEllipsis: {
    border: "none",
    background: "transparent",
    padding: "0.25rem 0.5rem",
    borderRadius: "0.375rem",
    cursor: "pointer",
    fontSize: "0.9rem",
    color: "#1f2937"
  },
  breadcrumbDropdown: {
    position: "absolute",
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    boxShadow: "0 12px 32px rgba(15, 23, 42, 0.12)",
    borderRadius: "0.75rem",
    padding: "0.5rem 0",
    zIndex: 10,
    minWidth: "12rem"
  },
  breadcrumbDropdownButton: {
    width: "100%",
    textAlign: "left",
    padding: "0.5rem 1rem",
    border: "none",
    background: "transparent",
    color: "#1f2937",
    fontSize: "0.9rem",
    cursor: "pointer"
  },
  scrollContainer: {
    border: "1px solid #e5e7eb",
    borderRadius: "0.75rem",
    overflow: "auto",
    flex: 1,
    height: `${CONTAINER_HEIGHT}px`,
    background: "#ffffff",
    position: "relative"
  },
  row: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    display: "flex",
    alignItems: "center",
    minHeight: `${ESTIMATED_ROW_HEIGHT}px`,
    fontSize: "1rem",
    lineHeight: 1.5,
    color: "#111827",
    borderBottom: "1px solid #f3f4f6",
    cursor: "text"
  },
  newNodeButtonRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: "0.25rem",
    paddingLeft: `${BASE_ROW_PADDING_PX}px`,
    paddingTop: "0.75rem",
    paddingBottom: "0.75rem",
    minHeight: `${ESTIMATED_ROW_HEIGHT}px`
  },
  newNodeButtonStatic: {
    borderTop: "1px solid #f3f4f6"
  },
  newNodeButtonTextSpacer: {
    flex: 1
  },
  newNodeActionButton: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: `${NEW_NODE_BUTTON_DIAMETER_REM}rem`,
    height: `${NEW_NODE_BUTTON_DIAMETER_REM}rem`,
    borderRadius: "9999px",
    border: "2px solid #4f46e5",
    backgroundColor: "#eef2ff",
    color: "#312e81",
    cursor: "pointer",
    boxShadow: "0 8px 18px rgba(79, 70, 229, 0.18)",
    transition: "transform 120ms ease, box-shadow 120ms ease, background-color 120ms ease",
    flexShrink: 0,
    minWidth: `${NEW_NODE_BUTTON_DIAMETER_REM}rem`
  },
  newNodeActionGlyph: {
    fontSize: "1.35rem",
    fontWeight: 600,
    lineHeight: 1
  },
  testRow: {
    display: "flex",
    alignItems: "center",
    minHeight: `${ESTIMATED_ROW_HEIGHT}px`,
    fontSize: "1rem",
    lineHeight: 1.5,
    color: "#111827",
    borderBottom: "1px solid #f3f4f6",
    cursor: "text"
  },
  rowText: {
    whiteSpace: "pre-wrap",
    wordBreak: "break-word"
  },
  rowContentSelected: {
    display: "flex",
    alignItems: "flex-start",
    gap: "0.25rem",
    width: "100%"
  },
  rowContentStatic: {
    display: "flex",
    alignItems: "flex-start",
    gap: "0.25rem",
    width: "100%"
  },
  textCell: {
    flex: 1,
    display: "flex",
    alignItems: "flex-start",
    gap: "0.5rem",
    cursor: "text"
  },
  presenceStack: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.25rem",
    marginLeft: "0.5rem"
  },
  presenceDot: {
    display: "inline-flex",
    width: "0.6rem",
    height: "0.6rem",
    borderRadius: "9999px",
    border: "2px solid #ffffff",
    boxShadow: "0 0 0 1px rgba(17, 24, 39, 0.08)"
  },
  iconCell: {
    width: `${TOGGLE_CONTAINER_DIAMETER_REM}rem`,
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "center"
  },
  bulletCell: {
    width: `${BULLET_DIAMETER_REM}rem`,
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "center"
  },
  bulletButton: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: `${BULLET_DIAMETER_REM}rem`,
    height: `${BULLET_DIAMETER_REM}rem`,
    marginTop: `${BULLET_TOP_OFFSET_REM}rem`,
    border: "none",
    background: "transparent",
    borderRadius: "9999px",
    cursor: "pointer"
  },
  standardBullet: {
    backgroundColor: "transparent"
  },
  collapsedBullet: {
    backgroundColor: "#e5e7eb",
    borderRadius: "9999px"
  },
  bulletGlyph: {
    color: "#374151",
    fontSize: "1.7rem",
    lineHeight: 1
  },
  caretPlaceholder: {
    display: "inline-flex",
    width: `${TOGGLE_CONTAINER_DIAMETER_REM}rem`,
    height: `${TOGGLE_CONTAINER_DIAMETER_REM}rem`,
    marginTop: `${BULLET_TOP_OFFSET_REM}rem`
  },
  toggleButton: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: `${TOGGLE_CONTAINER_DIAMETER_REM}rem`,
    height: `${TOGGLE_CONTAINER_DIAMETER_REM}rem`,
    border: "none",
    background: "transparent",
    color: "#6b7280",
    cursor: "pointer",
    padding: 0,
    marginTop: `${BULLET_TOP_OFFSET_REM}rem`
  },
  caretIconWrapper: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: `${CARET_HEIGHT_REM}rem`,
    height: `${CARET_HEIGHT_REM}rem`,
    transition: "transform 120ms ease"
  },
  caretIconCollapsed: {
    transform: "rotate(0deg)"
  },
  caretIconExpanded: {
    transform: "rotate(90deg)"
  },
  caretSvg: {
    display: "block",
    width: "100%",
    height: "100%",
    fill: "#6b7280"
  }
};
