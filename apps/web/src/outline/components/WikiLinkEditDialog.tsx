/**
 * WikiLinkEditDialog renders the editing affordance for an existing wiki link, letting users adjust
 * the display text without entering full edit mode. It stays platform-local so shared logic just
 * invokes the callback to persist changes.
 */
import { useEffect, useRef } from "react";
import type { CSSProperties, KeyboardEvent } from "react";

import { useClampedFixedPosition } from "../hooks/useClampedFixedPosition";

interface WikiLinkEditDialogProps {
  readonly anchor: {
    readonly left: number;
    readonly top: number;
  };
  readonly displayText: string;
  readonly targetLabel: string;
  readonly onChange: (value: string) => void;
  readonly onCommit: () => void;
  readonly onCancel: () => void;
}

export const WikiLinkEditDialog = ({
  anchor,
  displayText,
  targetLabel,
  onChange,
  onCommit,
  onCancel
}: WikiLinkEditDialogProps): JSX.Element => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const position = useClampedFixedPosition(containerRef, anchor);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (!containerRef.current) {
        return;
      }
      if (containerRef.current.contains(event.target as Node)) {
        return;
      }
      onCancel();
    };
    window.addEventListener("mousedown", handler);
    return () => {
      window.removeEventListener("mousedown", handler);
    };
  }, [onCancel]);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const containerStyle: CSSProperties = {
    position: "fixed",
    left: position.left,
    top: position.top,
    minWidth: "240px",
    maxWidth: "320px",
    borderRadius: "0.75rem",
    border: "1px solid rgba(148, 163, 184, 0.24)",
    boxShadow: "0 20px 45px rgba(15, 23, 42, 0.18)",
    backgroundColor: "#ffffff",
    padding: "0.85rem",
    display: "flex",
    flexDirection: "column",
    gap: "0.75rem",
    zIndex: 2200
  };

  const labelStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: "0.3rem",
    fontSize: "0.8rem",
    color: "#475569"
  };

  const inputStyle: CSSProperties = {
    padding: "0.5rem 0.65rem",
    borderRadius: "0.5rem",
    border: "1px solid rgba(148, 163, 184, 0.35)",
    fontSize: "0.9rem",
    lineHeight: "1.25rem"
  };

  const buttonRowStyle: CSSProperties = {
    display: "flex",
    justifyContent: "flex-end",
    gap: "0.5rem"
  };

  const primaryButtonStyle: CSSProperties = {
    backgroundColor: "#4f46e5",
    color: "#ffffff",
    border: "none",
    borderRadius: "9999px",
    padding: "0.45rem 1.1rem",
    fontSize: "0.85rem",
    cursor: "pointer",
    boxShadow: "0 10px 18px rgba(79, 70, 229, 0.28)"
  };

  const ghostButtonStyle: CSSProperties = {
    backgroundColor: "transparent",
    color: "#475569",
    borderRadius: "9999px",
    border: "1px solid rgba(148, 163, 184, 0.45)",
    padding: "0.42rem 1rem",
    fontSize: "0.85rem",
    cursor: "pointer"
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      onCommit();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    }
  };

  return (
    <div ref={containerRef} style={containerStyle} data-outline-edit-dialog="true">
      <label style={labelStyle}>
        <span>Display text</span>
        <input
          ref={inputRef}
          type="text"
          value={displayText}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          style={inputStyle}
        />
      </label>
      <label style={labelStyle}>
        <span>Target node</span>
        <input type="text" value={targetLabel} readOnly style={{ ...inputStyle, backgroundColor: "#f8fafc" }} />
      </label>
      <div style={buttonRowStyle}>
        <button type="button" style={ghostButtonStyle} onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          style={primaryButtonStyle}
          onClick={onCommit}
          disabled={displayText.trim().length === 0}
        >
          Apply
        </button>
      </div>
    </div>
  );
};
