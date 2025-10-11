import { useEffect, useMemo, useRef } from "react";
import type { ChangeEvent, CSSProperties, KeyboardEvent } from "react";

import type { WikiLinkSearchCandidate } from "@thortiq/client-core";

import { InlineTriggerDialog, formatBreadcrumb } from "./InlineTriggerDialog";

interface FocusNodeDialogProps {
  readonly anchor: { readonly left: number; readonly bottom: number };
  readonly query: string;
  readonly results: ReadonlyArray<WikiLinkSearchCandidate>;
  readonly selectedIndex: number;
  readonly onQueryChange: (next: string) => void;
  readonly onSelect: (candidate: WikiLinkSearchCandidate) => void;
  readonly onHoverIndexChange?: (index: number) => void;
  readonly onRequestClose?: () => void;
  readonly onNavigate: (direction: 1 | -1) => void;
  readonly onConfirmSelection: () => void;
}

const headerContainerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "6px"
};

const queryInputStyle: CSSProperties = {
  flex: 1,
  padding: "8px 10px",
  borderRadius: "8px",
  border: "1px solid rgba(148,163,184,0.6)",
  fontSize: "0.95rem"
};

const descriptionStyle: CSSProperties = {
  fontSize: "0.75rem",
  color: "#475569"
};

export const FocusNodeDialog = ({
  anchor,
  query,
  results,
  selectedIndex,
  onQueryChange,
  onSelect,
  onHoverIndexChange,
  onRequestClose,
  onNavigate,
  onConfirmSelection
}: FocusNodeDialogProps): JSX.Element => {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) {
      return;
    }
    input.focus({ preventScroll: true });
    const length = input.value.length;
    try {
      input.setSelectionRange(length, length);
    } catch {
      // Safe to ignore; some browsers disallow setSelectionRange on certain input types.
    }
  }, []);

  const header = useMemo(() => {
    const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          onNavigate(1);
          break;
        case "ArrowUp":
          event.preventDefault();
          onNavigate(-1);
          break;
        case "Enter":
          event.preventDefault();
          onConfirmSelection();
          break;
        case "Escape":
          event.preventDefault();
          onRequestClose?.();
          break;
        default:
          break;
      }
    };

    const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
      onQueryChange(event.target.value);
    };

    return (
      <div style={headerContainerStyle}>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Search nodes"
          style={queryInputStyle}
          aria-label="Focus search query"
        />
        <span style={descriptionStyle}>Jump to a node without leaving the keyboard.</span>
      </div>
    );
  }, [onConfirmSelection, onNavigate, onQueryChange, onRequestClose, query]);

  return (
    <InlineTriggerDialog<WikiLinkSearchCandidate>
      anchor={anchor}
      query={query}
      results={results}
      selectedIndex={selectedIndex}
      getPrimaryText={(candidate) => (candidate.text.trim().length > 0 ? candidate.text : "Untitled node")}
      getSecondaryText={(candidate) => formatBreadcrumb(candidate.breadcrumb)}
      onSelect={onSelect}
      onHoverIndexChange={onHoverIndexChange}
      onRequestClose={onRequestClose}
      ariaLabel="Focus node suggestions"
      getItemKey={(candidate) => candidate.nodeId}
      header={header}
      emptyState={({ query: emptyQuery }) => (
        <div style={{ padding: "12px 16px", color: "#6b7280", fontSize: "0.85rem" }}>
          No matching nodes{emptyQuery ? ` for "${emptyQuery}"` : ""}
        </div>
      )}
    />
  );
};

