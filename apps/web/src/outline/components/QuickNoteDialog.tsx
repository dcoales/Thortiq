import type { JSX } from "react";
import { useRef, useEffect, useMemo, type KeyboardEvent, type ChangeEvent } from "react";

interface QuickNoteDialogProps {
  readonly isOpen: boolean;
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly onSave: () => void;
  readonly onClose: () => void;
}

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(15, 23, 42, 0.45)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 50
};

const dialogStyle: React.CSSProperties = {
  width: "480px",
  maxWidth: "calc(100vw - 3rem)",
  background: "#ffffff",
  borderRadius: "0.75rem",
  boxShadow: "0 20px 50px rgba(15, 23, 42, 0.25)",
  padding: "1.5rem",
  display: "flex",
  flexDirection: "column",
  gap: "1rem",
  outline: "none"
};

const headerStyle: React.CSSProperties = {
  margin: 0,
  fontSize: "1.125rem",
  fontWeight: 600,
  color: "#0f172a"
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.625rem",
  fontSize: "0.9375rem",
  border: "1px solid #e2e8f0",
  borderRadius: "0.375rem",
  outline: "none",
  fontFamily: "inherit"
};

const buttonContainerStyle: React.CSSProperties = {
  display: "flex",
  gap: "0.5rem",
  justifyContent: "flex-end"
};

const buttonBaseStyle: React.CSSProperties = {
  padding: "0.5rem 1rem",
  fontSize: "0.875rem",
  fontWeight: 500,
  border: "none",
  borderRadius: "0.375rem",
  cursor: "pointer",
  transition: "background-color 0.15s"
};

const saveButtonStyle: React.CSSProperties = {
  ...buttonBaseStyle,
  background: "#3b82f6",
  color: "#ffffff"
};

const cancelButtonStyle: React.CSSProperties = {
  ...buttonBaseStyle,
  background: "#f1f5f9",
  color: "#475569"
};

export const QuickNoteDialog = ({
  isOpen,
  value,
  onValueChange,
  onSave,
  onClose
}: QuickNoteDialogProps): JSX.Element | null => {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSave();
    }
  };

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    onValueChange(event.target.value);
  };

  const handleOverlayClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div role="presentation" onClick={handleOverlayClick} style={overlayStyle}>
      <div
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby="quick-note-dialog-title"
        style={dialogStyle}
      >
        <h2 id="quick-note-dialog-title" style={headerStyle}>
          Quick Note
        </h2>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Enter your note"
          style={inputStyle}
          aria-label="Quick note text"
        />
        <div style={buttonContainerStyle}>
          <button type="button" onClick={onClose} style={cancelButtonStyle}>
            Cancel
          </button>
          <button type="button" onClick={onSave} style={saveButtonStyle}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
};

