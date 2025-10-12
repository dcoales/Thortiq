/**
 * Floating dialog listing all placements (original + mirrors) for a node. Triggered from the
 * right-rail mirror indicator so users can jump between instances without losing virtualization
 * alignment. Stays in web layer because positioning and platform styling differ per surface.
 */
import { useEffect, useRef } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from "react";

import type { EdgeId } from "@thortiq/client-core";

import { useClampedFixedPosition } from "../hooks/useClampedFixedPosition";

export interface MirrorTrackerDialogEntry {
  readonly edgeId: EdgeId;
  readonly isOriginal: boolean;
  readonly isSource: boolean;
  readonly pathLabel: string;
  readonly pathSegments: ReadonlyArray<{
    readonly edgeId: EdgeId;
    readonly label: string;
  }>;
}

interface MirrorTrackerDialogProps {
  readonly anchor: {
    readonly left: number;
    readonly top: number;
  };
  readonly entries: readonly MirrorTrackerDialogEntry[];
  readonly onSelect: (edgeId: EdgeId) => void;
  readonly onClose: () => void;
}

const ORIGINAL_COLOR = "#f97316";
const MIRROR_COLOR = "#2563eb";

export const MirrorTrackerDialog = ({
  anchor,
  entries,
  onSelect,
  onClose
}: MirrorTrackerDialogProps): JSX.Element => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const position = useClampedFixedPosition(containerRef, anchor, { padding: 16 });

  useEffect(() => {
    const handlePointer = (event: MouseEvent) => {
      if (!containerRef.current) {
        return;
      }
      if (containerRef.current.contains(event.target as Node)) {
        return;
      }
      onClose();
    };
    window.addEventListener("mousedown", handlePointer);
    return () => {
      window.removeEventListener("mousedown", handlePointer);
    };
  }, [onClose]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const handleEntryKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, edgeId: EdgeId) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(edgeId);
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="false"
      data-outline-mirror-tracker="true"
      style={{
        ...styles.container,
        left: position.left,
        top: position.top
      }}
    >
      <header style={styles.header}>
        <span style={styles.headerTitle}>Mirror placements</span>
      </header>
      <ul style={styles.list} role="list">
        {entries.map((entry) => {
          const accentColor = entry.isOriginal ? ORIGINAL_COLOR : MIRROR_COLOR;
          const tileStyle: CSSProperties = {
            ...styles.entryButton,
            borderColor: entry.isSource ? accentColor : "transparent",
            backgroundColor: entry.isSource ? "rgba(148, 163, 184, 0.08)" : "#ffffff"
          };

          return (
            <li key={entry.edgeId} style={styles.listItem}>
              <button
                type="button"
                style={tileStyle}
                onClick={() => onSelect(entry.edgeId)}
                onKeyDown={(event) => handleEntryKeyDown(event, entry.edgeId)}
              >
                <span
                  aria-hidden
                  style={{
                    ...styles.entryBadge,
                    backgroundColor: accentColor
                  }}
                >
                  {entry.isOriginal ? "O" : "M"}
                </span>
                <span style={styles.pathLabel}>{entry.pathLabel}</span>
                <span style={styles.segmentContainer} aria-hidden>
                  {entry.pathSegments.map((segment, index) => (
                    <span key={segment.edgeId} style={styles.segmentWrapper}>
                      <span
                        style={{
                          ...styles.segmentText,
                          color: index === entry.pathSegments.length - 1 ? accentColor : "#1f2937"
                        }}
                      >
                        {segment.label}
                      </span>
                      {index < entry.pathSegments.length - 1 ? (
                        <span style={styles.segmentSeparator}>›</span>
                      ) : null}
                    </span>
                  ))}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

const styles: Record<string, CSSProperties> = {
  container: {
    position: "fixed",
    minWidth: "320px",
    maxWidth: "360px",
    borderRadius: "0.75rem",
    border: "1px solid rgba(148, 163, 184, 0.28)",
    boxShadow: "0 24px 60px rgba(15, 23, 42, 0.22)",
    backgroundColor: "#ffffff",
    padding: "0.75rem 0.75rem 0.5rem",
    zIndex: 2300,
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem"
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0 0.25rem"
  },
  headerTitle: {
    fontSize: "0.85rem",
    fontWeight: 600,
    color: "#1f2937"
  },
  list: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
    maxHeight: "320px",
    overflowY: "auto"
  },
  listItem: {
    display: "flex"
  },
  entryButton: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    width: "100%",
    textAlign: "left",
    borderRadius: "0.75rem",
    borderWidth: "2px",
    borderStyle: "solid",
    padding: "0.65rem 0.75rem",
    background: "#ffffff",
    cursor: "pointer",
    boxShadow: "0 10px 24px rgba(15, 23, 42, 0.08)",
    transition: "transform 140ms ease, box-shadow 140ms ease"
  },
  entryBadge: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "1.5rem",
    height: "1.5rem",
    borderRadius: "9999px",
    color: "#ffffff",
    fontSize: "0.75rem",
    fontWeight: 700,
    flexShrink: 0
  },
  pathLabel: {
    position: "absolute",
    width: "1px",
    height: "1px",
    padding: 0,
    margin: "-1px",
    overflow: "hidden",
    clip: "rect(0, 0, 0, 0)",
    border: 0
  },
  segmentContainer: {
    display: "flex",
    flexWrap: "wrap",
    gap: "0.2rem",
    fontSize: "0.82rem",
    lineHeight: 1.3,
    color: "#1f2937",
    flex: 1
  },
  segmentWrapper: {
    display: "flex",
    alignItems: "center",
    gap: "0.2rem"
  },
  segmentText: {
    fontWeight: 500
  },
  segmentSeparator: {
    color: "#9ca3af",
    fontSize: "0.75rem"
  }
};
