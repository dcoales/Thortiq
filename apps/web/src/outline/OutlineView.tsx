import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, MouseEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import { useOutlineSnapshot, useSyncContext } from "./OutlineProvider";
import { flattenSnapshot, type OutlineRow } from "./flattenSnapshot";
import { ActiveNodeEditor } from "./ActiveNodeEditor";
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
  const { outline, localOrigin } = useSyncContext();
  const parentRef = useRef<HTMLDivElement | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<EdgeId | null>(rows[0]?.edgeId ?? null);
  const [pendingCursor, setPendingCursor] = useState<PendingCursor | null>(null);
  const [activeTextCell, setActiveTextCell] = useState<
    { edgeId: EdgeId; element: HTMLDivElement }
  | null>(null);

  useEffect(() => {
    if (!rows.length) {
      setSelectedEdgeId(null);
      return;
    }
    if (!selectedEdgeId || !rows.some((row) => row.edgeId === selectedEdgeId)) {
      setSelectedEdgeId(rows[0].edgeId);
    }
  }, [rows, selectedEdgeId]);

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
    }
  }, [selectedEdgeId]);

  useEffect(() => {
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
  }, [rows, selectedEdgeId]);

  const isEditorEvent = (target: EventTarget | null): boolean => {
    // Don't hijack pointer/keyboard events that need to reach ProseMirror.
    if (!(target instanceof Node)) {
      return false;
    }
    const element = target instanceof HTMLElement ? target : target.parentElement;
    return Boolean(element?.closest(".thortiq-prosemirror"));
  };

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
      event.preventDefault();
      const next = Math.min(selectedIndex + 1, rows.length - 1);
      setSelectedEdgeId(rows[next]?.edgeId ?? selectedEdgeId);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      const next = Math.max(selectedIndex - 1, 0);
      setSelectedEdgeId(rows[next]?.edgeId ?? selectedEdgeId);
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      const result = insertSiblingBelow({ outline, origin: localOrigin }, row.edgeId);
      setSelectedEdgeId(result.edgeId);
      return;
    }

    if (event.key === "Enter" && event.shiftKey) {
      event.preventDefault();
      const result = insertChild({ outline, origin: localOrigin }, row.edgeId);
      setSelectedEdgeId(result.edgeId);
      return;
    }

    if (event.key === "Tab" && !event.shiftKey) {
      event.preventDefault();
      const result = indentEdge({ outline, origin: localOrigin }, row.edgeId);
      if (result) {
        setSelectedEdgeId(result.edgeId);
      }
      return;
    }

    if (event.key === "Tab" && event.shiftKey) {
      event.preventDefault();
      const result = outdentEdge({ outline, origin: localOrigin }, row.edgeId);
      if (result) {
        setSelectedEdgeId(result.edgeId);
      }
      return;
    }

    if (event.key === "ArrowLeft") {
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
    setPendingCursor({ edgeId, clientX, clientY });
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
          {rows.map((row) => (
            <Row
              key={row.edgeId}
              row={row}
              isSelected={row.edgeId === selectedEdgeId}
              onSelect={setSelectedEdgeId}
              onToggleCollapsed={handleToggleCollapsed}
              onRowMouseDown={handleRowMouseDown}
              onActiveTextCellChange={undefined}
              editorEnabled={false}
            />
          ))}
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

            const isSelected = row.edgeId === selectedEdgeId;

            return (
              <div
                key={row.edgeId}
                ref={virtualizer.measureElement}
                role="treeitem"
                aria-level={row.depth + 1}
                aria-selected={isSelected}
                data-index={virtualRow.index}
                data-row-index={virtualRow.index}
                style={{
                  ...styles.row,
                  transform: `translateY(${virtualRow.start}px)`,
                  paddingLeft: `${row.depth * ROW_INDENT_PX + 12}px`,
                  backgroundColor: isSelected ? "#eef2ff" : "transparent",
                  borderLeft: isSelected ? "3px solid #4f46e5" : "3px solid transparent"
                }}
                onMouseDown={(event) => handleRowMouseDown(event, row.edgeId)}
              >
                <RowContent
                  row={row}
                  isSelected={isSelected}
                  onSelect={setSelectedEdgeId}
                  onToggleCollapsed={handleToggleCollapsed}
                  onActiveTextCellChange={handleActiveTextCellChange}
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

interface PendingCursor {
  readonly edgeId: EdgeId;
  readonly clientX: number;
  readonly clientY: number;
}

interface RowProps {
  readonly row: OutlineRow;
  readonly isSelected: boolean;
  readonly onSelect: (edgeId: EdgeId) => void;
  readonly onToggleCollapsed: (edgeId: EdgeId, collapsed?: boolean) => void;
  readonly onRowMouseDown?: (event: MouseEvent<HTMLDivElement>, edgeId: EdgeId) => void;
  readonly onActiveTextCellChange?: (edgeId: EdgeId, element: HTMLDivElement | null) => void;
  readonly editorEnabled: boolean;
}

const Row = ({
  row,
  isSelected,
  onSelect,
  onToggleCollapsed,
  onRowMouseDown,
  onActiveTextCellChange,
  editorEnabled
}: RowProps): JSX.Element => (
  <div
    role="treeitem"
    aria-level={row.depth + 1}
    aria-selected={isSelected}
    style={{
      ...styles.testRow,
      paddingLeft: `${row.depth * ROW_INDENT_PX + 12}px`,
      backgroundColor: isSelected ? "#eef2ff" : "transparent",
      borderLeft: isSelected ? "3px solid #4f46e5" : "3px solid transparent"
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
      onSelect={onSelect}
      onToggleCollapsed={onToggleCollapsed}
      onActiveTextCellChange={onActiveTextCellChange}
      editorEnabled={editorEnabled}
    />
  </div>
);

const RowContent = ({
  row,
  isSelected,
  onSelect,
  onToggleCollapsed,
  onActiveTextCellChange,
  editorEnabled
}: RowProps): JSX.Element => {
  const textCellRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!onActiveTextCellChange) {
      return;
    }
    // Expose the live DOM cell so the persistent editor can move between rows.
    onActiveTextCellChange(row.edgeId, isSelected ? textCellRef.current : null);
    return () => {
      onActiveTextCellChange(row.edgeId, null);
    };
  }, [isSelected, onActiveTextCellChange, row.edgeId]);

  const caretSymbol = row.collapsed ? "▶" : "▼";

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
      {caretSymbol}
    </button>
  ) : (
    <span style={styles.caretPlaceholder} />
  );

  const bulletContent = row.hasChildren ? "" : "•";
  const showEditor = isSelected && editorEnabled;

  if (isSelected) {
    return (
      <div style={styles.rowContentSelected}>
        <div style={styles.iconCell}>{caret}</div>
        <div style={styles.bulletCell}>
          <span style={styles.bullet}>{bulletContent}</span>
        </div>
        <div style={styles.textCell} ref={textCellRef}>
          <span
            style={{
              ...styles.rowText,
              display: showEditor ? "none" : "inline"
            }}
          >
            {row.text || "Untitled node"}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.rowContentStatic}>
      <div style={styles.iconCell}>{caret}</div>
      <div style={styles.bulletCell}>
        <span style={styles.bullet}>{bulletContent}</span>
      </div>
      <div style={styles.textCell} ref={textCellRef}>
        <span style={styles.rowText}>{row.text || "Untitled node"}</span>
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
    alignItems: "center",
    gap: "0.25rem",
    width: "100%"
  },
  rowContentStatic: {
    display: "flex",
    alignItems: "center",
    gap: "0.25rem",
    width: "100%"
  },
  textCell: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    cursor: "text"
  },
  iconCell: {
    width: "1.25rem",
    display: "flex",
    alignItems: "center",
    justifyContent: "center"
  },
  bulletCell: {
    width: "1rem",
    display: "flex",
    alignItems: "center",
    justifyContent: "center"
  },
  bullet: {
    display: "inline-flex",
    justifyContent: "center",
    color: "#6b7280",
    fontSize: "0.85rem",
    width: "100%"
  },
  caretPlaceholder: {
    display: "inline-flex",
    width: "1rem",
    height: "1.5rem"
  },
  toggleButton: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "1rem",
    height: "1.5rem",
    border: "none",
    background: "transparent",
    color: "#6b7280",
    cursor: "pointer",
    padding: 0
  }
};
