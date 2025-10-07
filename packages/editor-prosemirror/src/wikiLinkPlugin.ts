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

export type WikiLinkTrigger = InlineTrigger;
export type WikiLinkTriggerEvent = InlineTriggerEvent;
export type EditorWikiLinkOptions = EditorInlineTriggerOptions;
export type WikiLinkOptionsRef = InlineTriggerOptionsRef;

export const wikiLinkPluginKey = new PluginKey<InlineTriggerPluginState>("thortiq-wikilink");

export const createWikiLinkPlugin = (optionsRef: WikiLinkOptionsRef) => {
  return createInlineTriggerPlugin({
    trigger: "[[",
    pluginKey: wikiLinkPluginKey,
    optionsRef
  });
};

export const getWikiLinkTrigger = (state: EditorState): WikiLinkTrigger | null => {
  return getInlineTrigger(state, wikiLinkPluginKey);
};

export const markWikiLinkTransaction = (
  transaction: Transaction,
  action: "cancel" | "commit"
): Transaction => {
  return markInlineTriggerTransaction(transaction, wikiLinkPluginKey, action);
};
