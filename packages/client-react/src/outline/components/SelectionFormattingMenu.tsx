import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent
} from "react";

import type {
  CollaborativeEditor,
  HeadingLevel
} from "@thortiq/editor-prosemirror";
import type { ColorPaletteSnapshot } from "@thortiq/client-core";

import { FloatingSelectionMenu } from "./FloatingSelectionMenu";

export interface SelectionFormattingMenuProps {
  readonly editor: CollaborativeEditor | null;
  readonly portalContainer?: HTMLElement | null;
  readonly offset?: {
    readonly x?: number;
    readonly y?: number;
  };
  readonly colorPalette: ColorPaletteSnapshot;
  readonly onUpdateColorPalette: (swatches: ReadonlyArray<string>) => void;
}

type FormattingActionId =
  | "heading-1"
  | "heading-2"
  | "heading-3"
  | "heading-4"
  | "heading-5"
  | "bold"
  | "italic"
  | "underline"
  | "clear";

interface FormattingActionDescriptor {
  readonly id: FormattingActionId;
  readonly label: string;
  readonly ariaLabel: string;
  readonly ariaKeyShortcut?: string;
  readonly isToggle?: boolean;
  readonly isActive: boolean;
  readonly run: () => boolean;
  readonly shortcutHint?: string;
}

const HEX6_REGEX = /^#([0-9a-f]{6})$/i;
const HEX8_REGEX = /^#([0-9a-f]{8})$/i;

const toolbarStyle: CSSProperties = {
  position: "relative",
  display: "inline-flex",
  flexDirection: "column",
  gap: "0.35rem",
  alignItems: "stretch",
  backgroundColor: "rgba(17, 24, 39, 0.95)",
  color: "#f9fafb",
  borderRadius: "9999px",
  padding: "0.35rem 0.6rem",
  boxShadow: "0 10px 30px rgba(15, 23, 42, 0.25)"
};

const actionRowStyle: CSSProperties = {
  display: "inline-flex",
  gap: "0.25rem",
  alignItems: "center"
};

const baseButtonStyle: CSSProperties = {
  backgroundColor: "transparent",
  border: "none",
  color: "inherit",
  padding: "0.3rem 0.45rem",
  borderRadius: "0.375rem",
  fontSize: "0.82rem",
  fontWeight: 600,
  lineHeight: 1,
  cursor: "pointer"
};

const activeButtonStyle: CSSProperties = {
  backgroundColor: "rgba(59, 130, 246, 0.25)"
};

const hoverButtonStyle: CSSProperties = {
  backgroundColor: "rgba(255, 255, 255, 0.16)"
};

const dividerStyle: CSSProperties = {
  width: "1px",
  height: "20px",
  backgroundColor: "rgba(255, 255, 255, 0.24)"
};

const colorButtonStyle: CSSProperties = {
  ...baseButtonStyle,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "0.3rem",
  width: "2rem",
  height: "2rem"
};

const colorButtonIconStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "1.3rem",
  height: "1.3rem",
  fontWeight: 700,
  borderRadius: "0.35rem",
  fontSize: "0.9rem",
  lineHeight: 1
};

const textColorIconStyle: CSSProperties = {
  ...colorButtonIconStyle,
  color: "#ef4444",
  backgroundColor: "transparent"
};

const highlightColorIconStyle: CSSProperties = {
  ...colorButtonIconStyle,
  color: "#ffffff",
  backgroundColor: "#ef4444"
};

const toOpaqueHex = (value: string): string => {
  const normalized = value.trim().toLowerCase();
  if (HEX6_REGEX.test(normalized)) {
    return normalized;
  }
  if (HEX8_REGEX.test(normalized)) {
    return `#${normalized.slice(1, 7)}`;
  }
  return "#000000";
};

const composePaletteColor = (hex: string, existing?: string): string => {
  const normalized = hex.trim().toLowerCase();
  if (HEX8_REGEX.test(normalized) || HEX6_REGEX.test(normalized)) {
    return normalized;
  }
  if (existing) {
    const existingNormalized = existing.trim().toLowerCase();
    if (HEX8_REGEX.test(existingNormalized) || HEX6_REGEX.test(existingNormalized)) {
      return existingNormalized;
    }
  }
  return "#000000";
};

interface IconProps {
  readonly size?: number;
  readonly stroke?: string;
}

const IconPlus = ({ size = 18, stroke = "#1f2937" }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 20 20"
    fill="none"
    aria-hidden="true"
  >
    <path d="M10 4v12M4 10h12" stroke={stroke} strokeWidth={1.5} strokeLinecap="round" />
  </svg>
);

const IconCheck = ({ size = 18, stroke = "#ffffff" }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 20 20"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M5 10.5 8.5 14 15 7"
      stroke={stroke}
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const IconX = ({ size = 16, stroke = "#1f2937" }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 20 20"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="m6 6 8 8m0-8-8 8"
      stroke={stroke}
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const arraysEqual = (a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean => {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((value, index) => value.toLowerCase() === b[index]?.toLowerCase());
};

const isMarkActive = (editor: CollaborativeEditor, markName: string): boolean => {
  const markType = editor.view.state.schema.marks[markName];
  if (!markType) {
    return false;
  }
  const { state } = editor.view;
  const { selection } = state;
  if (selection.empty) {
    const storedMarks = state.storedMarks ?? null;
    if (storedMarks) {
      return storedMarks.some((mark) => mark.type === markType);
    }
    const from = (selection as { $from?: { marks?: () => unknown } }).$from;
    const marks = (from?.marks?.() ?? []) as ReadonlyArray<{ type?: unknown }>;
    return marks.some((mark) => mark?.type === markType);
  }
  return state.doc.rangeHasMark(selection.from, selection.to, markType);
};

const HEADING_LEVELS: readonly HeadingLevel[] = [1, 2, 3, 4, 5];

export const SelectionFormattingMenu = ({
  editor,
  portalContainer,
  offset,
  colorPalette,
  onUpdateColorPalette
}: SelectionFormattingMenuProps): JSX.Element | null => {
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const [openPaletteMode, setOpenPaletteMode] = useState<"text" | "background" | null>(null);

  useEffect(() => {
    if (!editor) {
      buttonRefs.current = [];
      setFocusedIndex(null);
      setOpenPaletteMode(null);
    }
  }, [editor]);

  const focusButtonAtIndex = useCallback((index: number) => {
    const button = buttonRefs.current[index];
    if (button) {
      button.focus();
      setFocusedIndex(index);
    }
  }, []);

  const handleKeyDown = useCallback(
    (
      event: KeyboardEvent<HTMLButtonElement>,
      index: number,
      total: number,
      activeEditor: CollaborativeEditor
    ) => {
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        const delta = event.key === "ArrowRight" ? 1 : -1;
        const nextIndex = (index + delta + total) % total;
        focusButtonAtIndex(nextIndex);
        return;
      }
      if (event.key === "Home") {
        event.preventDefault();
        focusButtonAtIndex(0);
        return;
      }
      if (event.key === "End") {
        event.preventDefault();
        focusButtonAtIndex(total - 1);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setFocusedIndex(null);
        activeEditor.focus();
      }
    },
    [focusButtonAtIndex]
  );

  const renderToolbar = (activeEditor: CollaborativeEditor) => {
      const headingLevel = activeEditor.getActiveHeadingLevel();
      const actions: FormattingActionDescriptor[] = [];

      actions.push(
        ...HEADING_LEVELS.map<FormattingActionDescriptor>((level) => ({
          id: `heading-${level}` as FormattingActionId,
          label: `H${level}`,
          ariaLabel: `Heading ${level}`,
          isToggle: true,
          isActive: headingLevel === level,
          run: () => activeEditor.toggleHeadingLevel(level),
          ariaKeyShortcut: `Control+Alt+${level}`,
          shortcutHint: `Ctrl+Alt+${level}`
        }))
      );

      const isBoldActive = isMarkActive(activeEditor, "strong");
      const isItalicActive = isMarkActive(activeEditor, "em");
      const isUnderlineActive = isMarkActive(activeEditor, "underline");

      actions.push(
        {
          id: "bold",
          label: "B",
          ariaLabel: "Bold",
          isToggle: true,
          isActive: isBoldActive,
          run: () => activeEditor.toggleBold(),
          ariaKeyShortcut: "Control+B",
          shortcutHint: "Ctrl+B"
        },
        {
          id: "italic",
          label: "I",
          ariaLabel: "Italic",
          isToggle: true,
          isActive: isItalicActive,
          run: () => activeEditor.toggleItalic(),
          ariaKeyShortcut: "Control+I",
          shortcutHint: "Ctrl+I"
        },
        {
          id: "underline",
          label: "U",
          ariaLabel: "Underline",
          isToggle: true,
          isActive: isUnderlineActive,
          run: () => activeEditor.toggleUnderline(),
          ariaKeyShortcut: "Control+U",
          shortcutHint: "Ctrl+U"
        },
        {
          id: "clear",
          label: "Clr",
          ariaLabel: "Clear formatting",
          isToggle: false,
          isActive: false,
          run: () => activeEditor.clearInlineFormatting()
        }
      );

      buttonRefs.current.length = actions.length;

      const handleActionClick = (descriptor: FormattingActionDescriptor): void => {
        const executed = descriptor.run();
        activeEditor.focus();
        if (executed) {
          setFocusedIndex(null);
        }
      };

      const applyTextColor = (color: string): void => {
        const applied = activeEditor.setTextColor(color);
        activeEditor.focus();
        if (applied) {
          setOpenPaletteMode(null);
        }
      };

      const applyBackgroundColor = (color: string): void => {
        const applied = activeEditor.setBackgroundColor(color);
        activeEditor.focus();
        if (applied) {
          setOpenPaletteMode(null);
        }
      };

      const clearTextColor = (): void => {
        const cleared = activeEditor.clearTextColor();
        activeEditor.focus();
        if (cleared) {
          setOpenPaletteMode(null);
        }
      };

      const clearBackgroundColor = (): void => {
        const cleared = activeEditor.clearBackgroundColor();
        activeEditor.focus();
        if (cleared) {
          setOpenPaletteMode(null);
        }
      };

      const isTextColorActive = isMarkActive(activeEditor, "textColor");
      const isBackgroundColorActive = isMarkActive(activeEditor, "backgroundColor");

      return (
        <div role="toolbar" aria-label="Text formatting" style={toolbarStyle}>
          <div style={actionRowStyle}>
            {actions.map((action, index) => (
              <button
                key={action.id}
                ref={(node) => {
                  buttonRefs.current[index] = node;
                }}
              type="button"
              style={{
                ...baseButtonStyle,
                ...(action.isToggle && action.isActive ? activeButtonStyle : undefined),
                ...(focusedIndex === index ? hoverButtonStyle : undefined),
                ...(action.id === "bold" ? { fontWeight: 800 } : undefined),
                ...(action.id === "italic" ? { fontStyle: "italic" } : undefined),
                ...(action.id === "underline" ? { textDecoration: "underline" } : undefined)
              }}
              data-formatting-action={action.id}
              aria-label={action.ariaLabel}
              aria-pressed={action.isToggle ? action.isActive : undefined}
              aria-keyshortcuts={action.ariaKeyShortcut}
              title={
                action.shortcutHint
                  ? `${action.ariaLabel} (${action.shortcutHint})`
                  : action.ariaLabel
              }
              onPointerDown={(event) => {
                event.preventDefault();
              }}
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                handleActionClick(action);
              }}
              onKeyDown={(event) => handleKeyDown(event, index, actions.length, activeEditor)}
              onFocus={() => setFocusedIndex(index)}
            >
              <span>{action.label}</span>
            </button>
            ))}
            <span style={dividerStyle} aria-hidden />
            <button
              type="button"
              style={{
                ...colorButtonStyle,
                ...(isTextColorActive ? activeButtonStyle : undefined),
                ...(openPaletteMode === "text" ? hoverButtonStyle : undefined)
              }}
              data-formatting-color-button="text"
              aria-expanded={openPaletteMode === "text"}
              aria-label="Text color"
              title="Text color"
              onPointerDown={(event) => event.preventDefault()}
              onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setOpenPaletteMode((current) => (current === "text" ? null : "text"));
              }}
            >
              <span aria-hidden style={textColorIconStyle}>A</span>
            </button>
            <button
              type="button"
              style={{
                ...colorButtonStyle,
                ...(isBackgroundColorActive ? activeButtonStyle : undefined),
                ...(openPaletteMode === "background" ? hoverButtonStyle : undefined)
              }}
              data-formatting-color-button="background"
              aria-expanded={openPaletteMode === "background"}
              aria-label="Highlight color"
              title="Highlight color"
              onPointerDown={(event) => event.preventDefault()}
              onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setOpenPaletteMode((current) => (current === "background" ? null : "background"));
              }}
            >
              <span aria-hidden style={highlightColorIconStyle}>A</span>
            </button>
          </div>
          {openPaletteMode ? (
            <ColorPalettePopover
              mode={openPaletteMode}
              palette={colorPalette}
              onApplyColor={openPaletteMode === "text" ? applyTextColor : applyBackgroundColor}
              onClearColor={openPaletteMode === "text" ? clearTextColor : clearBackgroundColor}
              onClose={() => setOpenPaletteMode(null)}
              onPersistPalette={onUpdateColorPalette}
            />
          ) : null}
        </div>
      );
    };

  if (!editor) {
    return null;
  }

  const menuOffset = offset ? { x: offset.x, y: offset.y } : undefined;

  return (
    <FloatingSelectionMenu
      editor={editor}
      portalContainer={portalContainer ?? undefined}
      offset={menuOffset}
      interactionLockActive={Boolean(openPaletteMode)}
    >
      {({ editor: activeEditor }) => renderToolbar(activeEditor)}
    </FloatingSelectionMenu>
  );
};

interface ColorPalettePopoverProps {
  readonly mode: "text" | "background";
  readonly palette: ColorPaletteSnapshot;
  readonly onApplyColor: (color: string) => void;
  readonly onClearColor: () => void;
  readonly onClose: () => void;
  readonly onPersistPalette: (swatches: ReadonlyArray<string>) => void;
}

const paletteContainerStyle: CSSProperties = {
  position: "absolute",
  top: "calc(100% + 8px)",
  left: "50%",
  transform: "translateX(-50%)",
  backgroundColor: "#ffffff",
  color: "#1f2937",
  borderRadius: "0.75rem",
  boxShadow: "0 18px 36px rgba(15, 23, 42, 0.24)",
  padding: "0.75rem 0.7rem",
  minWidth: "208px",
  maxHeight: "60vh",
  overflowY: "auto",
  zIndex: 20050,
  display: "flex",
  flexDirection: "column",
  gap: "0.65rem"
};

const paletteHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  fontWeight: 600,
  fontSize: "0.85rem"
};

const swatchGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(2.4rem, 1fr))",
  gap: "0.55rem",
  justifyItems: "center",
  alignItems: "center"
};

const swatchCellStyle: CSSProperties = {
  position: "relative",
  width: "2.5rem",
  height: "2.5rem",
  display: "flex",
  alignItems: "center",
  justifyContent: "center"
};

const swatchSquareBaseStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  borderRadius: "0.55rem",
  border: "1px solid rgba(148, 163, 184, 0.45)",
  boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.2)",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
  transition: "transform 120ms ease, box-shadow 120ms ease",
  backgroundClip: "padding-box"
};

const swatchRemoveButtonStyle: CSSProperties = {
  position: "absolute",
  top: "-0.4rem",
  right: "-0.4rem",
  width: "1.25rem",
  height: "1.25rem",
  borderRadius: "9999px",
  border: "1px solid rgba(148, 163, 184, 0.6)",
  backgroundColor: "#ffffff",
  boxShadow: "0 6px 12px rgba(15, 23, 42, 0.18)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  padding: 0
};

const swatchRemoveButtonDisabledStyle: CSSProperties = {
  opacity: 0.4,
  cursor: "not-allowed",
  boxShadow: "none"
};

const paletteActionsStyle: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  alignItems: "center",
  gap: "0.45rem",
  paddingTop: "0.2rem"
};

const iconButtonStyle: CSSProperties = {
  width: "2.1rem",
  height: "2.1rem",
  borderRadius: "0.55rem",
  border: "1px solid rgba(148, 163, 184, 0.55)",
  background: "#ffffff",
  color: "#1f2937",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  padding: 0,
  transition: "background-color 120ms ease, box-shadow 120ms ease"
};

const iconButtonPrimaryStyle: CSSProperties = {
  ...iconButtonStyle,
  background: "#2563eb",
  borderColor: "#2563eb",
  color: "#ffffff"
};

const iconButtonDisabledStyle: CSSProperties = {
  opacity: 0.55,
  cursor: "not-allowed",
  boxShadow: "none"
};

const iconButtonIconStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center"
};

const visuallyHiddenStyle: CSSProperties = {
  position: "absolute",
  width: "1px",
  height: "1px",
  padding: 0,
  margin: "-1px",
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0
};

const paletteFooterStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center"
};

const secondaryButtonStyle: CSSProperties = {
  background: "transparent",
  border: "1px solid rgba(148, 163, 184, 0.5)",
  color: "#1f2937",
  padding: "0.25rem 0.6rem",
  borderRadius: "0.5rem",
  fontSize: "0.75rem",
  cursor: "pointer"
};

const primaryButtonStyle: CSSProperties = {
  ...secondaryButtonStyle,
  backgroundColor: "#2563eb",
  borderColor: "#2563eb",
  color: "#ffffff"
};

const confirmationStyle: CSSProperties = {
  backgroundColor: "#f1f5f9",
  padding: "0.5rem 0.6rem",
  borderRadius: "0.5rem",
  display: "flex",
  flexDirection: "column",
  gap: "0.4rem",
  fontSize: "0.8rem"
};

const ColorPalettePopover = ({
  mode,
  palette,
  onApplyColor,
  onClearColor,
  onClose,
  onPersistPalette
}: ColorPalettePopoverProps): JSX.Element => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const addInputRef = useRef<HTMLInputElement | null>(null);
  const swatchInputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [draftSwatches, setDraftSwatches] = useState<ReadonlyArray<string>>(palette.swatches);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [pendingClose, setPendingClose] = useState(false);

  useEffect(() => {
    if (!isEditing) {
      setDraftSwatches(palette.swatches);
    }
  }, [palette.swatches, isEditing]);

  const hasChanges = useMemo(
    () => !arraysEqual(draftSwatches, palette.swatches),
    [draftSwatches, palette.swatches]
  );

  const attemptClose = useCallback(() => {
    if (isEditing && hasChanges) {
      setConfirmingCancel(true);
      setPendingClose(true);
      return;
    }
    setIsEditing(false);
    setConfirmingCancel(false);
    setPendingClose(false);
    onClose();
  }, [hasChanges, isEditing, onClose]);

  useEffect(() => {
    const handlePointerDown = (event: globalThis.MouseEvent) => {
      if (!containerRef.current) {
        return;
      }
      if (containerRef.current.contains(event.target as Node)) {
        return;
      }
      attemptClose();
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        attemptClose();
      }
    };
    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [attemptClose]);

  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!isEditing) {
      swatchInputRefs.current = [];
    }
  }, [isEditing]);

  const modeLabel = mode === "text" ? "Text color" : "Highlight color";

  const handleSwatchSelection = (swatch: string) => {
    onApplyColor(swatch);
    onClose();
  };

  const handleAddColorClick = () => {
    addInputRef.current?.click();
  };

  const handleEditSwatch = (index: number) => {
    const input = swatchInputRefs.current[index];
    if (input) {
      input.click();
    }
  };

  const handleAddColor = (hex: string) => {
    const paletteColor = composePaletteColor(hex, undefined);
    setDraftSwatches((current) => [...current, paletteColor]);
  };

  const handleChangeSwatch = (index: number, hex: string) => {
    setDraftSwatches((current) => {
      const next = [...current];
      next[index] = composePaletteColor(hex, current[index]);
      return next;
    });
  };

  const handleRemoveSwatch = (index: number) => {
    setDraftSwatches((current) => {
      if (current.length <= 1) {
        return current;
      }
      const next = [...current];
      next.splice(index, 1);
      return next;
    });
  };

  const handleStartEditing = () => {
    setDraftSwatches(palette.swatches);
    setIsEditing(true);
    setConfirmingCancel(false);
    setPendingClose(false);
  };

  const handleSavePalette = () => {
    onPersistPalette(draftSwatches);
    setIsEditing(false);
    setConfirmingCancel(false);
    setPendingClose(false);
  };

  const handleCancelEditing = () => {
    if (hasChanges) {
      setConfirmingCancel(true);
      setPendingClose(false);
    } else {
      setIsEditing(false);
      setConfirmingCancel(false);
      setPendingClose(false);
      setDraftSwatches(palette.swatches);
    }
  };

  const confirmDiscardChanges = () => {
    setIsEditing(false);
    setConfirmingCancel(false);
    const shouldClose = pendingClose;
    setPendingClose(false);
    setDraftSwatches(palette.swatches);
    if (shouldClose) {
      onClose();
    }
  };

  const continueEditing = () => {
    setConfirmingCancel(false);
    setPendingClose(false);
  };

  return (
    <div
      ref={containerRef}
      style={paletteContainerStyle}
      data-formatting-color-popover={mode}
      tabIndex={-1}
    >
      <div style={paletteHeaderStyle}>
        <span>{modeLabel}</span>
        {!isEditing ? (
          <button
            type="button"
            style={secondaryButtonStyle}
            onClick={handleStartEditing}
          >
            Edit palette
          </button>
        ) : null}
      </div>
      <div style={swatchGridStyle}>
        {(isEditing ? draftSwatches : palette.swatches).map((swatch, index) => {
          if (isEditing) {
            return (
              <div
                key={`${swatch}-${index}-edit`}
                style={swatchCellStyle}
              >
                <button
                  type="button"
                  style={{
                    ...swatchSquareBaseStyle,
                    background: swatch
                  }}
                  onClick={() => handleEditSwatch(index)}
                  title={`Edit swatch ${index + 1}`}
                  aria-label={`Edit color swatch ${index + 1}`}
                >
                  <span style={visuallyHiddenStyle}>
                    Edit color swatch {index + 1}
                  </span>
                </button>
                <input
                  ref={(node) => {
                    swatchInputRefs.current[index] = node;
                  }}
                  type="color"
                  style={{ display: "none" }}
                  value={toOpaqueHex(swatch)}
                  onChange={(event) => handleChangeSwatch(index, event.target.value)}
                  data-formatting-color-swatch-input={index}
                  aria-hidden="true"
                />
                <button
                  type="button"
                  style={{
                    ...swatchRemoveButtonStyle,
                    ...(draftSwatches.length <= 1 ? swatchRemoveButtonDisabledStyle : undefined)
                  }}
                  onClick={() => handleRemoveSwatch(index)}
                  disabled={draftSwatches.length <= 1}
                  title="Remove color"
                  aria-label={`Remove color swatch ${index + 1}`}
                >
                  <span style={visuallyHiddenStyle}>
                    Remove color swatch {index + 1}
                  </span>
                  <span aria-hidden style={iconButtonIconStyle}>
                    <IconX size={10} stroke="#1f2937" />
                  </span>
                </button>
              </div>
            );
          }
          return (
            <div
              key={`${swatch}-${index}-view`}
              style={swatchCellStyle}
            >
              <button
                type="button"
                style={{
                  ...swatchSquareBaseStyle,
                  background: swatch
                }}
                aria-label={`Set ${modeLabel.toLowerCase()} to ${swatch}`}
                title={`Set ${modeLabel.toLowerCase()} to ${swatch}`}
                onClick={() => handleSwatchSelection(swatch)}
              />
            </div>
          );
        })}
      </div>
      {isEditing ? (
        <div style={paletteActionsStyle}>
          <button
            type="button"
            style={iconButtonStyle}
            onClick={handleAddColorClick}
            title="Add color"
            aria-label="Add color"
          >
            <span style={visuallyHiddenStyle}>Add color</span>
            <span aria-hidden style={iconButtonIconStyle}>
              <IconPlus />
            </span>
          </button>
          <input
            ref={addInputRef}
            type="color"
            style={{ display: "none" }}
            onChange={(event) => {
              if (event.target.value) {
                handleAddColor(event.target.value);
              }
            }}
            data-formatting-color-add-input="true"
            aria-hidden="true"
          />
          <button
            type="button"
            style={{
              ...iconButtonPrimaryStyle,
              ...(hasChanges ? undefined : iconButtonDisabledStyle)
            }}
            onClick={handleSavePalette}
            disabled={!hasChanges}
            title="Save palette"
            aria-label="Save palette"
          >
            <span style={visuallyHiddenStyle}>Save palette</span>
            <span aria-hidden style={iconButtonIconStyle}>
              <IconCheck />
            </span>
          </button>
          <button
            type="button"
            style={iconButtonStyle}
            onClick={handleCancelEditing}
            title="Cancel editing"
            aria-label="Cancel editing"
          >
            <span style={visuallyHiddenStyle}>Cancel editing</span>
            <span aria-hidden style={iconButtonIconStyle}>
              <IconX />
            </span>
          </button>
        </div>
      ) : (
        <div style={paletteFooterStyle}>
          <button type="button" style={secondaryButtonStyle} onClick={onClearColor}>
            Clear {mode === "text" ? "text" : "highlight"}
          </button>
          <button type="button" style={secondaryButtonStyle} onClick={attemptClose}>
            Close
          </button>
        </div>
      )}
      {confirmingCancel ? (
        <div style={confirmationStyle} role="alert">
          <span>Discard palette changes?</span>
          <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
            <button type="button" style={secondaryButtonStyle} onClick={continueEditing}>
              Keep editing
            </button>
            <button type="button" style={primaryButtonStyle} onClick={confirmDiscardChanges}>
              Discard
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
};
