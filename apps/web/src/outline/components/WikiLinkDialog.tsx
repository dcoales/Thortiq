/**
 * WikiLinkDialog renders the inline wiki link suggestion list anchored to the current caret.
 * It stays presentation-only so ActiveNodeEditor can control selection, keyboard routing,
 * and apply behaviour while reusing the same component across platforms.
 */
import { useEffect, useMemo, useRef } from "react";
import type { CSSProperties } from "react";

import type { WikiLinkSearchCandidate } from "@thortiq/client-core";

interface WikiLinkDialogProps {
  readonly anchor: {
    readonly left: number;
    readonly bottom: number;
  };
  readonly query: string;
  readonly results: ReadonlyArray<WikiLinkSearchCandidate>;
  readonly selectedIndex: number;
  readonly onSelect: (candidate: WikiLinkSearchCandidate) => void;
  readonly onHoverIndexChange?: (index: number) => void;
  readonly onRequestClose?: () => void;
}

const DIALOG_MAX_WIDTH = 320;
const DIALOG_MAX_HEIGHT = 280;

export const WikiLinkDialog = ({
  anchor,
  query,
  results,
  selectedIndex,
  onSelect,
  onHoverIndexChange,
  onRequestClose
}: WikiLinkDialogProps): JSX.Element => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const positioning = useMemo(() => {
    if (typeof window === "undefined") {
      return {
        left: anchor.left,
        top: anchor.bottom + 4
      };
    }
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const left = Math.max(8, Math.min(anchor.left, viewportWidth - DIALOG_MAX_WIDTH - 8));
    const top = Math.max(8, Math.min(anchor.bottom + 4, viewportHeight - DIALOG_MAX_HEIGHT - 8));
    return { left, top };
  }, [anchor.bottom, anchor.left]);

  useEffect(() => {
    if (!onRequestClose) {
      return;
    }
    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current) {
        return;
      }
      if (containerRef.current.contains(event.target as Node)) {
        return;
      }
      onRequestClose();
    };
    window.addEventListener("mousedown", handlePointerDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
    };
  }, [onRequestClose]);

  useEffect(() => {
    const element = itemRefs.current[selectedIndex];
    element?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex, results.length]);

  itemRefs.current = [];

  const containerStyle: CSSProperties = {
    position: "fixed",
    left: positioning.left,
    top: positioning.top,
    minWidth: "240px",
    maxWidth: `${DIALOG_MAX_WIDTH}px`,
    maxHeight: `${DIALOG_MAX_HEIGHT}px`,
    overflow: "hidden",
    borderRadius: "0.75rem",
    border: "1px solid rgba(148, 163, 184, 0.28)",
    boxShadow: "0 20px 45px rgba(15, 23, 42, 0.18)",
    backgroundColor: "#ffffff",
    zIndex: 2000,
    padding: "4px 0",
    display: "flex",
    flexDirection: "column"
  };

  const listStyle: CSSProperties = {
    listStyle: "none",
    margin: 0,
    padding: 0,
    overflowY: "auto",
    maxHeight: `${DIALOG_MAX_HEIGHT - 16}px`
  };

  const baseItemStyle: CSSProperties = {
    width: "100%",
    padding: "8px 14px",
    textAlign: "left",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    display: "flex",
    flexDirection: "column",
    gap: "4px"
  };

  const titleStyle: CSSProperties = {
    fontWeight: 600,
    color: "#1f2937",
    fontSize: "0.95rem",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis"
  };

  const breadcrumbStyle: CSSProperties = {
    fontSize: "0.75rem",
    color: "#6b7280",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis"
  };

  const emptyStateStyle: CSSProperties = {
    padding: "12px 16px",
    color: "#6b7280",
    fontSize: "0.85rem"
  };

  const formatBreadcrumb = (candidate: WikiLinkSearchCandidate): string => {
    const segments = candidate.breadcrumb.slice(0, -1);
    if (segments.length === 0) {
      return "Root";
    }
    return segments
      .map((segment) => (segment.text.trim().length > 0 ? segment.text : "Untitled node"))
      .join(" › ");
  };

  return (
    <div ref={containerRef} style={containerStyle} data-outline-wikilink-dialog="true">
      {results.length === 0 ? (
        <div style={emptyStateStyle}>No matching nodes{query ? ` for "${query}"` : ""}</div>
      ) : (
        <ul style={listStyle} role="listbox" aria-label="Wiki link suggestions">
          {results.map((candidate, index) => {
            const isSelected = index === selectedIndex;
            const itemStyle = isSelected
              ? {
                  ...baseItemStyle,
                  backgroundColor: "#eef2ff"
                }
              : baseItemStyle;
            return (
              <li key={`${candidate.nodeId}-${index}`}>
                <button
                  type="button"
                  style={itemStyle}
                  role="option"
                  aria-selected={isSelected}
                  ref={(element) => {
                    itemRefs.current[index] = element;
                  }}
                  onMouseEnter={() => onHoverIndexChange?.(index)}
                  onClick={(event) => {
                    event.preventDefault();
                    onSelect(candidate);
                  }}
                >
                  <span style={titleStyle}>{candidate.text.length > 0 ? candidate.text : "Untitled node"}</span>
                  <span style={breadcrumbStyle}>{formatBreadcrumb(candidate)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
