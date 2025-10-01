import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, MouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import {
  useOutlineSessionState,
  useOutlineSessionStore,
  useOutlineSnapshot,
  useOutlinePresence,
  useSyncContext,
  useAwarenessIndicatorsEnabled,
  useSyncDebugLoggingEnabled,
  type OutlinePresenceParticipant
} from "./OutlineProvider";
import { flattenSnapshot, type OutlineRow } from "./flattenSnapshot";
import { ActiveNodeEditor, type PendingCursorRequest } from "./ActiveNodeEditor";
import {
  indentEdge,
  insertChild,
  insertSiblingBelow,
  outdentEdge,
  toggleCollapsedCommand
} from "@thortiq/outline-commands";
import type { EdgeId } from "@thortiq/client-core";

const ESTIMATED_ROW_HEIGHT = 32;
const ROW_INDENT_PX = 18;
const CONTAINER_HEIGHT = 480;
const FIRST_LINE_CENTER_OFFSET_REM = 0.75; // 1.5 line-height * 0.5 with 1rem font size
const BULLET_DIAMETER_REM = 1.2;
const BULLET_RADIUS_REM = BULLET_DIAMETER_REM / 2;
const BULLET_TOP_OFFSET_REM = FIRST_LINE_CENTER_OFFSET_REM - BULLET_RADIUS_REM;
const CARET_HEIGHT_REM = 0.9;
const TOGGLE_CONTAINER_DIAMETER_REM = BULLET_DIAMETER_REM;

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
  const flag = (globalThis as { __THORTIQ_PROSEMIRROR_TEST__?: boolean }).__THORTIQ_PROSEMIRROR_TEST__;
  return !flag;
};

export const OutlineView = (): JSX.Element => {
  const isTestFallback = shouldRenderTestFallback();
  const snapshot = useOutlineSnapshot();
  const rows = useMemo(() => flattenSnapshot(snapshot), [snapshot]);
  const awarenessIndicatorsEnabled = useAwarenessIndicatorsEnabled();
  const presence = useOutlinePresence();
  const presenceByEdgeId = awarenessIndicatorsEnabled ? presence.byEdgeId : EMPTY_PRESENCE_MAP;
  const { outline, localOrigin } = useSyncContext();
  const sessionState = useOutlineSessionState();
  const sessionStore = useOutlineSessionStore();
  const syncDebugLoggingEnabled = useSyncDebugLoggingEnabled();
  const parentRef = useRef<HTMLDivElement | null>(null);
  // Track whether the selection should render with the prominent highlight.
  const [showSelectionHighlight, setShowSelectionHighlight] = useState(true);
  const [pendingCursor, setPendingCursor] = useState<PendingCursor | null>(null);
  const [activeTextCell, setActiveTextCell] = useState<
    { edgeId: EdgeId; element: HTMLDivElement }
  | null>(null);
  const [selectionRange, setSelectionRange] = useState<SelectionRange | null>(null);
  const [dragSelection, setDragSelection] = useState<DragSelectionState | null>(null);

  const selectedEdgeId = sessionState.selectedEdgeId;

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

  const setSelectedEdgeId = useCallback(
    (edgeId: EdgeId | null) => {
      sessionStore.update((current) => {
        if (current.selectedEdgeId === edgeId) {
          return current;
        }
        return {
          ...current,
          selectedEdgeId: edgeId
        };
      });
    },
    [sessionStore]
  );

  const selectedIndex = useMemo(() => {
    if (!selectedEdgeId) {
      return -1;
    }
    return rows.findIndex((row) => row.edgeId === selectedEdgeId);
  }, [rows, selectedEdgeId]);

  const selectedRow = selectedIndex >= 0 ? rows[selectedIndex] : null;

  useEffect(() => {
    if (!selectedEdgeId) {
      setActiveTextCell(null);
      setSelectionRange(null);
    }
  }, [selectedEdgeId]);

  useEffect(() => {
    if (!selectionRange) {
      return;
    }
    if (
      !edgeIndexMap.has(selectionRange.anchorEdgeId)
      || !edgeIndexMap.has(selectionRange.focusEdgeId)
    ) {
      setSelectionRange(null);
    }
  }, [edgeIndexMap, selectionRange]);

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

    if (!rows.length || selectedIndex === -1 || !selectedEdgeId) {
      return;
    }

    const row = rows[selectedIndex];
    if (!row) {
      return;
    }

    if (event.key === "ArrowDown") {
      setSelectionRange(null);
      setShowSelectionHighlight(true);
      event.preventDefault();
      const next = Math.min(selectedIndex + 1, rows.length - 1);
      setSelectedEdgeId(rows[next]?.edgeId ?? selectedEdgeId);
      return;
    }

    if (event.key === "ArrowUp") {
      setSelectionRange(null);
      setShowSelectionHighlight(true);
      event.preventDefault();
      const next = Math.max(selectedIndex - 1, 0);
      setSelectedEdgeId(rows[next]?.edgeId ?? selectedEdgeId);
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      setSelectionRange(null);
      setShowSelectionHighlight(true);
      event.preventDefault();
      const result = insertSiblingBelow({ outline, origin: localOrigin }, row.edgeId);
      setSelectedEdgeId(result.edgeId);
      return;
    }

    if (event.key === "Enter" && event.shiftKey) {
      setSelectionRange(null);
      setShowSelectionHighlight(true);
      event.preventDefault();
      const result = insertChild({ outline, origin: localOrigin }, row.edgeId);
      setSelectedEdgeId(result.edgeId);
      return;
    }

    if (event.key === "Tab" && !event.shiftKey) {
      setSelectionRange(null);
      setShowSelectionHighlight(true);
      event.preventDefault();
      const result = indentEdge({ outline, origin: localOrigin }, row.edgeId);
      if (result) {
        setSelectedEdgeId(result.edgeId);
      }
      return;
    }

    if (event.key === "Tab" && event.shiftKey) {
      setSelectionRange(null);
      setShowSelectionHighlight(true);
      event.preventDefault();
      const result = outdentEdge({ outline, origin: localOrigin }, row.edgeId);
      if (result) {
        setSelectedEdgeId(result.edgeId);
      }
      return;
    }

    if (event.key === "ArrowLeft") {
      setSelectionRange(null);
      setShowSelectionHighlight(true);
      event.preventDefault();
      if (row.hasChildren && !row.collapsed) {
        toggleCollapsedCommand({ outline, origin: localOrigin }, row.edgeId, true);
        return;
      }
      const parentRow = findParentRow(rows, row);
      if (parentRow) {
        setSelectedEdgeId(parentRow.edgeId);
      }
      return;
    }

    if (event.key === "ArrowRight") {
      setSelectionRange(null);
      setShowSelectionHighlight(true);
      event.preventDefault();
      if (row.collapsed && row.hasChildren) {
        toggleCollapsedCommand({ outline, origin: localOrigin }, row.edgeId, false);
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
      setSelectionRange(null);
      setSelectedEdgeId(edgeId);
      setDragSelection({ pointerId: event.pointerId, anchorEdgeId: edgeId });
    },
    [setDragSelection, setSelectedEdgeId, setSelectionRange, setShowSelectionHighlight]
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
        setSelectionRange((current) => (current ? null : current));
        setSelectedEdgeId(dragSelection.anchorEdgeId);
        return;
      }
      setSelectionRange((current) => {
        if (
          current
          && current.anchorEdgeId === dragSelection.anchorEdgeId
          && current.focusEdgeId === edgeId
        ) {
          return current;
        }
        return { anchorEdgeId: dragSelection.anchorEdgeId, focusEdgeId: edgeId };
      });
      setSelectedEdgeId(edgeId);
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
  }, [dragSelection, edgeIndexMap, findEdgeIdFromPoint, setSelectedEdgeId, setSelectionRange, setShowSelectionHighlight]);

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
    setPendingCursor((current) => (current ? null : current));
  }, []);

  const handleToggleCollapsed = (edgeId: EdgeId, collapsed?: boolean) => {
    toggleCollapsedCommand({ outline, origin: localOrigin }, edgeId, collapsed);
  };

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
        <OutlineHeader />
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
                highlightSelected={highlight}
                editorAttachedEdgeId={activeTextCell?.edgeId ?? null}
                onSelect={setSelectedEdgeId}
                onToggleCollapsed={handleToggleCollapsed}
                onRowPointerDownCapture={handleRowPointerDownCapture}
                onRowMouseDown={handleRowMouseDown}
                onActiveTextCellChange={undefined}
                presence={presenceByEdgeId.get(row.edgeId) ?? EMPTY_PRESENCE}
                editorEnabled={false}
              />
            );
          })}
        </div>
      </section>
    );
  }

  const virtualItems = virtualizer.getVirtualItems();
  const totalHeight = virtualizer.getTotalSize();

  return (
    <section style={styles.shell}>
      <OutlineHeader />
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
                  paddingLeft: `${row.depth * ROW_INDENT_PX + 12}px`,
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
      </div>
      <ActiveNodeEditor
        nodeId={selectedRow?.nodeId ?? null}
        container={activeTextCell?.element ?? null}
        pendingCursor={
          pendingCursor?.edgeId && pendingCursor.edgeId === selectedEdgeId ? pendingCursor : null
        }
        onPendingCursorHandled={handlePendingCursorHandled}
      />
    </section>
  );
};

const OutlineHeader = (): JSX.Element => (
  <header style={styles.header}>
    <h1 style={styles.title}>Thortiq Outline</h1>
    <p style={styles.subtitle}>Keyboard arrows move selection. Editing arrives in later steps.</p>
  </header>
);

interface RowProps {
  readonly row: OutlineRow;
  readonly isSelected: boolean;
  readonly isPrimarySelected: boolean;
  readonly onSelect: (edgeId: EdgeId) => void;
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
        paddingLeft: `${row.depth * ROW_INDENT_PX + 12}px`,
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
  const bullet = (
    <span
      style={{
        ...styles.bullet,
        ...(bulletVariant === "collapsed-parent" ? styles.collapsedBullet : styles.standardBullet)
      }}
      data-outline-bullet={bulletVariant}
    >
      <span style={styles.bulletGlyph}>•</span>
    </span>
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
  title: {
    margin: 0,
    fontSize: "1.75rem",
    fontWeight: 600
  },
  subtitle: {
    margin: 0,
    color: "#6b7280"
  },
  scrollContainer: {
    border: "1px solid #e5e7eb",
    borderRadius: "0.75rem",
    overflow: "auto",
    flex: 1,
    height: `${CONTAINER_HEIGHT}px`,
    background: "#ffffff"
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
  bullet: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: `${BULLET_DIAMETER_REM}rem`,
    height: `${BULLET_DIAMETER_REM}rem`,
    marginTop: `${BULLET_TOP_OFFSET_REM}rem`
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
