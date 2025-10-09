import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent
} from "react";

import type {
  CollaborativeEditor,
  HeadingLevel
} from "@thortiq/editor-prosemirror";

import { FloatingSelectionMenu } from "./FloatingSelectionMenu";

export interface SelectionFormattingMenuProps {
  readonly editor: CollaborativeEditor | null;
  readonly portalContainer?: HTMLElement | null;
  readonly offset?: {
    readonly x?: number;
    readonly y?: number;
  };
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

const toolbarStyle: CSSProperties = {
  display: "inline-flex",
  gap: "0.25rem",
  alignItems: "center",
  backgroundColor: "rgba(17, 24, 39, 0.95)", // Gray-900 @ ~95% — readable overlay.
  color: "#f9fafb",
  borderRadius: "9999px",
  padding: "0.25rem 0.5rem",
  boxShadow: "0 10px 30px rgba(15, 23, 42, 0.25)"
};

const baseButtonStyle: CSSProperties = {
  background: "transparent",
  border: "none",
  color: "inherit",
  padding: "0.25rem 0.5rem",
  borderRadius: "0.375rem",
  fontSize: "0.75rem",
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

const buttonShortcutStyle: CSSProperties = {
  display: "block",
  fontSize: "0.6rem",
  fontWeight: 400,
  opacity: 0.75,
  marginTop: "0.15rem"
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
  offset
}: SelectionFormattingMenuProps): JSX.Element | null => {
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!editor) {
      buttonRefs.current = [];
      setFocusedIndex(null);
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

  const renderToolbar = useCallback(
    (activeEditor: CollaborativeEditor) => {
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

      return (
        <div role="toolbar" aria-label="Text formatting" style={toolbarStyle}>
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
                ...(focusedIndex === index ? hoverButtonStyle : undefined)
              }}
              data-formatting-action={action.id}
              aria-label={action.ariaLabel}
              aria-pressed={action.isToggle ? action.isActive : undefined}
              aria-keyshortcuts={action.ariaKeyShortcut}
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
              {action.shortcutHint ? (
                <span style={buttonShortcutStyle}>{action.shortcutHint}</span>
              ) : null}
            </button>
          ))}
        </div>
      );
    },
    [focusedIndex, handleKeyDown]
  );

  if (!editor) {
    return null;
  }

  const menuOffset = offset ? { x: offset.x, y: offset.y } : undefined;

  return (
    <FloatingSelectionMenu
      editor={editor}
      portalContainer={portalContainer ?? undefined}
      offset={menuOffset}
    >
      {({ editor: activeEditor }) => renderToolbar(activeEditor)}
    </FloatingSelectionMenu>
  );
};
