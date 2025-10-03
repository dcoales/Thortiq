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
}

export interface OutlineKeymapOptions {
  readonly handlers: OutlineKeymapHandlers;
}

export const createOutlineKeymap = ({ handlers }: OutlineKeymapOptions): Plugin => {
  const wrap = (handler?: OutlineKeymapHandler): Command => {
    if (!handler) {
      return () => false;
    }
    return (state, dispatch, view) => handler({ state, dispatch, view });
  };

  const bindings: Record<string, Command> = {
    Tab: wrap(handlers.indent),
    "Shift-Tab": wrap(handlers.outdent),
    Enter: wrap(handlers.insertSibling),
    "Shift-Enter": wrap(handlers.insertChild),
    Backspace: wrap(handlers.mergeWithPrevious),
    "Ctrl-Enter": wrap(handlers.toggleDone),
    "Mod-Shift-Backspace": wrap(handlers.deleteSelection),
    "Ctrl-Shift-Backspace": wrap(handlers.deleteSelection)
  };

  return keymap(bindings);
};
