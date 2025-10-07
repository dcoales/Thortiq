import { useEffect, useMemo, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";

interface AnchorPosition {
  readonly left: number;
  readonly bottom: number;
}

interface InlineTriggerDialogProps<TCandidate> {
  readonly anchor: AnchorPosition;
  readonly query: string;
  readonly results: ReadonlyArray<TCandidate>;
  readonly selectedIndex: number;
  readonly getPrimaryText: (candidate: TCandidate) => string;
  readonly getSecondaryText: (candidate: TCandidate) => string;
  readonly onSelect: (candidate: TCandidate) => void;
  readonly onHoverIndexChange?: (index: number) => void;
  readonly onRequestClose?: () => void;
  readonly ariaLabel: string;
  readonly emptyState?: (context: { readonly query: string }) => ReactNode;
  readonly getItemKey?: (candidate: TCandidate, index: number) => string;
}

const DIALOG_MAX_WIDTH = 320;
const DIALOG_MAX_HEIGHT = 280;

const containerStyleBase: CSSProperties = {
  position: "fixed",
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

const primaryTextStyle: CSSProperties = {
  fontWeight: 600,
  color: "#1f2937",
  fontSize: "0.95rem",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis"
};

const secondaryTextStyle: CSSProperties = {
  fontSize: "0.75rem",
  color: "#6b7280",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis"
};

const defaultEmptyState = ({ query }: { readonly query: string }): ReactNode => {
  return <div style={{ padding: "12px 16px", color: "#6b7280", fontSize: "0.85rem" }}>No results{query ? ` for "${query}"` : ""}</div>;
};

export const InlineTriggerDialog = <TCandidate,>({
  anchor,
  query,
  results,
  selectedIndex,
  getPrimaryText,
  getSecondaryText,
  onSelect,
  onHoverIndexChange,
  onRequestClose,
  ariaLabel,
  emptyState = defaultEmptyState,
  getItemKey
}: InlineTriggerDialogProps<TCandidate>): JSX.Element => {
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
    ...containerStyleBase,
    left: positioning.left,
    top: positioning.top
  };

  return (
    <div ref={containerRef} style={containerStyle} data-outline-inline-trigger-dialog="true">
      {results.length === 0 ? (
        emptyState({ query })
      ) : (
        <ul style={listStyle} role="listbox" aria-label={ariaLabel}>
          {results.map((candidate, index) => {
            const isSelected = index === selectedIndex;
            const itemStyle = isSelected
              ? {
                  ...baseItemStyle,
                  backgroundColor: "#eef2ff"
                }
              : baseItemStyle;
            const itemKey = getItemKey ? getItemKey(candidate, index) : `${index}`;
            return (
              <li key={itemKey}>
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
                  <span style={primaryTextStyle}>{getPrimaryText(candidate)}</span>
                  <span style={secondaryTextStyle}>{getSecondaryText(candidate)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export const formatBreadcrumb = (segments: ReadonlyArray<{ readonly text: string }>): string => {
  if (segments.length <= 1) {
    const value = segments[0]?.text ?? "";
    return value.trim().length > 0 ? value : "Root";
  }
  const parents = segments.slice(0, -1);
  if (parents.length === 0) {
    return "Root";
  }
  return parents
    .map((segment) => (segment.text.trim().length > 0 ? segment.text : "Untitled node"))
    .join(" / ");
};
