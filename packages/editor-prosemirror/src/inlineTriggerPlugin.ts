/**
 * Generic inline trigger plugin that watches for a configurable string (e.g. "[[" or "((")
 * and notifies adapters when the user is typing a query. Platform layers can reuse this
 * behaviour for wiki links, mirrors, or other inline dialogs without duplicating keyboard
 * handling logic.
 */
import { Plugin, PluginKey } from "prosemirror-state";
import type { EditorState, Transaction } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";

type InlineTriggerPluginMeta = { readonly action: "cancel" | "commit" };

interface InlineTriggerInternalState {
  readonly active: boolean;
  readonly triggerPos: number;
  readonly headPos: number;
  readonly query: string;
}

const INACTIVE_STATE: InlineTriggerInternalState = {
  active: false,
  triggerPos: -1,
  headPos: -1,
  query: ""
};

export type InlineTriggerPluginState = InlineTriggerInternalState;

export interface InlineTrigger {
  readonly from: number;
  readonly to: number;
  readonly query: string;
}

export interface InlineTriggerEvent {
  readonly view: EditorView;
  readonly trigger: InlineTrigger;
}

export interface EditorInlineTriggerOptions {
  readonly onStateChange?: (event: InlineTriggerEvent | null) => void;
  readonly onKeyDown?: (event: KeyboardEvent, context: InlineTriggerEvent) => boolean;
}

export interface InlineTriggerOptionsRef {
  current: EditorInlineTriggerOptions | null;
}

export interface InlineTriggerPluginConfig {
  readonly trigger: string;
  readonly pluginKey: PluginKey<InlineTriggerInternalState>;
  readonly optionsRef: InlineTriggerOptionsRef;
}

const mapPosition = (transaction: Transaction, position: number): number => {
  return transaction.mapping.map(position, 0);
};

const statesEqual = (left: InlineTriggerInternalState, right: InlineTriggerInternalState): boolean => {
  if (left === right) {
    return true;
  }
  return (
    left.active === right.active
    && left.triggerPos === right.triggerPos
    && left.headPos === right.headPos
    && left.query === right.query
  );
};

const toTrigger = (state: InlineTriggerInternalState): InlineTrigger => {
  return {
    from: state.triggerPos,
    to: state.headPos,
    query: state.query
  };
};

export const createInlineTriggerPlugin = ({
  trigger,
  pluginKey,
  optionsRef
}: InlineTriggerPluginConfig): Plugin => {
  if (trigger.length === 0) {
    throw new Error("Inline trigger string must be at least one character long");
  }
  const triggerLength = trigger.length;

  return new Plugin<InlineTriggerInternalState>({
    key: pluginKey,
    state: {
      init: () => INACTIVE_STATE,
      apply: (transaction, pluginState, _oldState, newState) => {
        const meta = transaction.getMeta(pluginKey) as InlineTriggerPluginMeta | undefined;
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
          if (head < mappedTriggerPos + triggerLength) {
            return INACTIVE_STATE;
          }

          const opener = newState.doc.textBetween(mappedTriggerPos, mappedTriggerPos + triggerLength, "\n", "\n");
          if (opener !== trigger) {
            return INACTIVE_STATE;
          }

          const query = newState.doc.textBetween(mappedTriggerPos + triggerLength, head, "\n", "\n");
          return {
            active: true,
            triggerPos: mappedTriggerPos,
            headPos: head,
            query
          };
        }

        const selection = newState.selection;
        if (!selection.empty) {
          return INACTIVE_STATE;
        }

        if (!transaction.docChanged) {
          return INACTIVE_STATE;
        }

        const head = selection.from;
        if (head < triggerLength) {
          return INACTIVE_STATE;
        }

        const opener = newState.doc.textBetween(head - triggerLength, head, "\n", "\n");
        if (opener === trigger) {
          return {
            active: true,
            triggerPos: head - triggerLength,
            headPos: head,
            query: ""
          };
        }

        return INACTIVE_STATE;
      }
    },
    props: {
      handleKeyDown: (view, event) => {
        const pluginState = pluginKey.getState(view.state) ?? INACTIVE_STATE;
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
          default:
            return false;
        }
      }
    },
    view: () => {
      return {
        update: (updatedView, previousState) => {
          const previous = pluginKey.getState(previousState) ?? INACTIVE_STATE;
          const next = pluginKey.getState(updatedView.state) ?? INACTIVE_STATE;
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

export const getInlineTrigger = (
  state: EditorState,
  pluginKey: PluginKey<InlineTriggerInternalState>
): InlineTrigger | null => {
  const pluginState = pluginKey.getState(state);
  if (!pluginState || !pluginState.active) {
    return null;
  }
  return toTrigger(pluginState);
};

export const markInlineTriggerTransaction = (
  transaction: Transaction,
  pluginKey: PluginKey<InlineTriggerInternalState>,
  action: InlineTriggerPluginMeta["action"]
): Transaction => {
  transaction.setMeta(pluginKey, { action } satisfies InlineTriggerPluginMeta);
  return transaction;
};
