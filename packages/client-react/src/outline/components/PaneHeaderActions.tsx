import type { CSSProperties } from "react";
import React from "react";

export interface PaneHeaderActionsProps {
  readonly isSearchVisible: boolean;
  readonly onToggleSearch: () => void;
  readonly rightContent?: React.ReactNode;
  /** Optional accessible label for the search toggle button when search is hidden */
  readonly searchButtonAriaLabel?: string;
  /** Optional title tooltip for the search toggle button when search is hidden */
  readonly searchButtonTitle?: string;
}

const ICON_BUTTON_STYLE: CSSProperties = {
  border: "none",
  backgroundColor: "transparent",
  padding: 0,
  width: "1.75rem",
  height: "1.75rem",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  color: "#404144ff",
  outline: "none"
};

export const PaneHeaderActions = ({ isSearchVisible, onToggleSearch, rightContent, searchButtonAriaLabel, searchButtonTitle }: PaneHeaderActionsProps): JSX.Element => {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
      <button
        type="button"
        onClick={onToggleSearch}
        aria-label={isSearchVisible ? "Close search" : (searchButtonAriaLabel ?? "Search")}
        title={isSearchVisible ? "Close search" : (searchButtonTitle ?? searchButtonAriaLabel ?? "Search")}
        style={ICON_BUTTON_STYLE}
      >
        <svg focusable="false" viewBox="0 0 24 24" style={{ width: "1.1rem", height: "1.1rem" }} aria-hidden="true">
          <circle cx="11" cy="11" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <line x1="16.5" y1="16.5" x2="20" y2="20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      {rightContent}
    </div>
  );
};

export default PaneHeaderActions;


