/**
 * Tag trigger plugin wraps the generic inline trigger helper so both "#" and "@"
 * characters share an options surface. Consumers receive unified callbacks with
 * the trigger character attached, enabling a single suggestion controller to
 * handle tag and mention flows without duplicating keyboard logic.
 */
import { PluginKey } from "prosemirror-state";
import type { EditorState, Transaction } from "prosemirror-state";
import type { Plugin } from "prosemirror-state";
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

export type TagTriggerCharacter = "#" | "@";

export interface TagTrigger extends InlineTrigger {
  readonly triggerChar: TagTriggerCharacter;
}

export interface TagTriggerEvent {
  readonly view: EditorView;
  readonly trigger: TagTrigger;
}

export interface EditorTagOptions {
  readonly onStateChange?: (event: TagTriggerEvent | null) => void;
  readonly onKeyDown?: (event: KeyboardEvent, context: TagTriggerEvent) => boolean;
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

export const createTagPlugin = (optionsRef: TagOptionsRef): TagPluginHandle => {
  const bridges: TriggerBridge[] = [
    createBridge("#", HASH_PLUGIN_KEY, optionsRef),
    createBridge("@", MENTION_PLUGIN_KEY, optionsRef)
  ];

  const plugins = bridges.map((bridge) =>
    createInlineTriggerPlugin({
      trigger: bridge.character,
      pluginKey: bridge.pluginKey,
      optionsRef: bridge.optionsRef
    })
  );

  const refresh = () => {
    bridges.forEach((bridge) => bridge.refresh());
  };

  return {
    plugins,
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
