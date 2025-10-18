import { PluginKey } from "prosemirror-state";
import type { Transaction } from "prosemirror-state";

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

export type SlashTrigger = InlineTrigger;
export type SlashTriggerEvent = InlineTriggerEvent;
export type EditorSlashOptions = EditorInlineTriggerOptions;
export type SlashOptionsRef = InlineTriggerOptionsRef;

export const slashPluginKey = new PluginKey<InlineTriggerPluginState>("thortiq-slash");

export const createSlashPlugin = (optionsRef: SlashOptionsRef) => {
  return createInlineTriggerPlugin({
    trigger: "/",
    pluginKey: slashPluginKey,
    optionsRef
  });
};

export const getSlashTrigger = (state: Parameters<typeof getInlineTrigger>[0]): SlashTrigger | null => {
  return getInlineTrigger(state, slashPluginKey);
};

export const markSlashTransaction = (
  transaction: Transaction,
  action: "cancel" | "commit"
): Transaction => {
  return markInlineTriggerTransaction(transaction, slashPluginKey, action);
};


