import type { HeadingLevel } from "@thortiq/editor-prosemirror";

export type FormattingActionId =
  | "heading-1"
  | "heading-2"
  | "heading-3"
  | "heading-4"
  | "heading-5"
  | "bold"
  | "italic"
  | "underline"
  | "strikethrough"
  | "textColor"
  | "backgroundColor"
  | "clear";

export type FormattingActionContext = "inline" | "outline";

export type FormattingActionType = "heading" | "inlineMark" | "clear" | "color";

export interface FormattingActionDefinition {
  readonly id: FormattingActionId;
  readonly toolbarLabel: string;
  readonly menuLabel: string;
  readonly ariaLabel: string;
  readonly ariaKeyShortcut?: string;
  readonly shortcutHint?: string;
  readonly type: FormattingActionType;
  readonly headingLevel?: HeadingLevel;
  readonly inlineMark?: "bold" | "italic" | "underline" | "strikethrough";
  readonly colorMode?: "text" | "background";
  readonly contexts: readonly FormattingActionContext[];
}

const FORMATTING_DEFINITIONS: readonly FormattingActionDefinition[] = [
  {
    id: "heading-1",
    toolbarLabel: "H1",
    menuLabel: "Heading 1",
    ariaLabel: "Heading 1",
    ariaKeyShortcut: "Control+Alt+1",
    shortcutHint: "Ctrl+Alt+1",
    type: "heading",
    headingLevel: 1,
    contexts: ["inline", "outline"]
  },
  {
    id: "heading-2",
    toolbarLabel: "H2",
    menuLabel: "Heading 2",
    ariaLabel: "Heading 2",
    ariaKeyShortcut: "Control+Alt+2",
    shortcutHint: "Ctrl+Alt+2",
    type: "heading",
    headingLevel: 2,
    contexts: ["inline", "outline"]
  },
  {
    id: "heading-3",
    toolbarLabel: "H3",
    menuLabel: "Heading 3",
    ariaLabel: "Heading 3",
    ariaKeyShortcut: "Control+Alt+3",
    shortcutHint: "Ctrl+Alt+3",
    type: "heading",
    headingLevel: 3,
    contexts: ["inline", "outline"]
  },
  {
    id: "heading-4",
    toolbarLabel: "H4",
    menuLabel: "Heading 4",
    ariaLabel: "Heading 4",
    ariaKeyShortcut: "Control+Alt+4",
    shortcutHint: "Ctrl+Alt+4",
    type: "heading",
    headingLevel: 4,
    contexts: ["inline", "outline"]
  },
  {
    id: "heading-5",
    toolbarLabel: "H5",
    menuLabel: "Heading 5",
    ariaLabel: "Heading 5",
    ariaKeyShortcut: "Control+Alt+5",
    shortcutHint: "Ctrl+Alt+5",
    type: "heading",
    headingLevel: 5,
    contexts: ["inline", "outline"]
  },
  {
    id: "bold",
    toolbarLabel: "B",
    menuLabel: "Bold",
    ariaLabel: "Bold",
    ariaKeyShortcut: "Control+B",
    shortcutHint: "Ctrl+B",
    type: "inlineMark",
    inlineMark: "bold",
    contexts: ["inline", "outline"]
  },
  {
    id: "italic",
    toolbarLabel: "I",
    menuLabel: "Italic",
    ariaLabel: "Italic",
    ariaKeyShortcut: "Control+I",
    shortcutHint: "Ctrl+I",
    type: "inlineMark",
    inlineMark: "italic",
    contexts: ["inline", "outline"]
  },
  {
    id: "underline",
    toolbarLabel: "U",
    menuLabel: "Underline",
    ariaLabel: "Underline",
    ariaKeyShortcut: "Control+U",
    shortcutHint: "Ctrl+U",
    type: "inlineMark",
    inlineMark: "underline",
    contexts: ["inline", "outline"]
  },
  {
    id: "strikethrough",
    toolbarLabel: "S",
    menuLabel: "Strikethrough",
    ariaLabel: "Strikethrough",
    ariaKeyShortcut: "Control+Shift+X",
    shortcutHint: "Ctrl+Shift+X",
    type: "inlineMark",
    inlineMark: "strikethrough",
    contexts: ["inline", "outline"]
  },
  {
    id: "textColor",
    toolbarLabel: "Text",
    menuLabel: "Text color",
    ariaLabel: "Text color",
    type: "color",
    colorMode: "text",
    contexts: ["outline"]
  },
  {
    id: "backgroundColor",
    toolbarLabel: "Highlight",
    menuLabel: "Highlight color",
    ariaLabel: "Highlight color",
    type: "color",
    colorMode: "background",
    contexts: ["outline"]
  },
  {
    id: "clear",
    toolbarLabel: "Clr",
    menuLabel: "Clear formatting",
    ariaLabel: "Clear formatting",
    type: "clear",
    contexts: ["inline", "outline"]
  }
] as const;

export const getFormattingActionDefinitions = (): readonly FormattingActionDefinition[] => {
  return FORMATTING_DEFINITIONS;
};
