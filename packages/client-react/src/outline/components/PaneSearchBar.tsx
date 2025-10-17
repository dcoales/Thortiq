import { useCallback, useEffect, useMemo, useRef } from "react";
import type { CSSProperties, FormEvent, KeyboardEvent, ChangeEvent, ReactNode, RefObject } from "react";
import type { PaneSearchController, PaneSearchSubmitResult } from "../usePaneSearch";

interface PaneSearchBarProps {
  readonly controller: PaneSearchController;
  readonly placeholder?: string;
  readonly ariaLabel?: string;
  readonly leftAdornment?: ReactNode;
  readonly inputRef?: RefObject<HTMLInputElement> | null;
  readonly parseError?: string | null;
  readonly onParseErrorChange?: (message: string | null) => void;
  readonly autoSubmitDelayMs?: number;
  readonly onEscape?: () => void;
}

const DEFAULT_AUTO_SUBMIT_DELAY_MS = 1000;

export const PaneSearchBar = ({
  controller,
  placeholder = "Search…",
  ariaLabel,
  leftAdornment,
  inputRef,
  parseError,
  onParseErrorChange,
  autoSubmitDelayMs = DEFAULT_AUTO_SUBMIT_DELAY_MS,
  onEscape
}: PaneSearchBarProps): JSX.Element => {
  const lastAutoSubmitAttemptRef = useRef<string | null>(null);
  const localInputRef = useRef<HTMLInputElement | null>(null);
  const resolvedInputRef = inputRef ?? localInputRef;

  const searchFormStyle = useMemo<CSSProperties>(() => ({
    display: "flex",
    alignItems: "center",
    flex: 1,
    minWidth: 0,
    border: `1px solid ${parseError ? "#f87171" : "#aaabad"}`,
    borderRadius: "9999px",
    padding: "0.0625rem 0.75rem",
    backgroundColor: "#ffffff"
  }), [parseError]);

  const handleSubmit = useCallback(() => {
    const result: PaneSearchSubmitResult = controller.submit();
    const trimmedDraft = controller.draft.trim();
    lastAutoSubmitAttemptRef.current = trimmedDraft;
    if (!result.ok) {
      onParseErrorChange?.(result.error.message);
      const element = resolvedInputRef.current;
      if (element) {
        const start = Number.isFinite(result.error.start) ? result.error.start : element.selectionStart ?? 0;
        const end = Number.isFinite(result.error.end) ? (result.error.end ?? start) : start;
        try {
          element.setSelectionRange(start, end);
        } catch {
          // ignore invalid ranges
        }
      }
      return;
    }
    onParseErrorChange?.(null);
  }, [controller, onParseErrorChange, resolvedInputRef]);

  const handleInputChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    if (parseError) {
      onParseErrorChange?.(null);
    }
    controller.setDraft(event.target.value);
    lastAutoSubmitAttemptRef.current = null;
  }, [controller, onParseErrorChange, parseError]);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      controller.clearResults();
      controller.hideInput();
      onParseErrorChange?.(null);
      onEscape?.();
    }
  }, [controller, onEscape, onParseErrorChange]);

  const handleClearClick = useCallback(() => {
    const hasDraft = controller.draft.trim().length > 0;
    const hasSubmitted = Boolean(controller.submitted && controller.submitted.length > 0);
    const hasResults = controller.resultEdgeIds.length > 0;
    if (hasDraft || hasSubmitted || hasResults) {
      controller.clearResults();
      onParseErrorChange?.(null);
      return;
    }
    controller.clearResults();
    controller.hideInput();
    onParseErrorChange?.(null);
  }, [controller, onParseErrorChange]);

  useEffect(() => {
    if (!controller.isInputVisible) {
      lastAutoSubmitAttemptRef.current = null;
      return;
    }
    const element = resolvedInputRef.current;
    if (element) {
      element.focus();
      const end = element.value.length;
      element.setSelectionRange(end, end);
    }
  }, [controller.isInputVisible, resolvedInputRef]);

  useEffect(() => {
    if (!controller.isInputVisible) {
      return;
    }
    const trimmedDraft = controller.draft.trim();
    const trimmedSubmitted = (controller.submitted ?? "").trim();
    if (trimmedDraft.length === 0 && trimmedSubmitted.length === 0 && controller.resultEdgeIds.length === 0) {
      lastAutoSubmitAttemptRef.current = null;
      return;
    }
    if (trimmedDraft === trimmedSubmitted) {
      lastAutoSubmitAttemptRef.current = trimmedDraft;
      return;
    }
    if (lastAutoSubmitAttemptRef.current === trimmedDraft) {
      return;
    }
    const timer = window.setTimeout(() => {
      handleSubmit();
    }, autoSubmitDelayMs);
    return () => window.clearTimeout(timer);
  }, [autoSubmitDelayMs, controller.draft, controller.isInputVisible, controller.resultEdgeIds.length, controller.submitted, handleSubmit]);

  const handleFormSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    handleSubmit();
  }, [handleSubmit]);

  return (
    <div style={styles.searchBar}>
      {leftAdornment}
      <form style={searchFormStyle} onSubmit={handleFormSubmit}>
        <input
          ref={resolvedInputRef}
          type="text"
          value={controller.draft}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          aria-label={ariaLabel}
          aria-invalid={parseError ? true : false}
          style={styles.searchInput}
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
        />
        <button
          type="button"
          style={styles.searchClearButton}
          onClick={handleClearClick}
          aria-label="Clear search"
          title="Clear search"
        >
          ×
        </button>
      </form>
      {parseError ? (
        <p style={styles.searchFeedback} role="alert">{parseError}</p>
      ) : null}
    </div>
  );
};

const styles: Record<string, CSSProperties> = {
  searchBar: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    width: "100%",
    marginBottom: "0.5rem"
  },
  searchInput: {
    flex: 1,
    border: "none",
    background: "none",
    font: "inherit",
    color: "#404144",
    outline: "none",
    padding: "0.0625rem 0",
    minWidth: 0
  },
  searchClearButton: {
    border: "none",
    background: "none",
    color: "#6b7280",
    fontSize: "0.875rem",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    width: "1rem",
    height: "1rem",
    marginLeft: "0.5rem",
    marginRight: "0.25rem",
    outline: "none"
  },
  searchFeedback: {
    margin: "-0.25rem 0 0 1.5rem",
    fontSize: "0.75rem",
    color: "#b91c1c"
  }
};

export default PaneSearchBar;


