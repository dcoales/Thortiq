/**
 * Wiki link plugin monitors inline trigger sequences ("[[") inside ProseMirror and surfaces a
 * shared callback interface so platform adapters can open selection dialogs without duplicating
 * editor semantics. It also guards keyboard input while the dialog is open to keep text state
 * consistent with AGENTS.md rules.
 */
import { Plugin, PluginKey } from "prosemirror-state";
import type { EditorState, Transaction } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";

type WikiLinkPluginMeta = { readonly action: "cancel" | "commit" };

interface WikiLinkInternalState {
  readonly active: boolean;
  readonly triggerPos: number;
  readonly headPos: number;
  readonly query: string;
}

const INACTIVE_STATE: WikiLinkInternalState = {
  active: false,
  triggerPos: -1,
  headPos: -1,
  query: ""
};

export interface WikiLinkTrigger {
  readonly from: number;
  readonly to: number;
  readonly query: string;
}

export interface WikiLinkTriggerEvent {
  readonly view: EditorView;
  readonly trigger: WikiLinkTrigger;
}

export interface WikiLinkActivateEvent {
  readonly view: EditorView;
  readonly nodeId: string;
  readonly displayText: string;
  readonly target: HTMLElement;
}

export interface EditorWikiLinkOptions {
  readonly onStateChange?: (event: WikiLinkTriggerEvent | null) => void;
  readonly onKeyDown?: (event: KeyboardEvent, context: WikiLinkTriggerEvent) => boolean;
  readonly onActivate?: (event: WikiLinkActivateEvent) => void;
}

export interface WikiLinkOptionsRef {
  current: EditorWikiLinkOptions | null;
}

export const wikiLinkPluginKey = new PluginKey<WikiLinkInternalState>("thortiq-wikilink");

const mapPosition = (transaction: Transaction, position: number): number => {
  return transaction.mapping.map(position, 0);
};

const statesEqual = (left: WikiLinkInternalState, right: WikiLinkInternalState): boolean => {
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

const toTrigger = (state: WikiLinkInternalState): WikiLinkTrigger => {
  return {
    from: state.triggerPos,
    to: state.headPos,
    query: state.query
  } satisfies WikiLinkTrigger;
};

export const createWikiLinkPlugin = (optionsRef: WikiLinkOptionsRef): Plugin => {
  return new Plugin<WikiLinkInternalState>({
    key: wikiLinkPluginKey,
    state: {
      init: () => INACTIVE_STATE,
      apply: (transaction, pluginState, _oldState, newState) => {
        const meta = transaction.getMeta(wikiLinkPluginKey) as WikiLinkPluginMeta | undefined;
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
          if (head < mappedTriggerPos + 2) {
            return INACTIVE_STATE;
          }

          const opener = newState.doc.textBetween(mappedTriggerPos, mappedTriggerPos + 2, "\n", "\n");
          if (opener !== "[[") {
            return INACTIVE_STATE;
          }

          const query = newState.doc.textBetween(mappedTriggerPos + 2, head, "\n", "\n");
          return {
            active: true,
            triggerPos: mappedTriggerPos,
            headPos: head,
            query
          } satisfies WikiLinkInternalState;
        }

        const selection = newState.selection;
        if (!selection.empty) {
          return INACTIVE_STATE;
        }

        if (!transaction.docChanged) {
          return INACTIVE_STATE;
        }

        const head = selection.from;
        if (head < 2) {
          return INACTIVE_STATE;
        }

        const opener = newState.doc.textBetween(head - 2, head, "\n", "\n");
        if (opener === "[[") {
          return {
            active: true,
            triggerPos: head - 2,
            headPos: head,
            query: ""
          } satisfies WikiLinkInternalState;
        }

        return INACTIVE_STATE;
      }
    },
    props: {
      handleKeyDown: (view, event) => {
        const pluginState = wikiLinkPluginKey.getState(view.state) ?? INACTIVE_STATE;
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
      },
      handleDOMEvents: {
        click: (view, event) => {
          const target = event.target as HTMLElement | null;
          const wikiTarget = target?.closest('[data-outline-wikilink="true"]') as HTMLElement | null;
          if (!wikiTarget) {
            console.log("[wikilink] editor click", {
              tag: target?.tagName,
              dataset: target?.dataset,
              defaultPrevented: event.defaultPrevented
            });
            return false;
          }
          const nodeId = wikiTarget.dataset.nodeId;
          if (!nodeId) {
            return false;
          }
          const displayText = wikiTarget.dataset.wikilinkText ?? wikiTarget.textContent ?? "";
          console.log("[wikilink] editor click", {
            tag: wikiTarget.tagName,
            dataset: wikiTarget.dataset,
            defaultPrevented: event.defaultPrevented
          });
          event.preventDefault();
          event.stopPropagation();
          const callbacks = optionsRef.current;
          callbacks?.onActivate?.({
            view,
            nodeId,
            displayText,
            target: wikiTarget
          });
          return true;
        }
      }
    },
    view: () => {
      return {
        update: (updatedView, previousState) => {
          const previous = wikiLinkPluginKey.getState(previousState) ?? INACTIVE_STATE;
          const next = wikiLinkPluginKey.getState(updatedView.state) ?? INACTIVE_STATE;
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

export const getWikiLinkTrigger = (state: EditorState): WikiLinkTrigger | null => {
  const pluginState = wikiLinkPluginKey.getState(state);
  if (!pluginState || !pluginState.active) {
    return null;
  }
  return toTrigger(pluginState);
};

export const markWikiLinkTransaction = (
  transaction: Transaction,
  action: WikiLinkPluginMeta["action"]
): Transaction => {
  transaction.setMeta(wikiLinkPluginKey, { action } satisfies WikiLinkPluginMeta);
  return transaction;
};
