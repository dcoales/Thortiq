import { PluginKey } from "prosemirror-state";
import type { EditorState, Transaction } from "prosemirror-state";

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

export type MirrorTrigger = InlineTrigger;
export type MirrorTriggerEvent = InlineTriggerEvent;
export type EditorMirrorOptions = EditorInlineTriggerOptions;
export type MirrorOptionsRef = InlineTriggerOptionsRef;

export const mirrorPluginKey = new PluginKey<InlineTriggerPluginState>("thortiq-mirror");

export const createMirrorPlugin = (optionsRef: MirrorOptionsRef) => {
  return createInlineTriggerPlugin({
    trigger: "((",
    pluginKey: mirrorPluginKey,
    optionsRef
  });
};

export const getMirrorTrigger = (state: EditorState): MirrorTrigger | null => {
  return getInlineTrigger(state, mirrorPluginKey);
};

export const markMirrorTransaction = (
  transaction: Transaction,
  action: "cancel" | "commit"
): Transaction => {
  return markInlineTriggerTransaction(transaction, mirrorPluginKey, action);
};
