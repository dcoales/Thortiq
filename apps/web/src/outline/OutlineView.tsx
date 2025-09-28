import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import { useOutlineSnapshot } from "./OutlineProvider";
import { flattenSnapshot } from "./flattenSnapshot";
import { ActiveNodeEditor } from "./ActiveNodeEditor";

const ESTIMATED_ROW_HEIGHT = 32;
const ROW_INDENT_PX = 18;
const CONTAINER_HEIGHT = 480;
const isTestEnvironment = import.meta.env?.MODE === "test";

export const OutlineView = (): JSX.Element => {
  const snapshot = useOutlineSnapshot();
  const rows = useMemo(() => flattenSnapshot(snapshot), [snapshot]);
  const parentRef = useRef<HTMLDivElement | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number>(rows.length > 0 ? 0 : -1);

  useEffect(() => {
    if (!rows.length) {
      setSelectedIndex(-1);
      return;
    }
    setSelectedIndex((index) => {
      if (index < 0) {
        return 0;
      }
      return Math.min(index, rows.length - 1);
    });
  }, [rows.length]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!rows.length) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((index) => Math.min(index + 1, rows.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((index) => Math.max(index - 1, 0));
    }
  };

  const virtualizer = useVirtualizer({
    count: isTestEnvironment ? 0 : rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    overscan: 8,
    measureElement: (element) => element.getBoundingClientRect().height,
    initialRect: {
      width: 960,
      height: CONTAINER_HEIGHT
    }
  });

  if (isTestEnvironment) {
    return (
      <section style={styles.shell}>
        <header style={styles.header}>
          <h1 style={styles.title}>Thortiq Outline</h1>
          <p style={styles.subtitle}>Keyboard arrows move selection. Editing arrives in later steps.</p>
        </header>
        <div
          style={styles.scrollContainer}
          tabIndex={0}
          onKeyDown={handleKeyDown}
          role="tree"
          aria-label="Outline"
        >
          {rows.map((item, index) => {
            const isSelected = index === selectedIndex;
            return (
              <div
                key={item.edgeId}
                role="treeitem"
                aria-level={item.depth + 1}
                aria-selected={isSelected}
                style={{
                  ...styles.testRow,
                  paddingLeft: `${item.depth * ROW_INDENT_PX + 12}px`,
                  backgroundColor: isSelected ? "#eef2ff" : "transparent",
                  borderLeft: isSelected ? "3px solid #4f46e5" : "3px solid transparent"
                }}
              >
                {isSelected ? (
                  <ActiveNodeEditor nodeId={item.nodeId} initialText={item.text} />
                ) : (
                  <span style={styles.rowText}>{item.text || "Untitled node"}</span>
                )}
              </div>
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
      <header style={styles.header}>
        <h1 style={styles.title}>Thortiq Outline</h1>
        <p style={styles.subtitle}>Keyboard arrows move selection. Editing arrives in later steps.</p>
      </header>
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
            const item = rows[virtualRow.index];
            if (!item) {
              return null;
            }

            const isSelected = virtualRow.index === selectedIndex;

            return (
              <div
                key={item.edgeId}
                ref={virtualizer.measureElement}
                role="treeitem"
                aria-level={item.depth + 1}
                aria-selected={isSelected}
                data-index={virtualRow.index}
                data-row-index={virtualRow.index}
                style={{
                  ...styles.row,
                  transform: `translateY(${virtualRow.start}px)`,
                  paddingLeft: `${item.depth * ROW_INDENT_PX + 12}px`,
                  backgroundColor: isSelected ? "#eef2ff" : "transparent",
                  borderLeft: isSelected ? "3px solid #4f46e5" : "3px solid transparent"
                }}
              >
                {isSelected ? (
                  <ActiveNodeEditor nodeId={item.nodeId} initialText={item.text} />
                ) : (
                  <span style={styles.rowText}>{item.text || "Untitled node"}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
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
  }
};
