/**
 * Tag plugin monitors inline trigger sequences ("#" or "@") inside ProseMirror and surfaces a
 * shared callback interface so platform adapters can open selection dialogs without duplicating
 * editor semantics. It also guards keyboard input while the dialog is open to keep text state
 * consistent with AGENTS.md rules.
 */
import { Plugin, PluginKey } from "prosemirror-state";
import type { EditorState, Transaction } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";

type TagPluginMeta = { readonly action: "cancel" | "commit" };

interface TagInternalState {
  readonly active: boolean;
  readonly triggerPos: number;
  readonly headPos: number;
  readonly query: string;
  readonly triggerChar: "#" | "@";
}

const INACTIVE_STATE: TagInternalState = {
  active: false,
  triggerPos: -1,
  headPos: -1,
  query: "",
  triggerChar: "#"
};

export interface TagTrigger {
  readonly from: number;
  readonly to: number;
  readonly query: string;
  readonly triggerChar: "#" | "@";
}

export interface TagTriggerEvent {
  readonly view: EditorView;
  readonly trigger: TagTrigger;
}

export interface TagClickEvent {
  readonly view: EditorView;
  readonly tagName: string;
  readonly event: MouseEvent;
}

export interface EditorTagOptions {
  readonly onStateChange?: (event: TagTriggerEvent | null) => void;
  readonly onKeyDown?: (event: KeyboardEvent, context: TagTriggerEvent) => boolean;
  readonly onClick?: (event: TagClickEvent) => void;
}

export interface TagOptionsRef {
  current: EditorTagOptions | null;
}

export const tagPluginKey = new PluginKey<TagInternalState>("thortiq-tag");

const mapPosition = (transaction: Transaction, position: number): number => {
  return transaction.mapping.map(position, 0);
};

const statesEqual = (left: TagInternalState, right: TagInternalState): boolean => {
  if (left === right) {
    return true;
  }
  return (
    left.active === right.active
    && left.triggerPos === right.triggerPos
    && left.headPos === right.headPos
    && left.query === right.query
    && left.triggerChar === right.triggerChar
  );
};

const toTrigger = (state: TagInternalState): TagTrigger => {
  return {
    from: state.triggerPos,
    to: state.headPos,
    query: state.query,
    triggerChar: state.triggerChar
  } satisfies TagTrigger;
};

const isTriggerChar = (char: string): char is "#" | "@" => {
  return char === "#" || char === "@";
};

export const createTagPlugin = (optionsRef: TagOptionsRef): Plugin => {
  return new Plugin<TagInternalState>({
    key: tagPluginKey,
    state: {
      init: () => INACTIVE_STATE,
      apply: (transaction, pluginState, _oldState, newState) => {
        const meta = transaction.getMeta(tagPluginKey) as TagPluginMeta | undefined;
        if (meta?.action === "cancel" || meta?.action === "commit") {
          return INACTIVE_STATE;
        }

        if (pluginState.active) {
          const mappedTriggerPos = mapPosition(transaction, pluginState.triggerPos);
          const selection = newState.selection;
          if (!selection.empty) {
            return INACTIVE_STATE;
          }

          const head = selection.from;
          if (head < mappedTriggerPos + 1) {
            return INACTIVE_STATE;
          }

          const triggerChar = newState.doc.textBetween(mappedTriggerPos, mappedTriggerPos + 1, "\n", "\n");
          if (!isTriggerChar(triggerChar)) {
            return INACTIVE_STATE;
          }

          const query = newState.doc.textBetween(mappedTriggerPos + 1, head, "\n", "\n");
          
          // Deactivate if query contains spaces (tags should be single words)
          if (query.includes(" ") || query.includes("\n")) {
            return INACTIVE_STATE;
          }

          return {
            active: true,
            triggerPos: mappedTriggerPos,
            headPos: head,
            query,
            triggerChar
          } satisfies TagInternalState;
        }

        const selection = newState.selection;
        if (!selection.empty) {
          return INACTIVE_STATE;
        }

        if (!transaction.docChanged) {
          return INACTIVE_STATE;
        }

        const head = selection.from;
        if (head < 1) {
          return INACTIVE_STATE;
        }

        const triggerChar = newState.doc.textBetween(head - 1, head, "\n", "\n");
        if (isTriggerChar(triggerChar)) {
          // Check if there's a space or start of line/paragraph before the trigger
          let isValidPosition = false;
          
          if (head === 1) {
            // At the very start of the document
            isValidPosition = true;
          } else if (head > 1) {
            const beforeTrigger = newState.doc.textBetween(head - 2, head - 1, "\n", "\n");
            if (beforeTrigger === " " || beforeTrigger === "\n") {
              isValidPosition = true;
            } else {
              // Check if we're at the start of a paragraph/text node
              const $pos = newState.doc.resolve(head - 1);
              if ($pos.parentOffset === 0) {
                // We're at the start of the parent text node
                isValidPosition = true;
              }
            }
          }
          
          if (isValidPosition) {
            return {
              active: true,
              triggerPos: head - 1,
              headPos: head,
              query: "",
              triggerChar
            } satisfies TagInternalState;
          }
        }

        return INACTIVE_STATE;
      }
    },
    props: {
      handleKeyDown: (view, event) => {
        const pluginState = tagPluginKey.getState(view.state) ?? INACTIVE_STATE;
        if (!pluginState.active) {
          return false;
        }

        const callbacks = optionsRef.current;
        if (callbacks?.onKeyDown) {
          const handled = callbacks.onKeyDown(event, { view, trigger: toTrigger(pluginState) });
          if (handled) {
            return true;
          }
        }

        switch (event.key) {
          case "Enter":
          case "Escape":
          case "ArrowUp":
          case "ArrowDown":
            event.preventDefault();
            return true;
          case " ": {
            // Space should close the tag dialog
            event.preventDefault();
            const tr = view.state.tr;
            markTagTransaction(tr, "cancel");
            view.dispatch(tr);
            return true;
          }
          default:
            return false;
        }
      },
      handleDOMEvents: {
        click: (view, event) => {
          const callbacks = optionsRef.current;
          if (!callbacks?.onClick) {
            return false;
          }
          const target = event.target;
          if (!(target instanceof Element)) {
            return false;
          }
          const tagSpan = target.closest<HTMLElement>("[data-tag=\"true\"][data-tag-name]");
          const tagName = tagSpan?.getAttribute("data-tag-name");
          if (!tagSpan || !tagName) {
            return false;
          }
          event.preventDefault();
          event.stopPropagation();
          callbacks.onClick({ view, tagName, event });
          return true;
        }
      }
    },
    view: () => {
      return {
        update: (updatedView, previousState) => {
          const previous = tagPluginKey.getState(previousState) ?? INACTIVE_STATE;
          const next = tagPluginKey.getState(updatedView.state) ?? INACTIVE_STATE;
          if (statesEqual(previous, next)) {
            return;
          }
          const callback = optionsRef.current?.onStateChange;
          if (!callback) {
            return;
          }
          if (!next.active) {
            callback(null);
            return;
          }
          callback({
            view: updatedView,
            trigger: toTrigger(next)
          });
        }
      };
    }
  });
};

export const getTagTrigger = (state: EditorState): TagTrigger | null => {
  const pluginState = tagPluginKey.getState(state);
  if (!pluginState || !pluginState.active) {
    return null;
  }
  return toTrigger(pluginState);
};

export const markTagTransaction = (
  transaction: Transaction,
  action: TagPluginMeta["action"]
): Transaction => {
  transaction.setMeta(tagPluginKey, { action } satisfies TagPluginMeta);
  return transaction;
};

