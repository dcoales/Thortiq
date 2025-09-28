import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent } from "react";
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

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
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
        toggleCollapsedCommand({ outline }, row.edgeId, true);
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
        toggleCollapsedCommand({ outline }, row.edgeId, false);
        return;
      }
      const childRow = findFirstChildRow(rows, row);
      if (childRow) {
        setSelectedEdgeId(childRow.edgeId);
      }
    }
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
                onMouseDown={(event) => {
                  event.preventDefault();
                  setSelectedEdgeId(row.edgeId);
                }}
              >
                <RowContent row={row} isSelected={isSelected} onSelect={setSelectedEdgeId} />
              </div>
            );
          })}
        </div>
      </div>
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
  readonly onSelect: (edgeId: EdgeId) => void;
}

const Row = ({ row, isSelected, onSelect }: RowProps): JSX.Element => (
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
      event.preventDefault();
      onSelect(row.edgeId);
    }}
  >
    <RowContent row={row} isSelected={isSelected} onSelect={onSelect} />
  </div>
);

const RowContent = ({ row, isSelected, onSelect }: RowProps): JSX.Element => {
  const caret = row.hasChildren ? (row.collapsed ? "▶" : "▼") : "•";

  if (isSelected) {
    return (
      <div style={styles.rowContentSelected}>
        <span style={styles.bullet}>{caret}</span>
        <ActiveNodeEditor nodeId={row.nodeId} initialText={row.text} />
      </div>
    );
  }

  return (
    <button
      type="button"
      style={styles.rowButton}
      onMouseDown={(event) => {
        event.preventDefault();
        onSelect(row.edgeId);
      }}
    >
      <span style={styles.bullet}>{caret}</span>
      <span style={styles.rowText}>{row.text || "Untitled node"}</span>
    </button>
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
    borderBottom: "1px solid #f3f4f6"
  },
  testRow: {
    display: "flex",
    alignItems: "center",
    minHeight: `${ESTIMATED_ROW_HEIGHT}px`,
    fontSize: "1rem",
    lineHeight: 1.5,
    color: "#111827",
    borderBottom: "1px solid #f3f4f6"
  },
  rowText: {
    whiteSpace: "pre-wrap",
    wordBreak: "break-word"
  },
  rowContentSelected: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    width: "100%"
  },
  rowButton: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    width: "100%",
    border: "none",
    background: "transparent",
    textAlign: "left",
    font: "inherit",
    color: "inherit",
    padding: 0,
    cursor: "pointer"
  },
  bullet: {
    display: "inline-flex",
    width: "1rem",
    justifyContent: "center",
    color: "#6b7280",
    fontSize: "0.85rem"
  }
};
