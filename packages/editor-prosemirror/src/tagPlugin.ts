/**
 * Tag trigger plugin wraps the generic inline trigger helper so both "#" and "@"
 * characters share an options surface. Consumers receive unified callbacks with
 * the trigger character attached, enabling a single suggestion controller to
 * handle tag and mention flows without duplicating keyboard logic.
 */
import { Plugin, PluginKey, TextSelection } from "prosemirror-state";
import type { EditorState, Transaction } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";

import {
  createInlineTriggerPlugin,
  getInlineTrigger,
  markInlineTriggerTransaction,
  type EditorInlineTriggerOptions,
  type InlineTrigger,
  type InlineTriggerEvent,
  type InlineTriggerOptionsRef,
  type InlineTriggerPluginState
} from "./inlineTriggerPlugin";

type ReplaceWithContent = Parameters<Transaction["replaceWith"]>[2];

export type TagTriggerCharacter = "#" | "@";

export interface TagTrigger extends InlineTrigger {
  readonly triggerChar: TagTriggerCharacter;
}

export interface TagTriggerEvent {
  readonly view: EditorView;
  readonly trigger: TagTrigger;
}

export interface EditorTagClickEvent {
  readonly view: EditorView;
  readonly event: MouseEvent;
  readonly trigger: TagTriggerCharacter;
  readonly label: string;
  readonly id: string | null;
}

export interface EditorTagOptions {
  readonly onStateChange?: (event: TagTriggerEvent | null) => void;
  readonly onKeyDown?: (event: KeyboardEvent, context: TagTriggerEvent) => boolean;
  readonly onTagClick?: (event: EditorTagClickEvent) => void;
}

export interface TagOptionsRef {
  current: EditorTagOptions | null;
}

export interface TagPluginHandle {
  readonly plugins: readonly Plugin[];
  refresh(): void;
}

interface TriggerBridge {
  readonly character: TagTriggerCharacter;
  readonly pluginKey: PluginKey<InlineTriggerPluginState>;
  readonly optionsRef: InlineTriggerOptionsRef;
  refresh(): void;
}

const createEventAdapter =
  (character: TagTriggerCharacter) =>
  (event: InlineTriggerEvent | null): TagTriggerEvent | null => {
    if (!event) {
      return null;
    }
    const trigger: TagTrigger = {
      ...event.trigger,
      triggerChar: character
    };
    return { view: event.view, trigger };
  };

const createBridge = (
  character: TagTriggerCharacter,
  pluginKey: PluginKey<InlineTriggerPluginState>,
  source: TagOptionsRef
): TriggerBridge => {
  const optionsRef: InlineTriggerOptionsRef = { current: null };

  const refresh = () => {
    const baseOptions = source.current;
    if (!baseOptions) {
      optionsRef.current = null;
      return;
    }
    const mapEvent = createEventAdapter(character);
    const stateChange = baseOptions.onStateChange;
    const keyDown = baseOptions.onKeyDown;
    const inlineOptions: EditorInlineTriggerOptions = {
      onStateChange: stateChange
        ? (payload) => stateChange(mapEvent(payload))
        : undefined,
      onKeyDown: keyDown
        ? (event, context) => {
            const mapped = mapEvent(context);
            if (!mapped) {
              return false;
            }
            return keyDown(event, mapped);
          }
        : undefined
    };
    optionsRef.current = inlineOptions;
  };

  refresh();

  return {
    character,
    pluginKey,
    optionsRef,
    refresh
  };
};

const HASH_PLUGIN_KEY = new PluginKey<InlineTriggerPluginState>("thortiq-tag-hash");
const MENTION_PLUGIN_KEY = new PluginKey<InlineTriggerPluginState>("thortiq-tag-mention");
const BACKSPACE_PLUGIN_KEY = new PluginKey("thortiq-tag-backspace");
const CLICK_PLUGIN_KEY = new PluginKey("thortiq-tag-click");

export const createTagPlugin = (tagOptionsRef: TagOptionsRef): TagPluginHandle => {
  const bridges: TriggerBridge[] = [
    createBridge("#", HASH_PLUGIN_KEY, tagOptionsRef),
    createBridge("@", MENTION_PLUGIN_KEY, tagOptionsRef)
  ];

  const inlineTriggerPlugins = bridges.map((bridge) =>
    createInlineTriggerPlugin({
      trigger: bridge.character,
      pluginKey: bridge.pluginKey,
      optionsRef: bridge.optionsRef
    })
  );

  const backspacePlugin = new Plugin({
    key: BACKSPACE_PLUGIN_KEY,
    props: {
      handleKeyDown: (view, event) => {
        if (event.key !== "Backspace") {
          return false;
        }
        const { state } = view;
        const { selection } = state;
        if (!selection.empty) {
          return false;
        }
        const markType = state.schema.marks.tag;
        if (!markType) {
          return false;
        }
        const $from = selection.$from;
        const nodeBefore = $from.nodeBefore;
        if (!nodeBefore) {
          return false;
        }
        const mark = nodeBefore.marks.find((candidate) => candidate.type === markType);
        if (!mark) {
          return false;
        }
        const attrs = mark.attrs as { id?: unknown; trigger?: unknown; label?: unknown };
        const triggerChar: TagTriggerCharacter = attrs.trigger === "@" ? "@" : "#";
        const label = typeof attrs.label === "string" ? attrs.label : nodeBefore.text ?? "";
        const start = $from.pos - nodeBefore.nodeSize;
        const plainText = `${triggerChar}${label}`;

        event.preventDefault();

        const replacement = state.schema.text(plainText) as unknown as ReplaceWithContent;
        let replaceTransaction = state.tr.replaceWith(start, $from.pos, replacement);
        const selectionDoc = replaceTransaction.doc as unknown as Parameters<typeof TextSelection.create>[0];
        replaceTransaction = replaceTransaction.setSelection(
          TextSelection.create(selectionDoc, start + plainText.length)
        );
        view.dispatch(replaceTransaction);

        const activeBridge = bridges.find((bridge) => bridge.character === triggerChar);
        if (activeBridge) {
          const reopenTransaction = view.state.tr.setMeta(activeBridge.pluginKey, {
            action: "reopen",
            triggerPos: start,
            headPos: start + plainText.length,
            query: label
          });
          view.dispatch(reopenTransaction);

          const mappedEvent: InlineTriggerEvent = {
            view,
            trigger: {
              from: start,
              to: start + plainText.length,
              query: label
            }
          };
          activeBridge.optionsRef.current?.onStateChange?.(mappedEvent);
        }
        return true;
      }
    }
  });

  const clickPlugin = new Plugin({
    key: CLICK_PLUGIN_KEY,
    props: {
      handleDOMEvents: {
        mousedown: (view, domEvent) => {
          if (!(domEvent instanceof MouseEvent)) {
            return false;
          }
          if (domEvent.button !== 0) {
            return false;
          }
          const handler = tagOptionsRef.current?.onTagClick;
          if (!handler) {
            return false;
          }
          const target = domEvent.target;
          if (!(target instanceof HTMLElement)) {
            return false;
          }
          const element = target.closest<HTMLElement>('[data-tag="true"]');
          if (!element) {
            return false;
          }
          const triggerAttr = element.getAttribute("data-tag-trigger");
          if (triggerAttr !== "#" && triggerAttr !== "@") {
            return false;
          }
          const labelAttr = element.getAttribute("data-tag-label") ?? element.textContent ?? "";
          const label = labelAttr.trim();
          if (label.length === 0) {
            return false;
          }
          const idAttr = element.getAttribute("data-tag-id");
          const trigger = triggerAttr as TagTriggerCharacter;

          domEvent.preventDefault();
          domEvent.stopPropagation();

          handler({
            view,
            event: domEvent,
            trigger,
            label,
            id: idAttr && idAttr.length > 0 ? idAttr : null
          });
          view.focus();
          return true;
        }
      }
    }
  });

  const refresh = () => {
    bridges.forEach((bridge) => bridge.refresh());
  };

  return {
    plugins: [...inlineTriggerPlugins, backspacePlugin, clickPlugin],
    refresh
  };
};

const BRIDGED_PLUGINS: ReadonlyArray<{
  readonly character: TagTriggerCharacter;
  readonly pluginKey: PluginKey<InlineTriggerPluginState>;
}> = [
  { character: "#", pluginKey: HASH_PLUGIN_KEY },
  { character: "@", pluginKey: MENTION_PLUGIN_KEY }
];

export const getTagTrigger = (state: EditorState): TagTrigger | null => {
  for (const bridge of BRIDGED_PLUGINS) {
    const trigger = getInlineTrigger(state, bridge.pluginKey);
    if (trigger) {
      return { ...trigger, triggerChar: bridge.character };
    }
  }
  return null;
};

export const markTagTransaction = (
  transaction: Transaction,
  character: TagTriggerCharacter,
  action: "cancel" | "commit"
): Transaction => {
  const pluginKey =
    character === "#" ? HASH_PLUGIN_KEY : character === "@" ? MENTION_PLUGIN_KEY : null;
  if (pluginKey) {
    markInlineTriggerTransaction(transaction, pluginKey, action);
  }
  return transaction;
};
