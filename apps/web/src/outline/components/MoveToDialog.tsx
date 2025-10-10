import { useEffect, useMemo, useRef } from "react";
import type { ChangeEvent, CSSProperties, KeyboardEvent } from "react";

import type { MoveTargetCandidate } from "@thortiq/client-core";
import type { MoveToInsertionPosition } from "@thortiq/outline-commands";

import { InlineTriggerDialog, formatBreadcrumb } from "./InlineTriggerDialog";

interface MoveToDialogProps {
  readonly anchor: { readonly left: number; readonly bottom: number };
  readonly query: string;
  readonly results: ReadonlyArray<MoveTargetCandidate>;
  readonly selectedIndex: number;
  readonly insertPosition: MoveToInsertionPosition;
  readonly onQueryChange: (next: string) => void;
  readonly onSelect: (candidate: MoveTargetCandidate) => void;
  readonly onHoverIndexChange?: (index: number) => void;
  readonly onRequestClose?: () => void;
  readonly onNavigate: (direction: 1 | -1) => void;
  readonly onConfirmSelection: () => void;
  readonly onPositionChange: (next: MoveToInsertionPosition) => void;
}

const headerContainerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "8px"
};

const controlsRowStyle: CSSProperties = {
  display: "flex",
  gap: "8px",
  alignItems: "center"
};

const queryInputStyle: CSSProperties = {
  flex: 1,
  padding: "8px 10px",
  borderRadius: "8px",
  border: "1px solid rgba(148,163,184,0.6)",
  fontSize: "0.95rem"
};

const positionSelectStyle: CSSProperties = {
  padding: "7px 10px",
  borderRadius: "8px",
  border: "1px solid rgba(148,163,184,0.6)",
  fontSize: "0.85rem",
  backgroundColor: "#ffffff"
};

const descriptionStyle: CSSProperties = {
  fontSize: "0.75rem",
  color: "#475569"
};

export const MoveToDialog = ({
  anchor,
  query,
  results,
  selectedIndex,
  insertPosition,
  onQueryChange,
  onSelect,
  onHoverIndexChange,
  onRequestClose,
  onNavigate,
  onConfirmSelection,
  onPositionChange
}: MoveToDialogProps): JSX.Element => {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
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

    const handleSelectChange = (event: ChangeEvent<HTMLSelectElement>) => {
      const value = event.target.value === "start" ? "start" : "end";
      onPositionChange(value);
    };

    return (
      <div style={headerContainerStyle}>
        <div style={controlsRowStyle}>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search nodes"
            style={queryInputStyle}
            aria-label="Move selection search query"
          />
          <select
            value={insertPosition}
            onChange={handleSelectChange}
            style={positionSelectStyle}
            aria-label="Insert position"
          >
            <option value="start">First child</option>
            <option value="end">Last child</option>
          </select>
        </div>
        <span style={descriptionStyle}>Select a destination node to move the current selection.</span>
      </div>
    );
  }, [insertPosition, onConfirmSelection, onNavigate, onPositionChange, onQueryChange, onRequestClose, query]);

  return (
    <InlineTriggerDialog<MoveTargetCandidate>
      anchor={anchor}
      query={query}
      results={results}
      selectedIndex={selectedIndex}
      getPrimaryText={(candidate) =>
        candidate.text.length > 0 ? candidate.text : candidate.isRoot ? "Root" : "Untitled node"
      }
      getSecondaryText={(candidate) =>
        candidate.isRoot ? "Top level" : formatBreadcrumb(candidate.breadcrumb)
      }
      onSelect={onSelect}
      onHoverIndexChange={onHoverIndexChange}
      onRequestClose={onRequestClose}
      ariaLabel="Move selection destinations"
      getItemKey={(candidate, index) => `${candidate.parentNodeId ?? "root"}-${index}`}
      header={header}
    />
  );
};
