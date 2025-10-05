/**
 * Web-specific outline pane container that composes shared snapshot selectors with session and
 * cursor controllers. Rendering, drag logic, and ProseMirror orchestration stay here while
 * store mutations and cursor intent live in dedicated hooks per AGENTS.md separation rules.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CSSProperties,
  KeyboardEvent
} from "react";

import {
  useOutlinePaneState,
  useOutlineSessionStore,
  useOutlineSnapshot,
  useOutlinePresence,
  useSyncContext,
  useAwarenessIndicatorsEnabled,
  type OutlinePresenceParticipant
} from "./OutlineProvider";
import { ActiveNodeEditor } from "./ActiveNodeEditor";
import { WikiLinkEditDialog } from "./components/WikiLinkEditDialog";
import { insertChild, insertRootNode } from "@thortiq/outline-commands";
import {
  matchOutlineCommand,
  outlineCommandDescriptors,
  type EdgeId,
  type NodeId,
  updateWikiLinkDisplayText,
  findEdgePathForNode
} from "@thortiq/client-core";
import { FONT_FAMILY_STACK } from "../theme/typography";
import {
  useOutlineRows,
  useOutlineSelection,
  useOutlineDragAndDrop,
  OutlineVirtualList,
  OutlineRowView,
  OUTLINE_ROW_TOGGLE_DIAMETER_REM,
  OUTLINE_ROW_BULLET_DIAMETER_REM,
  type OutlinePendingCursor,
  type OutlineVirtualRowRendererProps
} from "@thortiq/client-react";
import { usePaneSessionController } from "./hooks/usePaneSessionController";
import { useOutlineCursorManager } from "./hooks/useOutlineCursorManager";
import { planGuidelineCollapse } from "./utils/guidelineCollapse";
import { OutlineHeader } from "./components/OutlineHeader";

const ESTIMATED_ROW_HEIGHT = 32;
const CONTAINER_HEIGHT = 480;
const NEW_NODE_BUTTON_DIAMETER_REM = 1.25;
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
  const parentRef = useRef<HTMLDivElement | null>(null);
  const [pendingCursor, setPendingCursor] = useState<OutlinePendingCursor | null>(null);
  const [activeTextCell, setActiveTextCell] = useState<
    { edgeId: EdgeId; element: HTMLDivElement }
  | null>(null);
  const [wikiHoverState, setWikiHoverState] = useState<WikiHoverState | null>(null);
  const wikiHoverLockRef = useRef(false);
  const wikiHoverClearTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [wikiEditState, setWikiEditState] = useState<WikiEditState | null>(null);
  const [wikiEditDraft, setWikiEditDraft] = useState("");

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
  const canNavigateBack = pane.focusHistoryIndex > 0;
  const canNavigateForward = pane.focusHistoryIndex < pane.focusHistory.length - 1;

  const { rows, rowMap, edgeIndexMap, focusContext } = useOutlineRows(snapshot, pane);

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
    setCollapsed
  });

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

  const handleWikiLinkNavigate = useCallback(
    (targetNodeId: NodeId) => {
      const path = findEdgePathForNode(snapshot, targetNodeId);
      if (!path) {
        return;
      }
      handleFocusEdge({ edgeId: path[path.length - 1], pathEdgeIds: path });
    },
    [snapshot, handleFocusEdge]
  );

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
  }, [wikiHoverState, clearWikiHoverTimeout]);

  const handleWikiEditCancel = useCallback(() => {
    wikiHoverLockRef.current = false;
    clearWikiHoverTimeout();
    setWikiEditState(null);
    setWikiEditDraft("");
  }, [clearWikiHoverTimeout]);

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
  }, [clearWikiHoverTimeout, localOrigin, outline, wikiEditDraft, wikiEditState]);

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

  const isEditorEvent = (target: EventTarget | null): boolean => {
    // Don't hijack pointer/keyboard events that need to reach ProseMirror.
    if (!(target instanceof Node)) {
      return false;
    }
    const element = target instanceof HTMLElement ? target : target.parentElement;
    return Boolean(element?.closest(".thortiq-prosemirror"));
  };

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
    isEditorEvent,
    parentRef,
    computeGuidelinePlan
  });

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

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (isEditorEvent(event.target)) {
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

  const handleToggleCollapsed = (edgeId: EdgeId, collapsed?: boolean) => {
    const targetRow = rows.find((candidate) => candidate.edgeId === edgeId);
    const nextCollapsed = collapsed ?? !targetRow?.collapsed;
    setCollapsed(edgeId, nextCollapsed);
  };

  const handleCreateNode = useCallback(() => {
    const result = focusContext
      ? insertChild({ outline, origin: localOrigin }, focusContext.edge.id)
      : insertRootNode({ outline, origin: localOrigin });

    setPendingCursor({ edgeId: result.edgeId, placement: "text-end" });
    setPendingFocusEdgeId(result.edgeId);
    setSelectedEdgeId(result.edgeId);
  }, [focusContext, localOrigin, outline, setPendingFocusEdgeId, setSelectedEdgeId]);

  const editorEnabled = !isTestFallback || prosemirrorTestsEnabled;
  const onActiveTextCellChange = editorEnabled ? handleActiveTextCellChange : undefined;

  const renderOutlineRow = ({ row }: OutlineVirtualRowRendererProps): JSX.Element => {
    const isSelected = selectedEdgeIds.has(row.edgeId);
    const isPrimarySelected = row.edgeId === selectedEdgeId;
    const highlight = isSelected && selectionHighlightActive;
    const dropIndicator = activeDrag?.plan?.indicator?.edgeId === row.edgeId
      ? activeDrag.plan.indicator
      : null;

    return (
      <OutlineRowView
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
        onWikiLinkClick={({ targetNodeId }) => {
          handleWikiLinkNavigate(targetNodeId);
        }}
        onWikiLinkHover={handleWikiLinkHoverEvent}
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

  const shouldRenderActiveEditor = editorEnabled;

  return (
    <section style={styles.shell}>
      <OutlineHeader
        focus={focusContext}
        canNavigateBack={canNavigateBack}
        canNavigateForward={canNavigateForward}
        onNavigateHistory={handleNavigateHistory}
        onFocusEdge={handleFocusEdge}
        onClearFocus={handleClearFocus}
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
        scrollContainerProps={{
          tabIndex: 0,
          onKeyDown: handleKeyDown,
          onScroll: () => {
            wikiHoverLockRef.current = false;
            clearWikiHoverTimeout();
            setWikiHoverState(null);
          },
          role: "tree",
          "aria-label": "Outline",
          style: styles.scrollContainer
        }}
        footer={listFooter}
      />
      {shouldRenderActiveEditor ? (
        <ActiveNodeEditor
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
      />
      ) : null}
      {dragPreview}
      {wikiEditButton}
      {wikiEditDialog}
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
  shell: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    maxWidth: "960px",
    margin: "0 auto",
    padding: "1.5rem",
    boxSizing: "border-box",
    fontFamily: FONT_FAMILY_STACK
  },
  scrollContainer: {
    borderRadius: "0.75rem",
    overflow: "auto",
    flex: 1,
    height: `${CONTAINER_HEIGHT}px`,
    background: "#ffffff",
    position: "relative"
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
