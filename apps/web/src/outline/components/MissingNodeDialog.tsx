import type { JSX } from "react";
import { useRef, useEffect } from "react";

interface MissingNodeDialogProps {
  readonly isOpen: boolean;
  readonly nodeType: "Inbox" | "Journal";
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

const contentStyle: React.CSSProperties = {
  fontSize: "0.9375rem",
  lineHeight: "1.5",
  color: "#374151"
};

const buttonStyle: React.CSSProperties = {
  padding: "0.5rem 1rem",
  fontSize: "0.875rem",
  fontWeight: 500,
  border: "none",
  borderRadius: "0.375rem",
  cursor: "pointer",
  background: "#3b82f6",
  color: "#ffffff",
  transition: "background-color 0.15s",
  alignSelf: "flex-end"
};

export const MissingNodeDialog = ({
  isOpen,
  nodeType,
  onClose
}: MissingNodeDialogProps): JSX.Element | null => {
  const dialogRef = useRef<HTMLDivElement | null>(null);

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
    if (isOpen && dialogRef.current) {
      dialogRef.current.focus();
    }
  }, [isOpen]);

  const handleOverlayClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  if (!isOpen) {
    return null;
  }

  const instructions = nodeType === "Inbox" 
    ? "To create an Inbox node, right-click on any node and select 'Turn Into' → 'Inbox' from the context menu. The Inbox node will be used to collect quick notes and other items."
    : "To create a Journal node, right-click on any node and select 'Turn Into' → 'Journal' from the context menu. The Journal node will be used for daily notes and journaling.";

  return (
    <div role="presentation" onClick={handleOverlayClick} style={overlayStyle}>
      <div
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby="missing-node-dialog-title"
        style={dialogStyle}
      >
        <h2 id="missing-node-dialog-title" style={headerStyle}>
          No {nodeType} Node Found
        </h2>
        <div style={contentStyle}>
          <p>There is no {nodeType.toLowerCase()} node set up yet.</p>
          <p>{instructions}</p>
        </div>
        <button type="button" onClick={onClose} style={buttonStyle}>
          OK
        </button>
      </div>
    </div>
  );
};
