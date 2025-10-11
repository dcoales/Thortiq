import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent
} from "react";
import { createPortal } from "react-dom";

import type { CollaborativeEditor } from "@thortiq/editor-prosemirror";
import type { ColorPaletteSnapshot } from "@thortiq/client-core";

import { FloatingSelectionMenu } from "./FloatingSelectionMenu";
import {
  getFormattingActionDefinitions,
  type FormattingActionId
} from "../formatting/formattingDefinitions";

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

const clamp = (value: number, min: number, max: number): number => {
  if (Number.isNaN(value)) {
    return min;
  }
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
};

const normalizeHexColor = (value: string): string => {
  const normalized = value.trim().toLowerCase();
  if (HEX6_REGEX.test(normalized)) {
    return normalized;
  }
  if (HEX8_REGEX.test(normalized)) {
    return `#${normalized.slice(1, 7)}`;
  }
  if (normalized.startsWith("#") && normalized.length === 4) {
    const r = normalized[1];
    const g = normalized[2];
    const b = normalized[3];
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return "#000000";
};

const hexToRgb = (hex: string): { r: number; g: number; b: number } => {
  const normalized = normalizeHexColor(hex);
  const value = normalized.slice(1);
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return { r, g, b };
};

const rgbToHex = (r: number, g: number, b: number): string => {
  const toHex = (component: number) => {
    const clamped = clamp(Math.round(component), 0, 255);
    const hex = clamped.toString(16);
    return hex.length === 1 ? `0${hex}` : hex;
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

const rgbToHsv = ({ r, g, b }: { r: number; g: number; b: number }): {
  h: number;
  s: number;
  v: number;
} => {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === red) {
      h = ((green - blue) / delta) % 6;
    } else if (max === green) {
      h = (blue - red) / delta + 2;
    } else {
      h = (red - green) / delta + 4;
    }
  }
  h = (h * 60 + 360) % 360;
  const s = max === 0 ? 0 : delta / max;
  const v = max;
  return { h, s, v };
};

const hsvToRgb = ({ h, s, v }: { h: number; s: number; v: number }): {
  r: number;
  g: number;
  b: number;
} => {
  const hue = clamp(h, 0, 360);
  const saturation = clamp(s, 0, 1);
  const value = clamp(v, 0, 1);
  const c = value * saturation;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = value - c;
  let rPrime = 0;
  let gPrime = 0;
  let bPrime = 0;
  if (hue < 60) {
    rPrime = c;
    gPrime = x;
  } else if (hue < 120) {
    rPrime = x;
    gPrime = c;
  } else if (hue < 180) {
    gPrime = c;
    bPrime = x;
  } else if (hue < 240) {
    gPrime = x;
    bPrime = c;
  } else if (hue < 300) {
    rPrime = x;
    bPrime = c;
  } else {
    rPrime = c;
    bPrime = x;
  }
  return {
    r: (rPrime + m) * 255,
    g: (gPrime + m) * 255,
    b: (bPrime + m) * 255
  };
};

const hsvToHex = (hsv: { h: number; s: number; v: number }): string => {
  const rgb = hsvToRgb(hsv);
  return rgbToHex(rgb.r, rgb.g, rgb.b);
};

const hexToHsv = (hex: string): { h: number; s: number; v: number } => {
  return rgbToHsv(hexToRgb(hex));
};

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
  const inlineFormattingDefinitions = useMemo(
    () =>
      getFormattingActionDefinitions().filter((definition) =>
        definition.contexts.includes("inline")
      ),
    []
  );

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
      const markState = {
        bold: isMarkActive(activeEditor, "strong"),
        italic: isMarkActive(activeEditor, "em"),
        underline: isMarkActive(activeEditor, "underline"),
        strikethrough: isMarkActive(activeEditor, "strikethrough")
      } as const;

      const actions = inlineFormattingDefinitions
        .map<FormattingActionDescriptor | null>((definition) => {
          switch (definition.type) {
            case "heading": {
              const level = definition.headingLevel;
              if (!level) {
                return null;
              }
              return {
                id: definition.id,
                label: definition.toolbarLabel,
                ariaLabel: definition.ariaLabel,
                isToggle: true,
                isActive: headingLevel === level,
                ariaKeyShortcut: definition.ariaKeyShortcut,
                shortcutHint: definition.shortcutHint,
                run: () => activeEditor.toggleHeadingLevel(level)
              };
            }
            case "inlineMark": {
              const mark = definition.inlineMark;
              if (!mark) {
                return null;
              }
              const run = (() => {
                switch (mark) {
                  case "bold":
                    return () => activeEditor.toggleBold();
                  case "italic":
                    return () => activeEditor.toggleItalic();
                  case "underline":
                    return () => activeEditor.toggleUnderline();
                  case "strikethrough":
                    return () => activeEditor.toggleStrikethrough();
                  default:
                    return () => false;
                }
              })();
              const isActive = (() => {
                switch (mark) {
                  case "bold":
                    return markState.bold;
                  case "italic":
                    return markState.italic;
                  case "underline":
                    return markState.underline;
                  case "strikethrough":
                    return markState.strikethrough;
                  default:
                    return false;
                }
              })();
              return {
                id: definition.id,
                label: definition.toolbarLabel,
                ariaLabel: definition.ariaLabel,
                isToggle: true,
                isActive,
                ariaKeyShortcut: definition.ariaKeyShortcut,
                shortcutHint: definition.shortcutHint,
                run
              } satisfies FormattingActionDescriptor;
            }
            case "clear":
              return {
                id: definition.id,
                label: definition.toolbarLabel,
                ariaLabel: definition.ariaLabel,
                isToggle: false,
                isActive: false,
                ariaKeyShortcut: definition.ariaKeyShortcut,
                shortcutHint: definition.shortcutHint,
                run: () => activeEditor.clearInlineFormatting()
              } satisfies FormattingActionDescriptor;
            default:
              return null;
          }
        })
        .filter((action): action is FormattingActionDescriptor => action !== null);

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
                ...(action.id === "underline" ? { textDecoration: "underline" } : undefined),
                ...(action.id === "strikethrough" ? { textDecoration: "line-through" } : undefined)
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

const swatchEditorPopoverStyle: CSSProperties = {
  backgroundColor: "#ffffff",
  borderRadius: "0.75rem",
  boxShadow: "0 18px 36px rgba(15, 23, 42, 0.25)",
  padding: "0.75rem",
  width: "220px",
  zIndex: 20060,
  display: "flex",
  flexDirection: "column",
  gap: "0.65rem"
};

const swatchEditorHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  fontSize: "0.82rem",
  fontWeight: 600,
  color: "#1f2937"
};

const swatchEditorPreviewStyle: CSSProperties = {
  width: "100%",
  height: "1.75rem",
  borderRadius: "0.5rem",
  border: "1px solid rgba(148, 163, 184, 0.5)",
  boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.2)"
};

const swatchEditorCanvasStyle: CSSProperties = {
  position: "relative",
  width: "100%",
  height: "140px",
  borderRadius: "0.65rem",
  overflow: "hidden",
  cursor: "crosshair"
};

const swatchEditorCanvasOverlayStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  backgroundImage:
    "linear-gradient(to top, rgba(0,0,0,1), rgba(0,0,0,0)), linear-gradient(to right, rgba(255,255,255,1), rgba(255,255,255,0))"
};

const swatchEditorCanvasThumbStyle: CSSProperties = {
  position: "absolute",
  width: "14px",
  height: "14px",
  borderRadius: "9999px",
  border: "2px solid #ffffff",
  boxShadow: "0 2px 6px rgba(15, 23, 42, 0.45)",
  transform: "translate(-50%, -50%)"
};

const swatchEditorHueTrackStyle: CSSProperties = {
  width: "100%",
  height: "12px",
  borderRadius: "9999px",
  background:
    "linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)",
  position: "relative"
};

const swatchEditorHueSliderStyle: CSSProperties = {
  width: "100%"
};

const swatchEditorHexInputStyle: CSSProperties = {
  width: "100%",
  padding: "0.4rem 0.5rem",
  borderRadius: "0.5rem",
  border: "1px solid rgba(148, 163, 184, 0.55)",
  fontSize: "0.8rem",
  fontFamily: "inherit"
};

const swatchEditorFooterStyle: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: "0.4rem"
};

const swatchEditorButtonStyle: CSSProperties = {
  padding: "0.35rem 0.7rem",
  borderRadius: "0.5rem",
  border: "1px solid rgba(148, 163, 184, 0.55)",
  background: "#f8fafc",
  color: "#1f2937",
  fontSize: "0.78rem",
  cursor: "pointer"
};

const swatchEditorPrimaryButtonStyle: CSSProperties = {
  ...swatchEditorButtonStyle,
  background: "#2563eb",
  borderColor: "#2563eb",
  color: "#ffffff"
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

const swatchRemoveIconStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center"
};

const IconX = ({ size = 16, stroke = "#1f2937" }: { size?: number; stroke?: string }) => (
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

const paletteActionsStyle: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  alignItems: "center",
  gap: "0.45rem",
  paddingTop: "0.2rem"
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

interface ColorSwatchEditorPopoverProps {
  readonly color: string;
  readonly anchor: {
    left: number;
    top: number;
    width: number;
    height: number;
    viewportWidth: number;
    viewportHeight: number;
  } | null;
  readonly onSelect: (hex: string) => void;
  readonly onCancel: () => void;
}

const ColorSwatchEditorPopover = ({
  color,
  anchor,
  onSelect,
  onCancel
}: ColorSwatchEditorPopoverProps): JSX.Element | null => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [popoverSize, setPopoverSize] = useState<{ width: number; height: number } | null>(null);
  const [hsv, setHsv] = useState(() => hexToHsv(color));
  const [hexInput, setHexInput] = useState(() => normalizeHexColor(color));
  const [dragPointerId, setDragPointerId] = useState<number | null>(null);

  useEffect(() => {
    const normalized = normalizeHexColor(color);
    setHsv(hexToHsv(normalized));
    setHexInput(normalized);
  }, [color]);

  useEffect(() => {
    if (!anchor) {
      return;
    }
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onCancel, anchor]);

  const updateFromCanvas = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) {
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / rect.width, 0, 1);
      const y = clamp((clientY - rect.top) / rect.height, 0, 1);
      const next = { ...hsv, s: x, v: 1 - y };
      setHsv(next);
      setHexInput(hsvToHex(next));
    },
    [hsv]
  );

  const handleCanvasPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const pointerId = event.pointerId;
    setDragPointerId(pointerId);
    event.currentTarget.setPointerCapture(pointerId);
    updateFromCanvas(event.clientX, event.clientY);
  };

  const handleCanvasPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragPointerId !== event.pointerId) {
      return;
    }
    event.preventDefault();
    updateFromCanvas(event.clientX, event.clientY);
  };

  const handleCanvasPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragPointerId !== event.pointerId) {
      return;
    }
    event.currentTarget.releasePointerCapture(event.pointerId);
    setDragPointerId(null);
  };

  const handleHueChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const hue = Number.parseFloat(event.target.value);
    if (Number.isNaN(hue)) {
      return;
    }
    const next = { ...hsv, h: hue };
    setHsv(next);
    setHexInput(hsvToHex(next));
  };

  const handleHexChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setHexInput(value);
    const trimmed = value.trim().toLowerCase();
    if (HEX6_REGEX.test(trimmed)) {
      const normalized = normalizeHexColor(trimmed);
      setHsv(hexToHsv(normalized));
    }
  };

  const handleSelect = () => {
    const trimmed = hexInput.trim().toLowerCase();
    const normalized = HEX6_REGEX.test(trimmed) ? normalizeHexColor(trimmed) : hsvToHex(hsv);
    onSelect(normalized);
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => {
        const menu = document.querySelector('[data-formatting-color-popover]');
        if (menu instanceof HTMLElement) {
          menu.focus();
        }
      });
    }
  };

  const hueColor = hsvToHex({ h: hsv.h, s: 1, v: 1 });
  const previewColor = hsvToHex(hsv);
  const hexIsValid = HEX6_REGEX.test(hexInput.trim().toLowerCase());

  const portalTarget: Element | null = typeof window !== "undefined" ? window.document.body : null;

  useLayoutEffect(() => {
    if (!anchor) {
      return;
    }
    const node = containerRef.current;
    if (!node) {
      return;
    }
    const measure = () => {
      const rect = node.getBoundingClientRect();
      setPopoverSize({ width: rect.width, height: rect.height });
    };
    measure();
    if (typeof ResizeObserver === "function") {
      const observer = new ResizeObserver(() => measure());
      observer.observe(node);
      return () => observer.disconnect();
    }
    return undefined;
  }, [color, anchor]);

  if (!portalTarget || !anchor) {
    return null;
  }

  const viewportPadding = 12;
  const estimatedWidth = popoverSize?.width ?? 220;
  const estimatedHeight = popoverSize?.height ?? 340;
  const clampedLeft = clamp(
    anchor.left - estimatedWidth / 2,
    viewportPadding,
    Math.max(anchor.viewportWidth - viewportPadding - estimatedWidth, viewportPadding)
  );
  const spaceBelow = anchor.viewportHeight - anchor.top - anchor.height - viewportPadding;
  const spaceAbove = anchor.top - viewportPadding;
  let resolvedTop = anchor.top + anchor.height + 10;
  if (spaceBelow < estimatedHeight && spaceAbove > spaceBelow) {
    resolvedTop = anchor.top - estimatedHeight - 10;
  }
  resolvedTop = clamp(
    resolvedTop,
    viewportPadding,
    Math.max(anchor.viewportHeight - viewportPadding - estimatedHeight, viewportPadding)
  );

  const popoverStyle: CSSProperties = {
    ...swatchEditorPopoverStyle,
    position: "fixed",
    left: clampedLeft,
    top: resolvedTop
  };

  return createPortal(
    <div
      ref={containerRef}
      role="dialog"
      aria-label="Edit color"
      style={popoverStyle}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      data-formatting-color-swatch-editor="true"
    >
      <div style={swatchEditorHeaderStyle}>
        <span>Edit color</span>
        <span style={{ fontSize: "0.75rem", color: "#475569" }}>{previewColor}</span>
      </div>
      <div
        style={{
          ...swatchEditorCanvasStyle,
          backgroundColor: hueColor
        }}
        ref={canvasRef}
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handleCanvasPointerMove}
        onPointerUp={handleCanvasPointerUp}
        onPointerCancel={handleCanvasPointerUp}
      >
        <div style={swatchEditorCanvasOverlayStyle} aria-hidden />
        <div
          style={{
            ...swatchEditorCanvasThumbStyle,
            left: `${hsv.s * 100}%`,
            top: `${(1 - hsv.v) * 100}%`,
            backgroundColor: previewColor
          }}
          aria-hidden
        />
      </div>
      <div>
        <label
          htmlFor="swatch-editor-hue"
          style={{ display: "block", fontSize: "0.72rem", color: "#475569", marginBottom: "0.25rem" }}
        >
          Hue
        </label>
        <div style={swatchEditorHueTrackStyle} aria-hidden />
        <input
          id="swatch-editor-hue"
          type="range"
          min={0}
          max={360}
          value={hsv.h}
          onChange={handleHueChange}
          style={swatchEditorHueSliderStyle}
          aria-label="Hue"
        />
      </div>
      <div>
        <label
          htmlFor="swatch-editor-hex"
          style={{ display: "block", fontSize: "0.72rem", color: "#475569", marginBottom: "0.35rem" }}
        >
          Hex value
        </label>
        <input
          id="swatch-editor-hex"
          type="text"
          value={hexInput}
          onChange={handleHexChange}
          style={swatchEditorHexInputStyle}
          maxLength={7}
          spellCheck={false}
        />
      </div>
      <div style={{ ...swatchEditorPreviewStyle, backgroundColor: previewColor }} aria-hidden />
      <div style={swatchEditorFooterStyle}>
        <button
          type="button"
          style={swatchEditorButtonStyle}
          onClick={onCancel}
          aria-label="Cancel color change"
        >
          Cancel
        </button>
        <button
          type="button"
          style={{
            ...swatchEditorPrimaryButtonStyle,
            opacity: hexIsValid ? 1 : 0.7,
            cursor: hexIsValid ? "pointer" : "not-allowed"
          }}
          onClick={handleSelect}
          disabled={!hexIsValid}
          aria-label="Select color"
        >
          Select
        </button>
      </div>
    </div>,
    portalTarget as Element
  );
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

export const ColorPalettePopover = ({
  mode,
  palette,
  onApplyColor,
  onClearColor,
  onClose,
  onPersistPalette
}: ColorPalettePopoverProps): JSX.Element => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const swatchAnchorRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [draftSwatches, setDraftSwatches] = useState<ReadonlyArray<string>>(palette.swatches);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [pendingClose, setPendingClose] = useState(false);
  const [activeSwatchEditor, setActiveSwatchEditor] = useState<number | null>(null);
  const [swatchEditorColor, setSwatchEditorColor] = useState<string>("#000000");
  const [swatchEditorAnchor, setSwatchEditorAnchor] = useState<ColorSwatchEditorPopoverProps["anchor"]>(null);
  const [pendingNewSwatchIndex, setPendingNewSwatchIndex] = useState<number | null>(null);

  const computeSwatchAnchor = useCallback((index: number): ColorSwatchEditorPopoverProps["anchor"] => {
    if (typeof window === "undefined") {
      return null;
    }
    const node = swatchAnchorRefs.current[index];
    if (!node) {
      return null;
    }
    const rect = node.getBoundingClientRect();
    return {
      left: rect.left + rect.width / 2,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight
    };
  }, []);

  useEffect(() => {
    if (!isEditing) {
      setDraftSwatches(palette.swatches);
      setPendingNewSwatchIndex(null);
    }
  }, [palette.swatches, isEditing]);

  useEffect(() => {
    if (!isEditing) {
      setActiveSwatchEditor(null);
      setSwatchEditorAnchor(null);
      return;
    }
    if (activeSwatchEditor === null) {
      return;
    }
    const swatch = draftSwatches[activeSwatchEditor];
    if (!swatch) {
      setActiveSwatchEditor(null);
      return;
    }
    setSwatchEditorColor(normalizeHexColor(swatch));
  }, [isEditing, draftSwatches, activeSwatchEditor]);

  useEffect(() => {
    if (!isEditing) {
      return;
    }
    if (activeSwatchEditor === null) {
      setSwatchEditorAnchor(null);
      return;
    }
    const updateAnchor = () => {
      setSwatchEditorAnchor(computeSwatchAnchor(activeSwatchEditor));
    };
    updateAnchor();
    const win = typeof window !== "undefined" ? window : undefined;
    if (!win) {
      return;
    }
    win.addEventListener("resize", updateAnchor);
    win.addEventListener("scroll", updateAnchor, true);
    return () => {
      win.removeEventListener("resize", updateAnchor);
      win.removeEventListener("scroll", updateAnchor, true);
    };
  }, [isEditing, activeSwatchEditor, computeSwatchAnchor, draftSwatches.length]);

  const hasChanges = useMemo(
    () => !arraysEqual(draftSwatches, palette.swatches),
    [draftSwatches, palette.swatches]
  );

  swatchAnchorRefs.current.length = draftSwatches.length;

  const attemptClose = useCallback(() => {
    if (isEditing && hasChanges) {
      setConfirmingCancel(true);
      setPendingClose(true);
      return;
    }
    setIsEditing(false);
    setConfirmingCancel(false);
    setPendingClose(false);
    setActiveSwatchEditor(null);
    setPendingNewSwatchIndex(null);
    onClose();
  }, [hasChanges, isEditing, onClose]);

  useEffect(() => {
    const handlePointerDown = (event: globalThis.MouseEvent) => {
      const root = containerRef.current;
      const target = event.target;
      if (!root || !(target instanceof Node)) {
        return;
      }
      if (root.contains(target)) {
        return;
      }
      if (
        target instanceof Element &&
        target.closest('[data-formatting-color-swatch-editor="true"]')
      ) {
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

  const modeLabel = mode === "text" ? "Text color" : "Highlight color";

  const handleSwatchSelection = (swatch: string) => {
    onApplyColor(swatch);
    onClose();
  };

  const handleAddColorClick = () => {
    const nextIndex = draftSwatches.length;
    const initialColor = composePaletteColor(swatchEditorColor, undefined);
    setDraftSwatches((current) => [...current, initialColor]);
    setPendingNewSwatchIndex(nextIndex);
    openSwatchEditor(nextIndex, initialColor);
  };

  const openSwatchEditor = useCallback(
    (index: number, color: string) => {
      setActiveSwatchEditor(index);
      setSwatchEditorColor(normalizeHexColor(color));
      if (typeof window !== "undefined") {
        window.requestAnimationFrame(() => {
          setSwatchEditorAnchor(computeSwatchAnchor(index));
        });
      }
    },
    [computeSwatchAnchor]
  );

  const handleEditSwatch = (index: number) => {
    const swatch = draftSwatches[index] ?? palette.swatches[index] ?? "#000000";
    openSwatchEditor(index, swatch);
  };

  const handleChangeSwatch = (index: number, hex: string) => {
    const paletteColor = composePaletteColor(hex, draftSwatches[index]);
    setDraftSwatches((current) => {
      const next = [...current];
      next[index] = paletteColor;
      return next;
    });
    if (activeSwatchEditor === index) {
      openSwatchEditor(index, paletteColor);
    }
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
    setPendingNewSwatchIndex((current) => {
      if (current === null) {
        return current;
      }
      if (current === index) {
        return null;
      }
      if (current > index) {
        return current - 1;
      }
      return current;
    });
    setActiveSwatchEditor((current) => {
      if (current === null) {
        return current;
      }
      if (index === current) {
        return null;
      }
      if (index < current) {
        return current - 1;
      }
      return current;
    });
  };

  const handleStartEditing = () => {
    setDraftSwatches(palette.swatches);
    setIsEditing(true);
    setConfirmingCancel(false);
    setPendingClose(false);
    setActiveSwatchEditor(null);
    setPendingNewSwatchIndex(null);
  };

  const handleSavePalette = () => {
    onPersistPalette(draftSwatches);
    setIsEditing(false);
    setConfirmingCancel(false);
    setPendingClose(false);
    setActiveSwatchEditor(null);
    setPendingNewSwatchIndex(null);
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
    setActiveSwatchEditor(null);
    setPendingNewSwatchIndex(null);
  }
};

const confirmDiscardChanges = () => {
  setIsEditing(false);
  setConfirmingCancel(false);
  const shouldClose = pendingClose;
  setPendingClose(false);
  setDraftSwatches(palette.swatches);
  setActiveSwatchEditor(null);
  setPendingNewSwatchIndex(null);
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
                ref={(node) => {
                  swatchAnchorRefs.current[index] = node;
                }}
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
                  <span aria-hidden style={swatchRemoveIconStyle}>
                    <IconX size={10} stroke="#1f2937" />
                  </span>
                </button>
                {activeSwatchEditor === index ? (
                  <ColorSwatchEditorPopover
                    color={swatchEditorColor}
                    anchor={swatchEditorAnchor}
                    onCancel={() => {
                      if (pendingNewSwatchIndex === index) {
                        setDraftSwatches((current) => {
                          if (current.length === 0) {
                            return current;
                          }
                          const next = [...current];
                          next.splice(index, 1);
                          return next;
                        });
                        setPendingNewSwatchIndex(null);
                      }
                      setActiveSwatchEditor(null);
                      setSwatchEditorAnchor(null);
                    }}
                    onSelect={(nextHex) => {
                      handleChangeSwatch(index, nextHex);
                      if (pendingNewSwatchIndex === index) {
                        setPendingNewSwatchIndex(null);
                      }
                      setActiveSwatchEditor(null);
                      setSwatchEditorAnchor(null);
                    }}
                  />
                ) : null}
              </div>
            );
          }
          return (
            <div
              key={`${swatch}-${index}-view`}
              style={swatchCellStyle}
              ref={(node) => {
                swatchAnchorRefs.current[index] = node;
              }}
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
            style={secondaryButtonStyle}
            onClick={handleAddColorClick}
            title="Add color"
            aria-label="Add color"
          >
            Add
          </button>
          <button
            type="button"
            style={{
              ...primaryButtonStyle,
              opacity: hasChanges ? 1 : 0.6,
              cursor: hasChanges ? "pointer" : "not-allowed"
            }}
            onClick={handleSavePalette}
            disabled={!hasChanges}
            title="Save palette"
            aria-label="Save palette"
          >
            Save
          </button>
          <button
            type="button"
            style={secondaryButtonStyle}
            onClick={handleCancelEditing}
            title="Cancel editing"
            aria-label="Cancel editing"
          >
            Cancel
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
