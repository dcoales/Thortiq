/**
 * Web-specific outline pane container that composes shared snapshot selectors with session and
 * cursor controllers. Rendering, drag logic, and ProseMirror orchestration stay here while
 * store mutations and cursor intent live in dedicated hooks per AGENTS.md separation rules.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore
} from "react";
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent
} from "react";
import type { Virtualizer } from "@tanstack/react-virtual";

import {
  useOutlinePaneState,
  useOutlineSessionStore,
  useOutlineSnapshot,
  useOutlinePresence,
  useSyncContext,
  useAwarenessIndicatorsEnabled,
  useOutlineStore,
  useOutlinePaneIds,
  useOutlineActivePaneId,
  type OutlinePresenceParticipant
} from "./OutlineProvider";
import { ActiveNodeEditor } from "./ActiveNodeEditor";
import { WikiLinkEditDialog } from "./components/WikiLinkEditDialog";
import {
  insertChild,
  insertRootNode,
  insertSiblingAbove,
  insertSiblingBelow,
  mirrorNodesToParent,
  moveEdgesToParent,
  toggleTodoDoneCommand,
  type MoveToInsertionPosition
} from "@thortiq/outline-commands";
import { addEdge, ensurePaneRuntimeState, withTransaction } from "@thortiq/client-core";
import {
  matchOutlineCommand,
  outlineCommandDescriptors,
  type EdgeId,
  type NodeId,
  type OutlineContextMenuSelectionSnapshot,
  updateWikiLinkDisplayText,
  toggleNodeInlineMark,
  setNodeColorMark,
  setNodeHeadingLevel,
  getColorPalette,
  replaceColorPalette,
  searchMoveTargets,
  searchWikiLinkCandidates,
  type MoveTargetCandidate,
  type OutlineSnapshot,
  type WikiLinkSearchCandidate,
  type ColorPaletteMode,
  type ColorPaletteSnapshot,
  type NodeHeadingLevel,
  getInboxNodeId,
  getJournalNodeId,
  updateDateMark,
  getUserSetting
} from "@thortiq/client-core";
import type { FocusHistoryDirection, FocusPanePayload } from "@thortiq/sync-core";
import { FONT_FAMILY_STACK } from "../theme/typography";
import {
  useOutlineRows,
  useOutlineSingletonNodes,
  useOutlineSelection,
  useOutlineDragAndDrop,
  OutlineVirtualList,
  OutlineRowView,
  OutlineContextMenu,
  ColorPalettePopover,
  DatePickerPopover,
  OUTLINE_ROW_TOGGLE_DIAMETER_REM,
  OUTLINE_ROW_BULLET_DIAMETER_REM,
  type OutlinePendingCursor,
  type OutlineVirtualRowRendererProps,
  type OutlineMirrorIndicatorClickPayload,
  usePaneSearch,
  type PaneSearchToggleTagOptions,
  useOutlineContextMenu,
  type OutlineContextMenuEvent,
  type OutlineContextMenuMoveMode,
  type OutlineContextMenuFormattingActionRequest,
  type OutlineContextMenuColorPaletteRequest,
  type OutlineDateClickPayload,
  usePaneOpener,
  usePaneCloser
} from "@thortiq/client-react";
import type { CollaborativeEditor } from "@thortiq/editor-prosemirror";
import { usePaneSessionController } from "./hooks/usePaneSessionController";
import { useOutlineCursorManager } from "./hooks/useOutlineCursorManager";
import { planGuidelineCollapse } from "./utils/guidelineCollapse";
import { OutlineHeader } from "./components/OutlineHeader";
import { MirrorTrackerDialog, type MirrorTrackerDialogEntry } from "./components/MirrorTrackerDialog";
import { MoveToDialog } from "./components/MoveToDialog";
import { FocusNodeDialog } from "./components/FocusNodeDialog";
import { QuickNoteDialog } from "./components/QuickNoteDialog";
import { MissingNodeDialog } from "./components/MissingNodeDialog";

const ESTIMATED_ROW_HEIGHT = 32;
const CONTAINER_HEIGHT = 480;
const NEW_NODE_BUTTON_DIAMETER_REM = 1.25;
const EMPTY_PRESENCE: readonly OutlinePresenceParticipant[] = [];
const EMPTY_PRESENCE_MAP: ReadonlyMap<EdgeId, readonly OutlinePresenceParticipant[]> = new Map();

const INLINE_MARK_NAME_BY_ACTION: Record<
  "bold" | "italic" | "underline" | "strikethrough",
  "strong" | "em" | "underline" | "strikethrough"
> = {
  bold: "strong",
  italic: "em",
  underline: "underline",
  strikethrough: "strikethrough"
};

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

const isEditorEventTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof Node)) {
    return false;
  }
  const element = target instanceof HTMLElement ? target : target.parentElement;
  return Boolean(element?.closest(".thortiq-prosemirror"));
};

const isTextInputTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    return true;
  }
  if (target.isContentEditable) {
    if (target.closest(".thortiq-prosemirror")) {
      return false;
    }
    return true;
  }
  return false;
};

interface WikiHoverState {
  readonly edgeId: EdgeId;
  readonly sourceNodeId: NodeId;
  readonly targetNodeId: NodeId;
  readonly displayText: string;
  readonly segmentIndex: number;
  readonly element: HTMLElement;
}

interface WikiEditState {
  readonly edgeId: EdgeId;
  readonly sourceNodeId: NodeId;
  readonly targetNodeId: NodeId;
  readonly segmentIndex: number;
  readonly anchor: {
    readonly left: number;
    readonly top: number;
  };
  readonly displayText: string;
}

interface MirrorTrackerEntry {
  readonly edgeId: EdgeId;
  readonly canonicalEdgeId: EdgeId;
  readonly isOriginal: boolean;
  readonly pathEdgeIds: ReadonlyArray<EdgeId>;
  readonly pathSegments: ReadonlyArray<{
    readonly edgeId: EdgeId;
    readonly label: string;
  }>;
  readonly pathLabel: string;
}

interface MirrorTrackerState {
  readonly anchor: {
    readonly left: number;
    readonly top: number;
  };
  readonly nodeId: NodeId;
  readonly sourceEdgeId: EdgeId;
}

interface MoveDialogState {
  readonly mode: OutlineContextMenuMoveMode;
  readonly anchor: { readonly left: number; readonly bottom: number };
  readonly selection: {
    readonly orderedEdgeIds: readonly EdgeId[];
    readonly anchorEdgeId: EdgeId;
    readonly focusEdgeId: EdgeId;
    readonly nodeIds: readonly NodeId[];
  };
  readonly forbiddenNodeIds: ReadonlySet<NodeId>;
  readonly query: string;
  readonly insertPosition: MoveToInsertionPosition;
  readonly selectedIndex: number;
}

interface FocusDialogState {
  readonly anchor: { readonly left: number; readonly bottom: number };
  readonly query: string;
  readonly selectedIndex: number;
}

interface ContextMenuColorPaletteState {
  readonly mode: "text" | "background";
  readonly anchor: { readonly x: number; readonly y: number };
  readonly palette: ColorPaletteSnapshot;
  readonly request: OutlineContextMenuFormattingActionRequest;
}

interface DatePickerState {
  readonly edgeId: EdgeId;
  readonly nodeId: NodeId;
  readonly segmentIndex: number | null;
  readonly hasTime: boolean;
  readonly value: string | null;
  readonly position: { readonly from: number; readonly to: number } | null;
  readonly anchor: { readonly left: number; readonly top: number; readonly bottom: number };
}

const collectForbiddenNodeIds = (
  snapshot: OutlineSnapshot,
  seedNodeIds: readonly NodeId[]
): ReadonlySet<NodeId> => {
  const forbidden = new Set<NodeId>(seedNodeIds);
  const queue: NodeId[] = [...seedNodeIds];
  const visited = new Set<NodeId>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) {
      continue;
    }
    visited.add(current);
    const childEdgeIds = snapshot.childrenByParent.get(current) ?? [];
    childEdgeIds.forEach((edgeId) => {
      const edge = snapshot.edges.get(edgeId);
      if (!edge) {
        return;
      }
      if (!forbidden.has(edge.childNodeId)) {
        forbidden.add(edge.childNodeId);
        queue.push(edge.childNodeId);
      }
    });
  }

  return forbidden;
};

type OutlineViewVariant = "standalone" | "embedded";

interface OutlineViewProps {
  readonly paneId: string;
  readonly onVirtualizerChange?: (virtualizer: Virtualizer<HTMLDivElement, Element> | null) => void;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly variant?: OutlineViewVariant;
}

export const OutlineView = ({
  paneId,
  onVirtualizerChange,
  className,
  style,
  variant = "standalone"
}: OutlineViewProps): JSX.Element => {
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
  const { inboxNodeId, journalNodeId } = useOutlineSingletonNodes();
  const sessionStore = useOutlineSessionStore();
  const outlineStore = useOutlineStore();
  const paneIds = useOutlinePaneIds();
  const paneCount = paneIds.length;
  const canClosePane = paneCount > 1;
  const activePaneId = useOutlineActivePaneId();
  const isActivePane = activePaneId === paneId;
  const closePane = usePaneCloser();
  const parentRef = useRef<HTMLDivElement | null>(null);
  const widthRatioNearlyEqual = useCallback((a: number | null, b: number | null): boolean => {
    if (a === b) {
      return true;
    }
    if (a === null || b === null) {
      return false;
    }
    return Math.abs(a - b) < 0.0001;
  }, []);

  const paneWidthRatio = pane?.widthRatio ?? null;

  useLayoutEffect(() => {
    if (!pane) {
      return;
    }
    outlineStore.updatePaneRuntimeState(paneId, (previous) => {
      const base = ensurePaneRuntimeState(paneId, previous);
      if (!widthRatioNearlyEqual(base.widthRatio, paneWidthRatio)) {
        return {
          ...base,
          widthRatio: paneWidthRatio
        };
      }
      return previous ?? base;
    });
  }, [outlineStore, pane, paneId, paneWidthRatio, widthRatioNearlyEqual]);
  const subscribeToRuntime = useCallback(
    (listener: () => void) => outlineStore.subscribe(listener),
    [outlineStore]
  );
  const getRuntimeSnapshot = useCallback(
    () => outlineStore.getPaneRuntimeState(paneId),
    [outlineStore, paneId]
  );
  const paneRuntime = useSyncExternalStore(subscribeToRuntime, getRuntimeSnapshot, getRuntimeSnapshot);
  const runtimeVirtualizerVersion = paneRuntime?.virtualizerVersion ?? 0;
  const previousVirtualizerVersionRef = useRef(runtimeVirtualizerVersion);
  const pendingScrollUpdateRef = useRef<number | null>(null);
  const latestScrollTopRef = useRef(0);
  const flushScrollUpdate = useCallback(() => {
    const scrollTop = latestScrollTopRef.current;
    outlineStore.updatePaneRuntimeState(paneId, (previous) => {
      const base = ensurePaneRuntimeState(paneId, previous);
      if (Math.abs(base.scrollTop - scrollTop) < 1) {
        return previous ?? base;
      }
      return {
        ...base,
        scrollTop
      };
    });
  }, [outlineStore, paneId]);
  const scheduleScrollUpdate = useCallback((scrollTop: number) => {
    latestScrollTopRef.current = scrollTop;
    if (typeof window === "undefined") {
      flushScrollUpdate();
      return;
    }
    if (pendingScrollUpdateRef.current !== null) {
      return;
    }
    pendingScrollUpdateRef.current = window.requestAnimationFrame(() => {
      pendingScrollUpdateRef.current = null;
      flushScrollUpdate();
    });
  }, [flushScrollUpdate]);
  useLayoutEffect(() => {
    if (!paneRuntime) {
      return;
    }
    const element = parentRef.current;
    if (!element) {
      return;
    }
    const nextScrollTop = paneRuntime.scrollTop;
    if (Math.abs(element.scrollTop - nextScrollTop) > 1) {
      element.scrollTop = nextScrollTop;
    }
    latestScrollTopRef.current = element.scrollTop;
  }, [paneRuntime]);
  useEffect(() => {
    return () => {
      if (pendingScrollUpdateRef.current !== null) {
        if (typeof window !== "undefined") {
          window.cancelAnimationFrame(pendingScrollUpdateRef.current);
        }
        pendingScrollUpdateRef.current = null;
        flushScrollUpdate();
      }
      if (onVirtualizerChange) {
        onVirtualizerChange(null);
      }
    };
  }, [flushScrollUpdate, onVirtualizerChange]);
  const containerStyle = useMemo(() => ({
    ...styles.shellBase,
    ...(variant === "embedded" ? styles.shellEmbedded : styles.shellStandalone),
    ...(style ?? {})
  }), [style, variant]);
  const focusOutlineTree = useCallback(() => {
    const element = parentRef.current;
    if (element) {
      element.focus({ preventScroll: true });
    }
  }, []);
  const virtualizerRef = useRef<Virtualizer<HTMLDivElement, Element> | null>(null);
  useEffect(() => {
    if (!paneRuntime) {
      previousVirtualizerVersionRef.current = runtimeVirtualizerVersion;
      return;
    }
    if (previousVirtualizerVersionRef.current === runtimeVirtualizerVersion) {
      return;
    }
    previousVirtualizerVersionRef.current = runtimeVirtualizerVersion;
    virtualizerRef.current?.measure();
  }, [paneRuntime, runtimeVirtualizerVersion]);
  const [pendingCursor, setPendingCursor] = useState<OutlinePendingCursor | null>(null);
  const [activeEditor, setActiveEditor] = useState<CollaborativeEditor | null>(null);
  const [activeTextCell, setActiveTextCell] = useState<
    { edgeId: EdgeId; element: HTMLDivElement }
  | null>(null);
  const [wikiHoverState, setWikiHoverState] = useState<WikiHoverState | null>(null);
  const wikiHoverLockRef = useRef(false);
  const wikiHoverClearTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [wikiEditState, setWikiEditState] = useState<WikiEditState | null>(null);
  const [wikiEditDraft, setWikiEditDraft] = useState("");
  const [mirrorTrackerState, setMirrorTrackerState] = useState<MirrorTrackerState | null>(null);
  const [moveDialogState, setMoveDialogState] = useState<MoveDialogState | null>(null);
  const [focusDialogState, setFocusDialogState] = useState<FocusDialogState | null>(null);
  const [quickNoteDialogOpen, setQuickNoteDialogOpen] = useState(false);
  const [quickNoteValue, setQuickNoteValue] = useState("");
  const [missingInboxDialogOpen, setMissingInboxDialogOpen] = useState(false);
  const [missingJournalDialogOpen, setMissingJournalDialogOpen] = useState(false);
  const [contextColorPalette, setContextColorPalette] = useState<ContextMenuColorPaletteState | null>(null);
  const [datePickerState, setDatePickerState] = useState<DatePickerState | null>(null);
  const skipTreeFocusOnMenuCloseRef = useRef(false);
  const preserveContextColorPaletteOnCloseRef = useRef(false); // Keeps palette open when color commands close the menu.

  const sessionController = usePaneSessionController({ sessionStore, paneId });
  const { setSelectionRange, setCollapsed, setPendingFocusEdgeId } = sessionController;
  const { setSelectedEdgeId, handleFocusEdge, handleClearFocus, handleNavigateHistory } = useOutlineCursorManager({
    paneId,
    paneRootEdgeId: pane?.rootEdgeId ?? null,
    snapshot,
    sessionStore,
    controller: sessionController,
    applyPendingCursor: setPendingCursor
  });

  if (!pane) {
    throw new Error(`Pane ${paneId} not found in session state`);
  }
  const paneSelectionRange = pane.selectionRange;
  const selectedEdgeId = pane.activeEdgeId;
  useEffect(() => {
    if (!selectedEdgeId) {
      return;
    }
    outlineStore.updatePaneRuntimeState(paneId, (previous) => {
      const base = ensurePaneRuntimeState(paneId, previous);
      if (base.lastFocusedEdgeId === selectedEdgeId) {
        return previous ?? base;
      }
      return {
        ...base,
        lastFocusedEdgeId: selectedEdgeId
      };
    });
  }, [outlineStore, paneId, selectedEdgeId]);
  const computeFocusDialogAnchor = useCallback(() => {
    if (activeTextCell?.element) {
      const rect = activeTextCell.element.getBoundingClientRect();
      return {
        left: rect.left,
        bottom: rect.bottom
      };
    }
    if (typeof document !== "undefined" && selectedEdgeId) {
      const rowElement = document.querySelector<HTMLElement>(
        `[data-outline-row="true"][data-edge-id="${selectedEdgeId}"]`
      );
      if (rowElement) {
        const rect = rowElement.getBoundingClientRect();
        return {
          left: rect.left,
          bottom: rect.bottom
        };
      }
    }
    if (parentRef.current) {
      const rect = parentRef.current.getBoundingClientRect();
      return {
        left: rect.left + rect.width / 2 - 160,
        bottom: rect.top + 24
      };
    }
    if (typeof window !== "undefined") {
      return {
        left: window.innerWidth / 2 - 160,
        bottom: window.innerHeight / 2 - 40
      };
    }
    return { left: 180, bottom: 180 };
  }, [activeTextCell, parentRef, selectedEdgeId]);
  const canNavigateBack = pane.focusHistoryIndex > 0;
  const canNavigateForward = pane.focusHistoryIndex < pane.focusHistory.length - 1;

  const parseIsoDate = useCallback((value: string | null): Date | null => {
    if (!value) {
      return null;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }, []);

  const formatDateDisplayText = useCallback(
    (date: Date, hasTime: boolean): string => {
      const userFormat = getUserSetting(outline, "datePillFormat") as string;
      const format = typeof userFormat === "string" && userFormat.length > 0 ? userFormat : "ddd, MMM D";
      const options: Intl.DateTimeFormatOptions = {
        weekday: format.includes("ddd") ? "short" : undefined,
        month: format.includes("MMM") ? "short" : undefined,
        day: format.includes("D") ? "numeric" : undefined,
        hour: hasTime && format.includes("h") ? "numeric" : undefined,
        minute: hasTime && format.includes("mm") ? "2-digit" : undefined,
        hour12: format.includes("a") ? true : undefined
      };
      return new Intl.DateTimeFormat("en-US", options).format(date);
    },
    [outline]
  );

  const handleDateClick = useCallback(
    (payload: OutlineDateClickPayload) => {
      setDatePickerState({
        edgeId: payload.edgeId,
        nodeId: payload.sourceNodeId,
        segmentIndex: payload.segmentIndex ?? null,
        hasTime: payload.hasTime,
        value: payload.value ?? null,
        position: payload.position ?? null,
        anchor: payload.anchor
      });
      if (payload.position) {
        setSelectedEdgeId(payload.edgeId, { preserveRange: true });
      }
    },
    [setSelectedEdgeId]
  );

  const handleDatePickerClose = useCallback(() => {
    setDatePickerState(null);
  }, []);

  const handleDatePickerSelect = useCallback(
    (nextDate: Date) => {
      if (!datePickerState) {
        return;
      }
      const baseDate = new Date(nextDate);
      if (datePickerState.hasTime) {
        const existing = parseIsoDate(datePickerState.value);
        if (existing) {
          baseDate.setUTCHours(
            existing.getUTCHours(),
            existing.getUTCMinutes(),
            existing.getUTCSeconds(),
            existing.getUTCMilliseconds()
          );
        }
      }
      const displayText = formatDateDisplayText(baseDate, datePickerState.hasTime);
      if (datePickerState.position && activeEditor) {
        activeEditor.applyDateTag(baseDate, displayText, datePickerState.hasTime, datePickerState.position);
        setDatePickerState(null);
        return;
      }
      if (datePickerState.segmentIndex != null) {
        updateDateMark(
          outline,
          datePickerState.nodeId,
          datePickerState.segmentIndex,
          {
            date: baseDate,
            displayText,
            hasTime: datePickerState.hasTime
          },
          localOrigin
        );
      }
      setDatePickerState(null);
    },
    [activeEditor, datePickerState, formatDateDisplayText, localOrigin, outline, parseIsoDate]
  );

  const paneSearch = usePaneSearch(paneId, pane);
  const paneOpener = usePaneOpener(paneId);

  const handleTagFilterToggle = useCallback(
    ({ label, trigger }: PaneSearchToggleTagOptions) => {
      paneSearch.toggleTagFilter({ label, trigger });
    },
    [paneSearch]
  );

  const {
    runtime: searchRuntime,
    isActive: isSearchActive,
    toggleExpansion: toggleSearchExpansion,
    registerAppendedEdge: registerSearchAppendedEdge,
    clearResults: clearSearchResults,
    hideInput: hideSearchInput,
    submitted: submittedSearch,
    resultEdgeIds: searchResultEdgeIds
  } = paneSearch;

  const { rows, rowMap, edgeIndexMap, focusContext } = useOutlineRows(snapshot, pane, searchRuntime);

  useEffect(() => {
    if (!datePickerState) {
      return;
    }
    if (!rowMap.has(datePickerState.edgeId)) {
      setDatePickerState(null);
    }
  }, [datePickerState, rowMap]);

  const {
    selectionRange,
    selectionHighlightActive,
    selectedEdgeIds,
    orderedSelectedEdgeIds,
    selectedRow,
    adjacentEdgeIds,
    activeRowSummary,
    selectionAdapter,
    handleDeleteSelection,
    handleCommand: handleSelectionCommand
  } = useOutlineSelection({
    rows,
    edgeIndexMap,
    paneSelectionRange,
    selectedEdgeId,
    outline,
    localOrigin,
    setSelectionRange,
    setSelectedEdgeId,
    setCollapsed,
    onAppendEdge: isSearchActive
      ? (edgeId) => registerSearchAppendedEdge(edgeId)
      : undefined
  });

  const previousSearchSignatureRef = useRef<{
    submitted: string | null;
    resultRef: ReadonlyArray<EdgeId> | null;
  }>({
    submitted: null,
    resultRef: null
  });

  const resetPaneSearch = useCallback(() => {
    clearSearchResults();
    hideSearchInput();
  }, [clearSearchResults, hideSearchInput]);

  const handleVirtualizerChange = useCallback((instance: Virtualizer<HTMLDivElement, Element> | null) => {
    virtualizerRef.current = instance;
    if (onVirtualizerChange) {
      onVirtualizerChange(instance);
    }
  }, [onVirtualizerChange]);

  useEffect(() => {
    const previous = previousSearchSignatureRef.current;
    if (
      previous.submitted === submittedSearch
      && previous.resultRef === searchResultEdgeIds
    ) {
      return;
    }
    previousSearchSignatureRef.current = {
      submitted: submittedSearch ?? null,
      resultRef: searchResultEdgeIds
    };
    virtualizerRef.current?.measure();
  }, [searchResultEdgeIds, submittedSearch]);

  const computeGuidelinePlan = useCallback(
    (edgeId: EdgeId) =>
      planGuidelineCollapse({
        edgeId,
        snapshot,
        rowMap,
        collapsedEdgeIds: pane.collapsedEdgeIds
      }),
    [pane.collapsedEdgeIds, rowMap, snapshot]
  );

  useEffect(() => {
    if (wikiEditState) {
      setWikiEditDraft(wikiEditState.displayText);
    }
  }, [wikiEditState]);

  const clearWikiHoverTimeout = useCallback(() => {
    if (wikiHoverClearTimeoutRef.current !== null) {
      clearTimeout(wikiHoverClearTimeoutRef.current);
      wikiHoverClearTimeoutRef.current = null;
    }
  }, []);

  const scheduleWikiHoverClear = useCallback(() => {
    clearWikiHoverTimeout();
    wikiHoverClearTimeoutRef.current = setTimeout(() => {
      wikiHoverClearTimeoutRef.current = null;
      if (!wikiHoverLockRef.current) {
        setWikiHoverState(null);
      }
    }, 60);
  }, [clearWikiHoverTimeout]);

  useEffect(() => {
    return () => {
      clearWikiHoverTimeout();
      wikiHoverLockRef.current = false;
    };
  }, [clearWikiHoverTimeout]);

  const cleanupPaneAsyncEffects = useCallback(() => {
    if (typeof window !== "undefined" && pendingScrollUpdateRef.current !== null) {
      window.cancelAnimationFrame(pendingScrollUpdateRef.current);
    }
    pendingScrollUpdateRef.current = null;
    flushScrollUpdate();
    clearWikiHoverTimeout();
    wikiHoverLockRef.current = false;
    setWikiHoverState(null);
    setWikiEditState(null);
    setMirrorTrackerState(null);
    setMoveDialogState(null);
    setFocusDialogState(null);
    setDatePickerState(null);
    setQuickNoteDialogOpen(false);
    setContextColorPalette(null);
  }, [clearWikiHoverTimeout, flushScrollUpdate]);

  const handleHeaderClose = useCallback(() => {
    cleanupPaneAsyncEffects();
    if (paneCount <= 1) {
      return;
    }
    closePane(paneId);
  }, [cleanupPaneAsyncEffects, closePane, paneCount, paneId]);

  const handleWikiLinkHoverEvent = useCallback(
    (payload: {
      readonly type: "enter" | "leave";
      readonly edgeId: EdgeId;
      readonly sourceNodeId: NodeId;
      readonly targetNodeId: NodeId;
      readonly displayText: string;
      readonly segmentIndex: number;
      readonly element: HTMLElement;
    }) => {
      if (wikiEditState) {
        return;
      }
      if (payload.type === "enter") {
        if (payload.segmentIndex < 0) {
          return;
        }
        wikiHoverLockRef.current = false;
        clearWikiHoverTimeout();
        setWikiHoverState({
          edgeId: payload.edgeId,
          sourceNodeId: payload.sourceNodeId,
          targetNodeId: payload.targetNodeId,
          displayText: payload.displayText,
          segmentIndex: payload.segmentIndex,
          element: payload.element
        });
        return;
      }
      wikiHoverLockRef.current = false;
      scheduleWikiHoverClear();
    },
    [clearWikiHoverTimeout, scheduleWikiHoverClear, wikiEditState]
  );

  const hoverIconPosition = useMemo(() => {
    if (!wikiHoverState) {
      return null;
    }
    const rect = wikiHoverState.element.getBoundingClientRect();
    return {
      left: rect.right + 6,
      top: rect.top + rect.height / 2 - 9
    };
  }, [wikiHoverState]);

  const parentEdgeIdByEdgeId = useMemo(() => {
    const map = new Map<EdgeId, EdgeId | null>();
    snapshot.rootEdgeIds.forEach((rootEdgeId) => {
      map.set(rootEdgeId, null);
    });
    snapshot.childEdgeIdsByParentEdge.forEach((childEdgeIds, parentEdgeId) => {
      childEdgeIds.forEach((childEdgeId) => {
        map.set(childEdgeId as EdgeId, parentEdgeId);
      });
    });
    return map as ReadonlyMap<EdgeId, EdgeId | null>;
  }, [snapshot]);

  const rootEdgeIdSet = useMemo(() => {
    return new Set<EdgeId>(snapshot.rootEdgeIds);
  }, [snapshot]);

  const childEdgesByNodeId = useMemo(() => {
    const map = new Map<NodeId, EdgeId[]>();
    snapshot.edges.forEach((edge) => {
      const existing = map.get(edge.childNodeId);
      if (existing) {
        existing.push(edge.id);
      } else {
        map.set(edge.childNodeId, [edge.id]);
      }
    });
    return map as ReadonlyMap<NodeId, ReadonlyArray<EdgeId>>;
  }, [snapshot]);

  const resolvePathForEdge = useCallback(
    (edgeId: EdgeId): EdgeId[] => {
      const path: EdgeId[] = [];
      const visited = new Set<EdgeId>();
      let current: EdgeId | null = edgeId;
      while (current) {
        path.push(current);
        if (visited.has(current)) {
          break;
        }
        visited.add(current);
        const parent: EdgeId | null = parentEdgeIdByEdgeId.get(current) ?? null;
        current = parent;
      }
      return path.reverse();
    },
    [parentEdgeIdByEdgeId]
  );

  const resolvePathForNode = useCallback(
    (nodeId: NodeId): EdgeId[] | null => {
      const candidates = childEdgesByNodeId.get(nodeId);
      if (!candidates || candidates.length === 0) {
        return null;
      }
      const canonicalMap = snapshot.canonicalEdgeIdsByEdgeId;
      const sortedCandidates = [...candidates].sort((left, right) => {
        const leftCanonical = canonicalMap.get(left) ?? left;
        const rightCanonical = canonicalMap.get(right) ?? right;
        const leftIsCanonical = leftCanonical === left;
        const rightIsCanonical = rightCanonical === right;
        if (leftIsCanonical !== rightIsCanonical) {
          return leftIsCanonical ? -1 : 1;
        }
        return left.localeCompare(right);
      });
      const ensureRootPath = (path: EdgeId[]): EdgeId[] | null => {
        if (path.length === 0) {
          return null;
        }
        const rootEdgeId = path[0];
        const hasParentEntry = parentEdgeIdByEdgeId.has(rootEdgeId);
        if (!hasParentEntry && !rootEdgeIdSet.has(rootEdgeId)) {
          return null;
        }
        const parent = parentEdgeIdByEdgeId.get(rootEdgeId) ?? null;
        if (parent !== null) {
          return null;
        }
        return path;
      };
      for (const candidate of sortedCandidates) {
        const candidatePath = ensureRootPath(resolvePathForEdge(candidate));
        if (candidatePath) {
          return candidatePath;
        }
        const canonicalEdgeId = canonicalMap.get(candidate);
        if (canonicalEdgeId && canonicalEdgeId !== candidate) {
          const canonicalPath = ensureRootPath(resolvePathForEdge(canonicalEdgeId));
          if (canonicalPath) {
            return canonicalPath;
          }
        }
      }
      return null;
    },
    [childEdgesByNodeId, parentEdgeIdByEdgeId, resolvePathForEdge, rootEdgeIdSet, snapshot.canonicalEdgeIdsByEdgeId]
  );

  const formatPathLabel = useCallback(
    (pathEdgeIds: EdgeId[] | null): string => {
      if (!pathEdgeIds || pathEdgeIds.length === 0) {
        return "Unknown location";
      }
      const segments: string[] = [];
      pathEdgeIds.forEach((edgeId) => {
        const edgeSnapshot = snapshot.edges.get(edgeId);
        if (!edgeSnapshot) {
          return;
        }
        const nodeSnapshot = snapshot.nodes.get(edgeSnapshot.childNodeId);
        const trimmed = nodeSnapshot?.text.trim() ?? "";
        segments.push(trimmed.length > 0 ? trimmed : "Untitled node");
      });
      return segments.join(" / ");
    },
    [snapshot.edges, snapshot.nodes]
  );

  const handleContextMenuEvent = useCallback(
    (event: OutlineContextMenuEvent) => {
      if (event.type === "requestSingletonReassignment") {
        const roleLabel = event.role === "inbox" ? "Inbox" : "Journal";
        const pathEdgeIds = resolvePathForNode(event.currentNodeId);
        const pathLabel = formatPathLabel(pathEdgeIds);
        const message = [
          `Change the ${roleLabel}?`,
          `Current ${roleLabel}: ${pathLabel}`
        ].join("\n");
        const shouldReplace = window.confirm(message);
        if (shouldReplace) {
          event.confirm();
        }
        return;
      }
      if (event.type === "requestMoveDialog") {
        if (event.paneId !== paneId) {
          return;
        }
        const forbidden = collectForbiddenNodeIds(snapshot, event.selection.nodeIds as readonly NodeId[]);
        const orderedEdgeIds = event.selection.orderedEdgeIds as readonly EdgeId[];
        const defaultEdgeId = orderedEdgeIds[0] ?? (event.triggerEdgeId as EdgeId);
        const anchorEdgeId = (event.selection.anchorEdgeId as EdgeId | null) ?? defaultEdgeId;
        const focusEdgeId = (event.selection.focusEdgeId as EdgeId | null) ?? defaultEdgeId;
        setMoveDialogState({
          mode: event.mode,
          anchor: { left: event.anchor.x, bottom: event.anchor.y },
          selection: {
            orderedEdgeIds,
            anchorEdgeId,
            focusEdgeId,
            nodeIds: event.selection.nodeIds as readonly NodeId[]
          },
          forbiddenNodeIds: forbidden,
          query: "",
          insertPosition: "start",
          selectedIndex: 0
        });
      }
    },
    [formatPathLabel, paneId, resolvePathForNode, setMoveDialogState, snapshot]
  );

  const applyContextMenuSelection = useCallback(
    (snapshot: OutlineContextMenuSelectionSnapshot) => {
      const orderedEdgeIds = snapshot.orderedEdgeIds as readonly EdgeId[];
      const primaryEdgeId = (snapshot.primaryEdgeId ?? orderedEdgeIds[orderedEdgeIds.length - 1]) as EdgeId | null;
      if (!primaryEdgeId) {
        return;
      }
      const anchorEdgeId = (snapshot.anchorEdgeId ?? primaryEdgeId) as EdgeId;
      const focusEdgeId = (snapshot.focusEdgeId ?? primaryEdgeId) as EdgeId;
      if (orderedEdgeIds.length > 1 || anchorEdgeId !== focusEdgeId) {
        setSelectionRange({
          anchorEdgeId,
          focusEdgeId
        });
        setSelectedEdgeId(primaryEdgeId, { preserveRange: true });
        return;
      }
      setSelectionRange(null);
      setSelectedEdgeId(primaryEdgeId);
    },
    [setSelectedEdgeId, setSelectionRange]
  );

  const handleOpenContextColorPalette = useCallback(
    (request: OutlineContextMenuColorPaletteRequest) => {
      skipTreeFocusOnMenuCloseRef.current = true;
      preserveContextColorPaletteOnCloseRef.current = true;
      const palette = getColorPalette(outline);
      setContextColorPalette({
        mode: request.colorMode,
        anchor: request.anchor,
        palette,
        request: {
          actionId: request.actionId,
          definition: request.definition,
          nodeIds: request.nodeIds,
          targetHeadingLevel: null,
          selection: request.selection,
          triggerEdgeId: request.triggerEdgeId,
          anchor: request.anchor,
          inlineMark: undefined,
          colorMode: request.colorMode,
          color: undefined
        }
      });
    },
    [outline]
  );

  const handleContextMenuFormattingAction = useCallback(
    (request: OutlineContextMenuFormattingActionRequest) => {
      skipTreeFocusOnMenuCloseRef.current = true;
      const {
        definition,
        targetHeadingLevel,
        triggerEdgeId,
        inlineMark,
        colorMode,
        color,
        nodeIds
      } = request;
      const triggerRow = rowMap.get(triggerEdgeId);
      if (!triggerRow) {
        return;
      }

      if (definition.type === "heading" && definition.headingLevel) {
        const desiredLevel = definition.headingLevel as NodeHeadingLevel;
        const isToggleOff = targetHeadingLevel === null;
        if (activeEditor && triggerRow.edgeId === (activeTextCell?.edgeId ?? null)) {
          activeEditor.toggleHeadingLevel(desiredLevel);
          return;
        }
        const targetLevel = isToggleOff ? null : desiredLevel;
        setNodeHeadingLevel(outline, nodeIds as readonly NodeId[], targetLevel, localOrigin);
        return;
      }

      if (definition.type === "inlineMark" && inlineMark) {
        const markName = INLINE_MARK_NAME_BY_ACTION[inlineMark];
        toggleNodeInlineMark(outline, nodeIds as readonly NodeId[], markName, localOrigin);
        return;
      }

      if (definition.type === "color" && colorMode) {
        if (color === undefined) {
          return;
        }
        const markName = colorMode === "text" ? "textColor" : "backgroundColor";
        setNodeColorMark(outline, nodeIds as readonly NodeId[], markName, color ?? null, localOrigin);
        preserveContextColorPaletteOnCloseRef.current = false;
        setContextColorPalette(null);
      }
    },
    [activeEditor, activeTextCell, localOrigin, outline, rowMap]
  );

  const handleContextColorPaletteClose = useCallback(() => {
    preserveContextColorPaletteOnCloseRef.current = false;
    setContextColorPalette(null);
  }, []);

  const handleContextColorPaletteApply = useCallback(
    (hex: string) => {
      if (!contextColorPalette) {
        return;
      }
      handleContextMenuFormattingAction({
        ...contextColorPalette.request,
        color: hex
      });
    },
    [contextColorPalette, handleContextMenuFormattingAction]
  );

  const handleContextColorPaletteClear = useCallback(() => {
    if (!contextColorPalette) {
      return;
    }
    handleContextMenuFormattingAction({
      ...contextColorPalette.request,
      color: null
    });
  }, [contextColorPalette, handleContextMenuFormattingAction]);

  const persistContextColorPalette = useCallback(
    (mode: ColorPaletteMode, swatches: ReadonlyArray<string>) => {
      const next = replaceColorPalette(outline, mode, swatches, { origin: localOrigin });
      setContextColorPalette((current) =>
        current ? { ...current, palette: next } : current
      );
    },
    [localOrigin, outline]
  );

  const handleContextMenuCursorRequest = useCallback(
    ({ edgeId, clientX, clientY }: { edgeId: EdgeId; clientX: number; clientY: number }) => {
      setPendingCursor({ edgeId, placement: "coords", clientX, clientY });
      setPendingFocusEdgeId(edgeId);
    },
    [setPendingCursor, setPendingFocusEdgeId]
  );

  const contextMenu = useOutlineContextMenu({
    outline,
    origin: localOrigin,
    paneId,
    rows,
    rowMap,
    orderedSelectedEdgeIds,
    selectionRange,
    primarySelectedEdgeId: selectedEdgeId,
    handleCommand: handleSelectionCommand,
    handleDeleteSelection,
    emitEvent: handleContextMenuEvent,
    applySelectionSnapshot: applyContextMenuSelection,
    runFormattingAction: handleContextMenuFormattingAction,
    requestPendingCursor: handleContextMenuCursorRequest,
    openColorPalette: handleOpenContextColorPalette
  });

  const contextMenuState = contextMenu.state;
  const openContextMenu = contextMenu.open;
  const closeContextMenu = contextMenu.close;

  const handleContextMenuClose = useCallback(() => {
    closeContextMenu();
    const shouldSkipTreeFocus = skipTreeFocusOnMenuCloseRef.current;
    const shouldPreservePalette = preserveContextColorPaletteOnCloseRef.current;
    skipTreeFocusOnMenuCloseRef.current = false;
    preserveContextColorPaletteOnCloseRef.current = false;
    if (!shouldPreservePalette) {
      setContextColorPalette(null);
    }
    if (shouldSkipTreeFocus) {
      if (activeEditor) {
        activeEditor.focus();
      }
      return;
    }
    focusOutlineTree();
  }, [activeEditor, closeContextMenu, focusOutlineTree]);

  const focusDialogResults = useMemo(() => {
    if (!focusDialogState) {
      return [] as WikiLinkSearchCandidate[];
    }
    return searchWikiLinkCandidates(snapshot, focusDialogState.query);
  }, [focusDialogState, snapshot]);

  const handleFocusDialogClose = useCallback(() => {
    setFocusDialogState(null);
    focusOutlineTree();
  }, [focusOutlineTree]);

  const handleFocusDialogQueryChange = useCallback((value: string) => {
    setFocusDialogState((prev) => (prev ? { ...prev, query: value, selectedIndex: 0 } : prev));
  }, []);

  const handleFocusDialogHoverIndex = useCallback((index: number) => {
    setFocusDialogState((prev) => (prev ? { ...prev, selectedIndex: index } : prev));
  }, []);

  const handleFocusDialogNavigate = useCallback(
    (direction: 1 | -1) => {
      if (focusDialogResults.length === 0) {
        return;
      }
      setFocusDialogState((prev) => {
        if (!prev) {
          return prev;
        }
        const count = focusDialogResults.length;
        const nextIndex = (prev.selectedIndex + direction + count) % count;
        return { ...prev, selectedIndex: nextIndex };
      });
    },
    [focusDialogResults]
  );

  const handleFocusDialogSelectCandidate = useCallback(
    (candidate: WikiLinkSearchCandidate) => {
      const pathEdgeIds = resolvePathForNode(candidate.nodeId);
      setFocusDialogState(null);
      if (pathEdgeIds && pathEdgeIds.length > 0) {
        resetPaneSearch();
        handleFocusEdge({ edgeId: pathEdgeIds[pathEdgeIds.length - 1], pathEdgeIds });
      }
      focusOutlineTree();
    },
    [focusOutlineTree, handleFocusEdge, resetPaneSearch, resolvePathForNode]
  );

  const handleFocusDialogConfirmSelection = useCallback(() => {
    const state = focusDialogState;
    if (!state || focusDialogResults.length === 0) {
      return;
    }
    const boundedIndex = Math.min(
      Math.max(state.selectedIndex, 0),
      focusDialogResults.length - 1
    );
    const candidate = focusDialogResults[boundedIndex];
    handleFocusDialogSelectCandidate(candidate);
  }, [focusDialogResults, focusDialogState, handleFocusDialogSelectCandidate]);

  const handleFocusDialogOpen = useCallback(() => {
    const anchor = computeFocusDialogAnchor();
    setFocusDialogState({
      anchor,
      query: "",
      selectedIndex: 0
    });
  }, [computeFocusDialogAnchor]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return () => undefined;
    }
    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }
      const key = typeof event.key === "string" ? event.key.toLowerCase() : "";
      if (key !== "k" || (!event.ctrlKey && !event.metaKey) || event.altKey || event.repeat) {
        return;
      }
      const target = event.target;
      if (isTextInputTarget(target)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      handleFocusDialogOpen();
    };
    window.addEventListener("keydown", handleWindowKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleWindowKeyDown, true);
    };
  }, [handleFocusDialogOpen]);

  const handleQuickNoteOpen = useCallback(() => {
    setQuickNoteDialogOpen(true);
    setQuickNoteValue("");
  }, []);

  const handleQuickNoteClose = useCallback(() => {
    setQuickNoteDialogOpen(false);
    setQuickNoteValue("");
    focusOutlineTree();
  }, [focusOutlineTree]);

  const handleQuickNoteSave = useCallback(() => {
    const noteText = quickNoteValue.trim();
    if (!noteText) {
      handleQuickNoteClose();
      return;
    }

    const inboxNodeId = getInboxNodeId(outline);
    let result;

    if (inboxNodeId) {
      // Create as first child of Inbox
      result = addEdge(outline, {
        parentNodeId: inboxNodeId,
        text: noteText,
        position: 0,
        origin: localOrigin
      });
    } else {
      // Create as new root node
      result = addEdge(outline, {
        parentNodeId: null,
        text: noteText,
        position: 0,
        origin: localOrigin
      });
    }

    if (isSearchActive) {
      registerSearchAppendedEdge(result.edgeId);
    }
    setPendingCursor({ edgeId: result.edgeId, placement: "text-end" });
    setPendingFocusEdgeId(result.edgeId);
    setSelectedEdgeId(result.edgeId);
    handleQuickNoteClose();
  }, [
    quickNoteValue,
    outline,
    localOrigin,
    isSearchActive,
    registerSearchAppendedEdge,
    setPendingCursor,
    setPendingFocusEdgeId,
    setSelectedEdgeId,
    handleQuickNoteClose
  ]);

  const handleFocusInbox = useCallback(() => {
    const inboxNodeId = getInboxNodeId(outline);
    if (!inboxNodeId) {
      setMissingInboxDialogOpen(true);
      return;
    }
    
    const pathEdgeIds = resolvePathForNode(inboxNodeId);
    if (!pathEdgeIds || pathEdgeIds.length === 0) {
      return; // Could not resolve path to Inbox
    }
    
    resetPaneSearch();
    handleFocusEdge({ edgeId: pathEdgeIds[pathEdgeIds.length - 1], pathEdgeIds });
    focusOutlineTree();
  }, [outline, resolvePathForNode, resetPaneSearch, handleFocusEdge, focusOutlineTree]);

  const handleFocusJournal = useCallback(() => {
    const journalNodeId = getJournalNodeId(outline);
    if (!journalNodeId) {
      setMissingJournalDialogOpen(true);
      return;
    }
    
    const pathEdgeIds = resolvePathForNode(journalNodeId);
    if (!pathEdgeIds || pathEdgeIds.length === 0) {
      return; // Could not resolve path to Journal
    }
    
    resetPaneSearch();
    handleFocusEdge({ edgeId: pathEdgeIds[pathEdgeIds.length - 1], pathEdgeIds });
    focusOutlineTree();
  }, [outline, resolvePathForNode, resetPaneSearch, handleFocusEdge, focusOutlineTree]);

  const handleInsertSiblingAbove = useCallback(() => {
    if (!selectedEdgeId) {
      return; // No node selected
    }
    
    const result = insertSiblingAbove({ outline, origin: localOrigin }, selectedEdgeId);
    
    if (isSearchActive) {
      registerSearchAppendedEdge(result.edgeId);
    }
    setPendingCursor({ edgeId: result.edgeId, placement: "text-start" });
    setPendingFocusEdgeId(result.edgeId);
    setSelectedEdgeId(result.edgeId);
  }, [
    selectedEdgeId,
    outline,
    localOrigin,
    isSearchActive,
    registerSearchAppendedEdge,
    setPendingCursor,
    setPendingFocusEdgeId,
    setSelectedEdgeId
  ]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return () => undefined;
    }
    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }
      const key = typeof event.key === "string" ? event.key.toLowerCase() : "";
      if (key !== "n" || !event.altKey || event.ctrlKey || event.metaKey || event.repeat) {
        return;
      }
      const target = event.target;
      if (isTextInputTarget(target)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      handleQuickNoteOpen();
    };
    window.addEventListener("keydown", handleWindowKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleWindowKeyDown, true);
    };
  }, [handleQuickNoteOpen]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return () => undefined;
    }
    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }
      const key = typeof event.key === "string" ? event.key.toLowerCase() : "";
      if (key !== "i" || !event.altKey || !event.ctrlKey || event.metaKey || event.repeat) {
        return;
      }
      const target = event.target;
      if (isTextInputTarget(target)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      handleFocusInbox();
    };
    window.addEventListener("keydown", handleWindowKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleWindowKeyDown, true);
    };
  }, [handleFocusInbox]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return () => undefined;
    }
    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }
      const key = typeof event.key === "string" ? event.key.toLowerCase() : "";
      if (key !== "j" || !event.altKey || !event.ctrlKey || event.metaKey || event.repeat) {
        return;
      }
      const target = event.target;
      if (isTextInputTarget(target)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      handleFocusJournal();
    };
    window.addEventListener("keydown", handleWindowKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleWindowKeyDown, true);
    };
  }, [handleFocusJournal]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return () => undefined;
    }
    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }
      const key = typeof event.key === "string" ? event.key.toLowerCase() : "";
      if (key !== "n" || event.repeat || event.altKey || !(event.metaKey || event.ctrlKey)) {
        return;
      }
      const target = event.target;
      if (isTextInputTarget(target)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const sessionState = sessionStore.getState();
      const paneState = sessionState.panesById[paneId];
      const activeEdgeId = paneState?.activeEdgeId ?? null;
      const result = withTransaction(outline, () =>
        activeEdgeId
          ? insertSiblingBelow({ outline, origin: localOrigin }, activeEdgeId)
          : insertRootNode({ outline, origin: localOrigin })
      );
      const pathEdgeIds = resolvePathForEdge(result.edgeId);
      const finalPath = pathEdgeIds.length > 0 ? pathEdgeIds : [result.edgeId];
      paneOpener.openPaneForEdge(result.edgeId, finalPath);
      if (isSearchActive) {
        registerSearchAppendedEdge(result.edgeId);
      }
    };
    window.addEventListener("keydown", handleWindowKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleWindowKeyDown, true);
    };
  }, [
    isSearchActive,
    localOrigin,
    outline,
    paneId,
    paneOpener,
    registerSearchAppendedEdge,
    resolvePathForEdge,
    sessionStore
  ]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return () => undefined;
    }
    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }
      const key = typeof event.key === "string" ? event.key.toLowerCase() : "";
      if (key !== "a" || !event.altKey || event.ctrlKey || event.metaKey || event.repeat) {
        return;
      }
      const target = event.target;
      if (isTextInputTarget(target)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      handleInsertSiblingAbove();
    };
    window.addEventListener("keydown", handleWindowKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleWindowKeyDown, true);
    };
  }, [handleInsertSiblingAbove]);

  const moveDialogResults = useMemo(() => {
    if (!moveDialogState) {
      return [] as MoveTargetCandidate[];
    }
    return searchMoveTargets(snapshot, moveDialogState.query, {
      forbiddenNodeIds: moveDialogState.forbiddenNodeIds
    });
  }, [moveDialogState, snapshot]);

  const handleMoveDialogClose = useCallback(() => {
    setMoveDialogState(null);
    focusOutlineTree();
  }, [focusOutlineTree]);

  const handleMoveDialogQueryChange = useCallback((value: string) => {
    setMoveDialogState((prev) => (prev ? { ...prev, query: value, selectedIndex: 0 } : prev));
  }, []);

  const handleMoveDialogPositionChange = useCallback((nextPosition: MoveToInsertionPosition) => {
    setMoveDialogState((prev) => (prev ? { ...prev, insertPosition: nextPosition } : prev));
  }, []);

  const handleMoveDialogHoverIndex = useCallback((index: number) => {
    setMoveDialogState((prev) => (prev ? { ...prev, selectedIndex: index } : prev));
  }, []);

  const handleMoveDialogNavigate = useCallback(
    (direction: 1 | -1) => {
      if (moveDialogResults.length === 0) {
        return;
      }
      setMoveDialogState((prev) => {
        if (!prev) {
          return prev;
        }
        const count = moveDialogResults.length;
        const nextIndex = (prev.selectedIndex + direction + count) % count;
        return { ...prev, selectedIndex: nextIndex };
      });
    },
    [moveDialogResults]
  );

  const handleMoveDialogSelectCandidate = useCallback(
    (candidate: MoveTargetCandidate) => {
      setMoveDialogState((current) => {
        if (!current) {
          return current;
        }
        if (current.mode === "move") {
          const edgeIds = current.selection.orderedEdgeIds as readonly EdgeId[];
          if (edgeIds.length === 0) {
            focusOutlineTree();
            return null;
          }
          const result = moveEdgesToParent(
            { outline, origin: localOrigin },
            edgeIds,
            candidate.parentNodeId,
            current.insertPosition
          );
          if (result) {
            setSelectedEdgeId(edgeIds[0]);
            setSelectionRange({
              anchorEdgeId: current.selection.anchorEdgeId,
              focusEdgeId: current.selection.focusEdgeId
            });
            focusOutlineTree();
          } else {
            focusOutlineTree();
          }
          return null;
        }
        const nodeIds = current.selection.nodeIds as readonly NodeId[];
        if (nodeIds.length === 0) {
          focusOutlineTree();
          return null;
        }
        const results = mirrorNodesToParent(
          { outline, origin: localOrigin },
          nodeIds,
          candidate.parentNodeId,
          current.insertPosition
        );
        if (results && results.length > 0) {
          const primary = results[0];
          setSelectedEdgeId(primary.edgeId);
          setSelectionRange({
            anchorEdgeId: primary.edgeId,
            focusEdgeId: primary.edgeId
          });
          focusOutlineTree();
        } else {
          focusOutlineTree();
        }
        return null;
      });
    },
    [focusOutlineTree, localOrigin, outline, setSelectedEdgeId, setSelectionRange]
  );

  const handleMoveDialogConfirmSelection = useCallback(() => {
    const state = moveDialogState;
    if (!state || moveDialogResults.length === 0) {
      return;
    }
    const boundedIndex = Math.min(
      Math.max(state.selectedIndex, 0),
      moveDialogResults.length - 1
    );
    const candidate = moveDialogResults[boundedIndex];
    handleMoveDialogSelectCandidate(candidate);
  }, [handleMoveDialogSelectCandidate, moveDialogResults, moveDialogState]);

  const handleWikiLinkNavigate = useCallback(
    (targetNodeId: NodeId) => {
      const path = resolvePathForNode(targetNodeId);
      if (!path) {
        return;
      }
      resetPaneSearch();
      handleFocusEdge({ edgeId: path[path.length - 1], pathEdgeIds: path });
    },
    [handleFocusEdge, resetPaneSearch, resolvePathForNode]
  );

  const buildMirrorTrackerEntries = useCallback(
    (nodeId: NodeId): MirrorTrackerEntry[] => {
      const placements: MirrorTrackerEntry[] = [];
      snapshot.edges.forEach((edge) => {
        if (edge.childNodeId !== nodeId) {
          return;
        }
        if (edge.id !== edge.canonicalEdgeId) {
          // Mirror projections reuse the canonical edge id, so filtering here surfaces each logical
          // placement once regardless of how many projected child edges exist under mirror parents.
          return;
        }
        const pathEdgeIds = resolvePathForEdge(edge.id);
        if (pathEdgeIds.length === 0) {
          return;
        }
        const pathSegments = pathEdgeIds.map((pathEdgeId) => {
          const pathEdge = snapshot.edges.get(pathEdgeId);
          const nodeSnapshot = pathEdge ? snapshot.nodes.get(pathEdge.childNodeId) : null;
          const labelText = nodeSnapshot?.text.trim();
          return {
            edgeId: pathEdgeId,
            label: labelText && labelText.length > 0 ? labelText : "Untitled node"
          };
        });
        const pathLabel = pathSegments.map((segment) => segment.label).join(" / ");
        placements.push({
          edgeId: edge.id,
          canonicalEdgeId: edge.canonicalEdgeId,
          isOriginal: edge.mirrorOfNodeId === null,
          pathEdgeIds,
          pathSegments,
          pathLabel
        });
      });
      placements.sort((a, b) => {
        if (a.isOriginal && !b.isOriginal) {
          return -1;
        }
        if (!a.isOriginal && b.isOriginal) {
          return 1;
        }
        return a.pathLabel.localeCompare(b.pathLabel);
      });
      return placements;
    },
    [resolvePathForEdge, snapshot]
  );

  const mirrorTrackerEntries = useMemo(() => {
    if (!mirrorTrackerState) {
      return null;
    }
    return buildMirrorTrackerEntries(mirrorTrackerState.nodeId);
  }, [buildMirrorTrackerEntries, mirrorTrackerState]);

  const mirrorTrackerDialogEntries = useMemo<MirrorTrackerDialogEntry[] | null>(() => {
    if (!mirrorTrackerEntries) {
      return null;
    }
    return mirrorTrackerEntries.map((entry) => ({
      edgeId: entry.edgeId,
      isOriginal: entry.isOriginal,
      isSource: mirrorTrackerState?.sourceEdgeId === entry.edgeId,
      pathLabel: entry.pathLabel,
      pathSegments: entry.pathSegments
    }));
  }, [mirrorTrackerEntries, mirrorTrackerState]);

  const dismissMirrorTracker = useCallback(() => {
    setMirrorTrackerState(null);
    focusOutlineTree();
  }, [focusOutlineTree]);

  useEffect(() => {
    if (!mirrorTrackerState) {
      return;
    }
    if (!mirrorTrackerDialogEntries || mirrorTrackerDialogEntries.length === 0) {
      dismissMirrorTracker();
    }
  }, [dismissMirrorTracker, mirrorTrackerDialogEntries, mirrorTrackerState]);

  const handleMirrorIndicatorClick = useCallback(
    ({ row, target }: OutlineMirrorIndicatorClickPayload) => {
      const rect = target.getBoundingClientRect();
      const estimatedWidth = 340;
      const anchorLeft = Math.max(rect.left - estimatedWidth - 16, 16);
      const anchorTop = Math.max(rect.top - 24, 16);
      setMirrorTrackerState((current) => {
        if (current && current.sourceEdgeId === row.edgeId) {
          return null;
        }
        return {
          anchor: {
            left: anchorLeft,
            top: anchorTop
          },
          nodeId: row.nodeId,
          sourceEdgeId: row.edgeId
        };
      });
    },
    []
  );

  const handleMirrorPlacementSelect = useCallback(
    (edgeId: EdgeId) => {
      if (!mirrorTrackerEntries) {
        return;
      }
      const entry = mirrorTrackerEntries.find((candidate) => candidate.edgeId === edgeId);
      if (!entry) {
        return;
      }
      handleFocusEdge({ edgeId: entry.edgeId, pathEdgeIds: entry.pathEdgeIds });
      selectionAdapter.setPrimaryEdgeId(entry.edgeId);
      dismissMirrorTracker();
    },
    [dismissMirrorTracker, handleFocusEdge, mirrorTrackerEntries, selectionAdapter]
  );

  const handleWikiEditOpen = useCallback(() => {
    if (!wikiHoverState) {
      return;
    }
    const rect = wikiHoverState.element.getBoundingClientRect();
    setWikiEditState({
      edgeId: wikiHoverState.edgeId,
      sourceNodeId: wikiHoverState.sourceNodeId,
      targetNodeId: wikiHoverState.targetNodeId,
      segmentIndex: wikiHoverState.segmentIndex,
      displayText: wikiHoverState.displayText,
      anchor: {
        left: rect.right + 8,
        top: rect.bottom + 8
      }
    });
    wikiHoverLockRef.current = false;
    clearWikiHoverTimeout();
    setWikiHoverState(null);
  }, [clearWikiHoverTimeout, wikiHoverState]);

  const handleWikiEditCancel = useCallback(() => {
    wikiHoverLockRef.current = false;
    clearWikiHoverTimeout();
    setWikiEditState(null);
    setWikiEditDraft("");
    focusOutlineTree();
  }, [clearWikiHoverTimeout, focusOutlineTree]);

  const handleWikiEditCommit = useCallback(() => {
    if (!wikiEditState) {
      return;
    }
    if (wikiEditDraft.trim().length === 0) {
      return;
    }
    updateWikiLinkDisplayText(
      outline,
      wikiEditState.sourceNodeId,
      wikiEditState.segmentIndex,
      wikiEditDraft,
      localOrigin
    );
    wikiHoverLockRef.current = false;
    clearWikiHoverTimeout();
    setWikiEditState(null);
    setWikiEditDraft("");
    focusOutlineTree();
  }, [clearWikiHoverTimeout, focusOutlineTree, localOrigin, outline, wikiEditDraft, wikiEditState]);

  const wikiEditTargetLabel = useMemo(() => {
    if (!wikiEditState) {
      return "";
    }
    const node = snapshot.nodes.get(wikiEditState.targetNodeId);
    if (!node) {
      return "Unknown node";
    }
    const trimmed = node.text.trim();
    return trimmed.length > 0 ? node.text : "Untitled node";
  }, [snapshot, wikiEditState]);

  const {
    activeDrag,
    hoveredGuidelineEdgeId,
    handleGuidelinePointerEnter,
    handleGuidelinePointerLeave,
    handleGuidelineClick,
    handleRowPointerDownCapture,
    handleRowMouseDown,
    handleDragHandlePointerDown
  } = useOutlineDragAndDrop({
    paneId,
    outline,
    localOrigin,
    snapshot,
    rowMap,
    edgeIndexMap,
    orderedSelectedEdgeIds,
    selectedEdgeIds,
    selectionRange,
    setSelectionRange,
    setSelectedEdgeId,
    setPendingCursor,
    setPendingFocusEdgeId,
    setCollapsed,
    isEditorEvent: isEditorEventTarget,
    parentRef,
    computeGuidelinePlan
  });

  useEffect(() => {
    const container = parentRef.current;
    if (!container) {
      return;
    }
    container.setAttribute("data-outline-pane-root", "true");
    container.setAttribute("data-outline-pane-id", paneId);
    return () => {
      container.removeAttribute("data-outline-pane-root");
      container.removeAttribute("data-outline-pane-id");
    };
  }, [paneId, parentRef]);

  const getGuidelineLabel = useCallback(
    (edgeId: EdgeId) => {
      const ancestorRow = rowMap.get(edgeId);
      if (!ancestorRow) {
        return "Toggle children";
      }
      const trimmed = ancestorRow.text.trim();
      if (trimmed.length === 0) {
        return "Toggle children";
      }
      return `Toggle children of ${trimmed}`;
    },
    [rowMap]
  );

  const handleRowContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>, edgeId: EdgeId) => {
      const alreadySelected = selectedEdgeIds.has(edgeId);
      const selectionOverride = alreadySelected ? undefined : [edgeId] as const;
      if (!alreadySelected) {
        setSelectionRange(null);
        setSelectedEdgeId(edgeId);
      }
      openContextMenu({
        anchor: { x: event.clientX, y: event.clientY },
        triggerEdgeId: edgeId,
        selectionOverride
      });
    },
    [openContextMenu, selectedEdgeIds, setSelectedEdgeId, setSelectionRange]
  );

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (isEditorEventTarget(event.target)) {
      return;
    }

    const key = typeof event.key === "string" ? event.key.toLowerCase() : "";
    const isFocusShortcut =
      key === "k" && (event.ctrlKey || event.metaKey) && !event.altKey && !event.repeat;
    if (isFocusShortcut) {
      event.preventDefault();
      handleFocusDialogOpen();
      return;
    }

    // Alt+D: Open today's journal entry (prevent browser's address bar focus)
    const isJournalTodayShortcut = key === "d" && event.altKey && !event.ctrlKey && !event.metaKey && !event.repeat;
    if (isJournalTodayShortcut) {
      event.preventDefault();
      // Notify shell-level handler to navigate/create today's journal entry
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("thortiq:journal-today"));
      }
      return;
    }

    const match = matchOutlineCommand(event, outlineCommandDescriptors);
    if (!match) {
      return;
    }

    const handled = handleSelectionCommand(match.descriptor.id);
    if (handled) {
      event.preventDefault();
    }
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
    setPendingFocusEdgeId(null);
  }, [setPendingFocusEdgeId]);

  // If a pending focus edge is set by higher-level navigation (e.g., Journal jump), ensure the editor
  // places the caret at the start of that node's text once it becomes the selected edge.
  useEffect(() => {
    if (!pane.pendingFocusEdgeId) {
      return;
    }
    if (pane.pendingFocusEdgeId !== selectedEdgeId) {
      return;
    }
    // Request text-start cursor for the pending focus edge
    setPendingCursor({ edgeId: pane.pendingFocusEdgeId, placement: "text-start" });
  }, [pane.pendingFocusEdgeId, selectedEdgeId]);

  const handleToggleCollapsed = useCallback(
    (edgeId: EdgeId, collapsed?: boolean) => {
      const targetRow = rowMap.get(edgeId);
      if (!targetRow) {
        return;
      }
      if (targetRow.search) {
        toggleSearchExpansion(edgeId);
        return;
      }
      const nextCollapsed = collapsed ?? !targetRow.collapsed;
      setCollapsed(edgeId, nextCollapsed);
    },
    [rowMap, setCollapsed, toggleSearchExpansion]
  );

  const handleToggleTodo = useCallback(
    (edgeId: EdgeId) => {
      toggleTodoDoneCommand({ outline, origin: localOrigin }, [edgeId]);
    },
    [localOrigin, outline]
  );

  const handleCreateNode = useCallback(() => {
    const result = focusContext
      ? insertChild({ outline, origin: localOrigin }, focusContext.edge.id)
      : insertRootNode({ outline, origin: localOrigin });

    if (isSearchActive) {
      registerSearchAppendedEdge(result.edgeId);
    }
    setPendingCursor({ edgeId: result.edgeId, placement: "text-end" });
    setPendingFocusEdgeId(result.edgeId);
    setSelectedEdgeId(result.edgeId);
  }, [focusContext, isSearchActive, localOrigin, outline, registerSearchAppendedEdge, setPendingFocusEdgeId, setSelectedEdgeId]);

  const editorEnabled = !isTestFallback || prosemirrorTestsEnabled;
  const onActiveTextCellChange = editorEnabled ? handleActiveTextCellChange : undefined;

  // Ensure TanStack recalculates row heights when the editor host changes so translateY stays in sync.
  useLayoutEffect(() => {
    if (isTestFallback) {
      return;
    }
    virtualizerRef.current?.measure();
  }, [isTestFallback, activeTextCell]);

  const handleHeaderNavigateHistory = useCallback(
    (direction: FocusHistoryDirection) => {
      resetPaneSearch();
      handleNavigateHistory(direction);
    },
    [handleNavigateHistory, resetPaneSearch]
  );

  const handleHeaderFocusEdge = useCallback(
    (payload: FocusPanePayload) => {
      resetPaneSearch();
      handleFocusEdge(payload);
    },
    [handleFocusEdge, resetPaneSearch]
  );

  const handleHeaderClearFocus = useCallback(
    (options?: { preserveSearch?: boolean }) => {
      if (!options?.preserveSearch) {
        resetPaneSearch();
      }
      handleClearFocus();
    },
    [handleClearFocus, resetPaneSearch]
  );

  const renderOutlineRow = ({ row }: OutlineVirtualRowRendererProps): JSX.Element => {
    const isSelected = selectedEdgeIds.has(row.edgeId);
    const isPrimarySelected = row.edgeId === selectedEdgeId;
    const highlight = isSelected && selectionHighlightActive;
    const dropIndicator = activeDrag?.plan?.indicator?.edgeId === row.edgeId
      ? activeDrag.plan.indicator
      : null;
    const singletonRole = row.nodeId === inboxNodeId
      ? "inbox"
      : row.nodeId === journalNodeId
        ? "journal"
        : null;

    return (
      <OutlineRowView
        row={row}
        isSelected={isSelected}
        isPrimarySelected={isPrimarySelected}
        onFocusEdge={handleFocusEdge}
        highlightSelected={highlight}
        editorAttachedEdgeId={activeTextCell?.edgeId ?? null}
        isActivePane={isActivePane}
        onSelect={setSelectedEdgeId}
        onToggleCollapsed={handleToggleCollapsed}
        onToggleTodo={handleToggleTodo}
        onRowPointerDownCapture={handleRowPointerDownCapture}
        onRowMouseDown={handleRowMouseDown}
        onRowContextMenu={handleRowContextMenu}
        onDragHandlePointerDown={handleDragHandlePointerDown}
        onActiveTextCellChange={onActiveTextCellChange}
        editorEnabled={editorEnabled}
        presence={presenceByEdgeId.get(row.edgeId) ?? EMPTY_PRESENCE}
        dropIndicator={dropIndicator}
        hoveredGuidelineEdgeId={hoveredGuidelineEdgeId}
        onGuidelinePointerEnter={handleGuidelinePointerEnter}
        onGuidelinePointerLeave={handleGuidelinePointerLeave}
        onGuidelineClick={handleGuidelineClick}
        getGuidelineLabel={getGuidelineLabel}
        onMirrorIndicatorClick={handleMirrorIndicatorClick}
        activeMirrorIndicatorEdgeId={mirrorTrackerState?.sourceEdgeId ?? null}
        singletonRole={singletonRole}
        onWikiLinkClick={({ targetNodeId, event }) => {
          const pathEdgeIds = resolvePathForNode(targetNodeId);
          const handled = pathEdgeIds && pathEdgeIds.length > 0
            ? paneOpener.handleWikiLinkActivate({
                event,
                targetEdgeId: pathEdgeIds[pathEdgeIds.length - 1],
                pathEdgeIds
              })
            : false;
          if (!handled) {
            handleWikiLinkNavigate(targetNodeId);
          }
        }}
        onWikiLinkHover={handleWikiLinkHoverEvent}
        onTagClick={({ label, trigger }) => {
          handleTagFilterToggle({ label, trigger });
        }}
        onBulletActivate={({ edgeId, pathEdgeIds, event }) =>
          paneOpener.handleBulletActivate({ edgeId, pathEdgeIds, event })
        }
        onDateClick={handleDateClick}
      />
    );
  };

  const listFooter = (
    <NewNodeButton
      onCreate={handleCreateNode}
      style={isTestFallback ? styles.newNodeButtonStatic : undefined}
    />
  );

  const dragPreview = activeDrag && Number.isFinite(activeDrag.pointerX) && Number.isFinite(activeDrag.pointerY)
    ? (
        <div
          style={{
            ...styles.dragPreview,
            left: `${activeDrag.pointerX + 12}px`,
            top: `${activeDrag.pointerY + 16}px`
          }}
          aria-hidden
        >
          {activeDrag.draggedEdgeIds.length}
        </div>
      )
    : null;

  const wikiEditButton = !wikiEditState && hoverIconPosition ? (
    <button
      type="button"
      style={{
        ...styles.wikiEditButton,
        left: `${hoverIconPosition.left}px`,
        top: `${hoverIconPosition.top}px`
      }}
      onClick={handleWikiEditOpen}
      onMouseEnter={() => {
        wikiHoverLockRef.current = true;
        clearWikiHoverTimeout();
      }}
      onMouseLeave={() => {
        wikiHoverLockRef.current = false;
        scheduleWikiHoverClear();
      }}
      aria-label="Edit wiki link"
    >
      ✎
    </button>
  ) : null;

  const wikiEditDialog = wikiEditState ? (
    <WikiLinkEditDialog
      anchor={wikiEditState.anchor}
      displayText={wikiEditDraft}
      targetLabel={wikiEditTargetLabel}
      onChange={setWikiEditDraft}
      onCommit={handleWikiEditCommit}
      onCancel={handleWikiEditCancel}
    />
  ) : null;

  const mirrorTrackerDialogNode =
    mirrorTrackerState && mirrorTrackerDialogEntries && mirrorTrackerDialogEntries.length > 0
      ? (
          <MirrorTrackerDialog
            anchor={mirrorTrackerState.anchor}
            entries={mirrorTrackerDialogEntries}
            onSelect={handleMirrorPlacementSelect}
            onClose={dismissMirrorTracker}
          />
          )
      : null;

  const contextMenuNode = contextMenuState ? (
      <OutlineContextMenu
      anchor={contextMenuState.anchor}
      nodes={contextMenuState.nodes}
      executionContext={contextMenuState.executionContext}
      onClose={handleContextMenuClose}
      />
  ) : null;

  const moveDialogNode = moveDialogState
    ? (
        <MoveToDialog
          anchor={moveDialogState.anchor}
          query={moveDialogState.query}
          results={moveDialogResults}
          selectedIndex={moveDialogResults.length === 0
            ? 0
            : Math.min(moveDialogState.selectedIndex, moveDialogResults.length - 1)}
          insertPosition={moveDialogState.insertPosition}
          mode={moveDialogState.mode}
          onQueryChange={handleMoveDialogQueryChange}
          onSelect={handleMoveDialogSelectCandidate}
          onHoverIndexChange={handleMoveDialogHoverIndex}
          onRequestClose={handleMoveDialogClose}
          onNavigate={handleMoveDialogNavigate}
          onConfirmSelection={handleMoveDialogConfirmSelection}
          onPositionChange={handleMoveDialogPositionChange}
        />
      )
    : null;

  const focusDialogNode = focusDialogState
    ? (
        <FocusNodeDialog
          anchor={focusDialogState.anchor}
          query={focusDialogState.query}
          results={focusDialogResults}
          selectedIndex={
            focusDialogResults.length === 0
              ? 0
              : Math.min(focusDialogState.selectedIndex, focusDialogResults.length - 1)
          }
          onQueryChange={handleFocusDialogQueryChange}
          onSelect={handleFocusDialogSelectCandidate}
          onHoverIndexChange={handleFocusDialogHoverIndex}
          onRequestClose={handleFocusDialogClose}
          onNavigate={handleFocusDialogNavigate}
          onConfirmSelection={handleFocusDialogConfirmSelection}
        />
      )
    : null;

  const shouldRenderActiveEditor = editorEnabled;

  return (
    <section className={className} style={containerStyle}>
      <OutlineHeader
        focus={focusContext}
        canNavigateBack={canNavigateBack}
        canNavigateForward={canNavigateForward}
        onNavigateHistory={handleHeaderNavigateHistory}
        onFocusEdge={handleHeaderFocusEdge}
        onClearFocus={handleHeaderClearFocus}
        search={paneSearch}
        isActive={isActivePane}
        canClose={canClosePane}
        onClose={handleHeaderClose}
      />
      <OutlineVirtualList
        rows={rows}
        scrollParentRef={parentRef}
        renderRow={renderOutlineRow}
        virtualizationDisabled={isTestFallback}
        estimatedRowHeight={ESTIMATED_ROW_HEIGHT}
        overscan={8}
        initialRect={{
          width: 960,
          height: CONTAINER_HEIGHT
        }}
        onVirtualizerChange={handleVirtualizerChange}
        scrollContainerProps={{
          tabIndex: 0,
          onKeyDown: handleKeyDown,
          onScroll: () => {
            wikiHoverLockRef.current = false;
            clearWikiHoverTimeout();
            setWikiHoverState(null);
            const element = parentRef.current;
            if (element) {
              scheduleScrollUpdate(element.scrollTop);
            }
          },
          role: "tree",
          "aria-label": "Outline",
          style: styles.scrollContainer
        }}
        footer={listFooter}
      />
      {shouldRenderActiveEditor ? (
        <ActiveNodeEditor
          paneId={paneId}
          isActive={isActivePane}
          nodeId={selectedRow?.nodeId ?? null}
          container={activeTextCell?.element ?? null}
          outlineSnapshot={snapshot}
          pendingCursor={
            pendingCursor?.edgeId && pendingCursor.edgeId === selectedEdgeId ? pendingCursor : null
          }
          onPendingCursorHandled={handlePendingCursorHandled}
          selectionAdapter={selectionAdapter}
          activeRow={activeRowSummary}
          onDeleteSelection={handleDeleteSelection}
        previousVisibleEdgeId={adjacentEdgeIds.previous}
        nextVisibleEdgeId={adjacentEdgeIds.next}
        onWikiLinkNavigate={handleWikiLinkNavigate}
        onWikiLinkHover={handleWikiLinkHoverEvent}
        onAppendEdge={isSearchActive ? registerSearchAppendedEdge : undefined}
        onTagClick={handleTagFilterToggle}
        onEditorInstanceChange={setActiveEditor}
        onDateClick={handleDateClick}
      />
      ) : null}
      {dragPreview}
      {wikiEditButton}
      {wikiEditDialog}
      {mirrorTrackerDialogNode}
      {contextMenuNode}
      {focusDialogNode}
      {moveDialogNode}
      {datePickerState ? (
        <DatePickerPopover
          anchor={datePickerState.anchor}
          value={parseIsoDate(datePickerState.value)}
          onSelect={handleDatePickerSelect}
          onClose={handleDatePickerClose}
        />
      ) : null}
      <QuickNoteDialog
        isOpen={quickNoteDialogOpen}
        value={quickNoteValue}
        onValueChange={setQuickNoteValue}
        onSave={handleQuickNoteSave}
        onClose={handleQuickNoteClose}
      />
      <MissingNodeDialog
        isOpen={missingInboxDialogOpen}
        nodeType="Inbox"
        onClose={() => setMissingInboxDialogOpen(false)}
      />
      <MissingNodeDialog
        isOpen={missingJournalDialogOpen}
        nodeType="Journal"
        onClose={() => setMissingJournalDialogOpen(false)}
      />
      {contextColorPalette ? (
        <div
          style={{
            position: "fixed",
            left: contextColorPalette.anchor.x,
            top: contextColorPalette.anchor.y,
            zIndex: 95,
            pointerEvents: "none"
          }}
        >
          <div style={{ position: "relative", pointerEvents: "auto" }}>
            <ColorPalettePopover
              mode={contextColorPalette.mode}
              palette={contextColorPalette.palette}
              onApplyColor={handleContextColorPaletteApply}
              onClearColor={handleContextColorPaletteClear}
              onClose={handleContextColorPaletteClose}
              onPersistPalette={persistContextColorPalette}
            />
          </div>
        </div>
      ) : null}
    </section>
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

const styles: Record<string, CSSProperties> = {
  shellBase: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    width: "100%",
    maxWidth: "100%",
    minWidth: 0,
    minHeight: 0,
    overflow: "hidden",
    margin: 0,
    boxSizing: "border-box",
    fontFamily: FONT_FAMILY_STACK
  },
  shellStandalone: {
    padding: "0 1.5rem"
  },
  shellEmbedded: {
    padding: 0
  },
  scrollContainer: {
    borderRadius: "0.75rem",
    overflow: "auto",
    flex: 1,
    minHeight: 0,
    background: "#ffffff",
    position: "relative",
    paddingLeft: "0.75rem",
    paddingRight: "0.75rem",
    scrollbarGutter: "stable"
  },
  dragPreview: {
    position: "fixed",
    zIndex: 1000,
    minWidth: "2rem",
    minHeight: "2rem",
    borderRadius: "9999px",
    backgroundColor: "rgba(17, 24, 39, 0.88)",
    color: "#ffffff",
    fontSize: "0.85rem",
    fontWeight: 700,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    pointerEvents: "none",
    boxShadow: "0 10px 24px rgba(17, 24, 39, 0.3)",
    padding: "0.25rem 0.55rem"
  },
  wikiEditButton: {
    position: "fixed",
    zIndex: 2100,
    width: "20px",
    height: "20px",
    borderRadius: "9999px",
    border: "none",
    backgroundColor: "#4f46e5",
    color: "#ffffff",
    fontSize: "0.7rem",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    boxShadow: "0 12px 20px rgba(79, 70, 229, 0.28)",
    padding: 0
  },
  newNodeButtonRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: "0.25rem",
    paddingLeft: "4px",
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
    border: "1px solid #babac1ff",
    backgroundColor: "transparent",
    color: "#535355ff",
    cursor: "pointer",
    boxShadow: "0 8px 18px rgba(87, 87, 90, 0.18)",
    transition: "transform 120ms ease, box-shadow 120ms ease, background-color 120ms ease",
    flexShrink: 0,
    minWidth: `${NEW_NODE_BUTTON_DIAMETER_REM}rem`
  },
  newNodeActionGlyph: {
    fontSize: "1.35rem",
    fontWeight: 600,
    lineHeight: 1
  },
  iconCell: {
    width: `${OUTLINE_ROW_TOGGLE_DIAMETER_REM}rem`,
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "center"
  },
  bulletCell: {
    width: `${OUTLINE_ROW_BULLET_DIAMETER_REM}rem`,
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "center"
  }
};
