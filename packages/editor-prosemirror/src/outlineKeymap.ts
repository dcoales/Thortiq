import { keymap } from "prosemirror-keymap";
import type { Command, Plugin } from "prosemirror-state";
import type { EditorState, Transaction } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";

/**
 * Create a keymap plugin that routes editor keyboard shortcuts to outline-aware commands.
 * The plugin leaves actual outline mutation logic to injected handlers so shared shells can
 * reuse the wiring without pulling React or platform-specific code into ProseMirror plugins.
 */
export interface OutlineKeymapHandlerArgs {
  readonly state: EditorState;
  readonly dispatch: ((tr: Transaction) => void) | undefined;
  readonly view: EditorView | undefined;
}

export type OutlineKeymapHandler = (args: OutlineKeymapHandlerArgs) => boolean;

export interface OutlineKeymapHandlers {
  readonly indent?: OutlineKeymapHandler;
  readonly outdent?: OutlineKeymapHandler;
  readonly insertSibling?: OutlineKeymapHandler;
  readonly insertChild?: OutlineKeymapHandler;
  readonly mergeWithPrevious?: OutlineKeymapHandler;
  readonly deleteSelection?: OutlineKeymapHandler;
  readonly toggleDone?: OutlineKeymapHandler;
  readonly arrowDown?: OutlineKeymapHandler;
  readonly arrowUp?: OutlineKeymapHandler;
}

export interface OutlineKeymapOptions {
  readonly handlers: OutlineKeymapHandlers;
}

export interface OutlineKeymapOptionsRef {
  current: OutlineKeymapOptions | null;
}

const createCommand = (
  ref: OutlineKeymapOptionsRef,
  key: keyof OutlineKeymapHandlers
): Command => {
  return (state, dispatch, view) => {
    const handlers = ref.current?.handlers;
    if (!handlers) {
      return false;
    }
    const handler = handlers[key];
    if (!handler) {
      return false;
    }
    return handler({ state, dispatch, view });
  };
};

export const createOutlineKeymap = (optionsRef: OutlineKeymapOptionsRef): Plugin => {
  const bindings: Record<string, Command> = {
    Tab: createCommand(optionsRef, "indent"),
    "Shift-Tab": createCommand(optionsRef, "outdent"),
    Enter: createCommand(optionsRef, "insertSibling"),
    "Shift-Enter": createCommand(optionsRef, "insertChild"),
    Backspace: createCommand(optionsRef, "mergeWithPrevious"),
    "Ctrl-Enter": createCommand(optionsRef, "toggleDone"),
    "Mod-Shift-Backspace": createCommand(optionsRef, "deleteSelection"),
    "Ctrl-Shift-Backspace": createCommand(optionsRef, "deleteSelection"),
    ArrowDown: createCommand(optionsRef, "arrowDown"),
    ArrowUp: createCommand(optionsRef, "arrowUp")
  };

  return keymap(bindings);
};
