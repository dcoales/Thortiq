import { keymap } from "prosemirror-keymap";
import { baseKeymap, toggleMark } from "prosemirror-commands";
import { EditorState, TextSelection, type Command, type Plugin, type Transaction } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import type { Awareness } from "y-protocols/awareness";
import type { Transaction as YTransaction, UndoManager } from "yjs";
import { yCursorPlugin, ySyncPlugin, yUndoPlugin, ySyncPluginKey, undo, redo } from "y-prosemirror";

import type { EdgeId, OutlineDoc, NodeId } from "@thortiq/client-core";
import { getNodeTextFragment, touchTagRegistryEntryInScope } from "@thortiq/client-core";

import { editorSchema } from "./schema";
import type { OutlineKeymapOptions, OutlineKeymapOptionsRef } from "./outlineKeymap";
import { createOutlineKeymap } from "./outlineKeymap";
import {
  createWikiLinkPlugin,
  getWikiLinkTrigger,
  markWikiLinkTransaction,
  type EditorWikiLinkOptions,
  type WikiLinkTrigger,
  type WikiLinkOptionsRef
} from "./wikiLinkPlugin";
import {
  createMirrorPlugin,
  getMirrorTrigger,
  markMirrorTransaction,
  type EditorMirrorOptions,
  type MirrorTrigger,
  type MirrorOptionsRef
} from "./mirrorPlugin";
import {
  createTagPlugin,
  getTagTrigger,
  markTagTransaction,
  type EditorTagOptions,
  type TagOptionsRef,
  type TagTrigger,
  type TagTriggerCharacter
} from "./tagPlugin";

type ReplaceWithContent = Parameters<Transaction["replaceWith"]>[2];
type SelectionDoc = Parameters<typeof TextSelection.create>[0];

/**
 * Inject a shared stylesheet so ProseMirror mirrors the static outline layout.
 * Keeping the rule detached from React rendering avoids double appends while
 * ensuring every host document uses identical metrics for cursor math.
 */
const ensureEditorStyles = (doc: Document): void => {
  if (doc.getElementById("thortiq-prosemirror-styles")) {
    return;
  }
  const style = doc.createElement("style");
  style.id = "thortiq-prosemirror-styles";
  style.textContent = `
.thortiq-prosemirror {
  background: transparent;
  color: inherit;
  font: inherit;
  line-height: inherit;
  margin: 0;
  padding: 0;
  white-space: pre-wrap;
  word-break: break-word;
}
.thortiq-prosemirror p {
  margin: 0;
  line-height: inherit;
}
.thortiq-prosemirror [data-wikilink="true"] {
  text-decoration: underline;
  cursor: pointer;
}
.thortiq-prosemirror [data-tag="true"] {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.05rem 0.45rem;
  border-radius: 9999px;
  background-color: #eef2ff;
  color: #312e81;
  font-size: 0.85rem;
  font-weight: 600;
  line-height: 1.2;
  margin-right: 0.25rem;
}
`;
  doc.head?.appendChild(style);
};

type UndoManagerRelease = () => void;

const UNDO_GUARD_KEY: unique symbol = Symbol("thortiq:undo-guard");

interface UndoGuardState {
  readonly originalDestroy: UndoManager["destroy"];
  refCount: number;
}

const protectUndoManagerDestroy = (manager: UndoManager): UndoManagerRelease => {
  const managerWithGuard = manager as UndoManager & { [UNDO_GUARD_KEY]?: UndoGuardState };
  const existingState = managerWithGuard[UNDO_GUARD_KEY];
  if (existingState) {
    existingState.refCount += 1;
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      existingState.refCount -= 1;
      if (existingState.refCount === 0) {
        (manager as { destroy: UndoManager["destroy"] }).destroy = existingState.originalDestroy;
        delete managerWithGuard[UNDO_GUARD_KEY];
      }
    };
  }

  const originalDestroy = manager.destroy.bind(manager) as UndoManager["destroy"];
  const state: UndoGuardState = { originalDestroy, refCount: 1 };
  managerWithGuard[UNDO_GUARD_KEY] = state;

  const noopDestroy: UndoManager["destroy"] = () => {
    /* swallow plugin-triggered teardown; restored on release */
  };

  (manager as { destroy: UndoManager["destroy"] }).destroy = noopDestroy;

  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    state.refCount -= 1;
    if (state.refCount === 0) {
      (manager as { destroy: UndoManager["destroy"] }).destroy = state.originalDestroy;
      delete managerWithGuard[UNDO_GUARD_KEY];
    }
  };
};

export interface CreateCollaborativeEditorOptions {
  readonly container: HTMLElement;
  readonly outline: OutlineDoc;
  readonly awareness: Awareness;
  readonly undoManager: UndoManager;
  readonly localOrigin: symbol;
  readonly nodeId: NodeId;
  readonly awarenessIndicatorsEnabled?: boolean;
  readonly awarenessDebugLoggingEnabled?: boolean;
  readonly debugLoggingEnabled?: boolean;
  readonly outlineKeymapOptions?: OutlineKeymapOptions;
  readonly wikiLinkOptions?: EditorWikiLinkOptions | null;
  readonly mirrorOptions?: EditorMirrorOptions | null;
  readonly tagOptions?: EditorTagOptions | null;
}

export interface CollaborativeEditor {
  readonly view: EditorView;
  focus: () => void;
  setNode: (nodeId: NodeId) => void;
  setContainer: (container: HTMLElement | null) => void;
  setOutlineKeymapOptions: (options: OutlineKeymapOptions | undefined) => void;
  setWikiLinkOptions: (options: EditorWikiLinkOptions | null) => void;
  setMirrorOptions: (options: EditorMirrorOptions | null) => void;
  setTagOptions: (options: EditorTagOptions | null) => void;
  getWikiLinkTrigger: () => WikiLinkTrigger | null;
  getMirrorTrigger: () => MirrorTrigger | null;
  getTagTrigger: () => TagTrigger | null;
  applyWikiLink: (options: ApplyWikiLinkOptions) => boolean;
  applyTag: (options: ApplyTagOptions) => boolean;
  cancelWikiLink: () => void;
  consumeMirrorTrigger: () => MirrorTrigger | null;
  cancelMirrorTrigger: () => void;
  consumeTagTrigger: () => TagTrigger | null;
  cancelTagTrigger: () => void;
  destroy: () => void;
}

export interface ApplyWikiLinkOptions {
  readonly targetNodeId: NodeId;
  readonly displayText: string;
}

export interface ApplyTagOptions {
  readonly id: string;
  readonly label: string;
  readonly trigger: TagTriggerCharacter;
}

export type OutlineCursorPlacement = "start" | "end" | { readonly type: "offset"; readonly index: number };

export interface OutlineSelectionAdapter {
  /**
   * Returns the primary edge that should maintain focus in the outline after structural edits.
   */
  readonly getPrimaryEdgeId: () => EdgeId | null;
  /**
   * Returns all edge ids that should participate in structural commands, ordered per outline rows.
   */
  readonly getOrderedEdgeIds: () => readonly EdgeId[];
  /**
   * Updates the primary selection in response to editor-driven commands.
   */
  readonly setPrimaryEdgeId: (
    edgeId: EdgeId | null,
    options?: { readonly cursor?: OutlineCursorPlacement }
  ) => void;
  /**
   * Clears any multi-selection range while leaving the current primary edge intact.
   */
  readonly clearRange: () => void;
}

export const createCollaborativeEditor = (
  options: CreateCollaborativeEditorOptions
): CollaborativeEditor => {
  const {
    container,
    awareness,
    undoManager,
    outline,
    localOrigin,
    awarenessIndicatorsEnabled = true,
    awarenessDebugLoggingEnabled = true,
    debugLoggingEnabled = false
  } = options;
  const releaseUndoManagerDestroy = protectUndoManagerDestroy(undoManager);
  // Ensure the shared undo manager captures ProseMirror-originated transactions.
  undoManager.addTrackedOrigin(ySyncPluginKey);
  const hostDocument = container.ownerDocument;
  if (hostDocument) {
    ensureEditorStyles(hostDocument);
  }
  let currentContainer: HTMLElement | null = container;
  let currentNodeId = options.nodeId;
  const schema = editorSchema;
  const outlineKeymapOptionsRef: OutlineKeymapOptionsRef = {
    current: options.outlineKeymapOptions ?? null
  };
  const outlineKeymapPlugin = createOutlineKeymap(outlineKeymapOptionsRef);
  const wikiLinkOptionsRef: WikiLinkOptionsRef = { current: options.wikiLinkOptions ?? null };
  const wikiLinkPlugin = createWikiLinkPlugin(wikiLinkOptionsRef);
  const mirrorOptionsRef: MirrorOptionsRef = { current: options.mirrorOptions ?? null };
  const mirrorPlugin = createMirrorPlugin(mirrorOptionsRef);
  const tagOptionsRef: TagOptionsRef = { current: options.tagOptions ?? null };
  const tagPluginHandle = createTagPlugin(tagOptionsRef);
  const tagPlugins = tagPluginHandle.plugins;

  const shouldLog = debugLoggingEnabled;
  const log = (...args: unknown[]) => {
    if (!shouldLog) {
      return;
    }
    if (typeof console === "undefined") {
      return;
    }
    const payload = ["[editor]", `node:${currentNodeId}`, ...args];
    if (typeof console.log === "function") {
      console.log(...payload);
      return;
    }
    if (typeof console.debug === "function") {
      console.debug(...payload);
    }
  };

  if (!awareness.getLocalState()) {
    awareness.setLocalStateField("user", {
      name: "local",
      color: "#4f46e5"
    });
  }

  let fragment = getNodeTextFragment(outline, currentNodeId);
  const docLog = (event: string, payload: Record<string, unknown>) => {
    log(`doc:${event}`, { clientId: outline.doc.clientID, ...payload });
  };
  const docTransactionObserver = (transaction: YTransaction) => {
    docLog("afterTransaction", {
      origin: transaction.origin,
      local: transaction.local,
      changed: Array.from(transaction.changedParentTypes.keys()).map((type) => type.constructor.name)
    });
  };
  outline.doc.on("afterTransaction", docTransactionObserver);
  log("load fragment", {
    clientId: outline.doc.clientID,
    length: fragment.length,
    text: fragment.toString()
  });
  const fragmentObserver = () => {
    log("fragment changed", { text: fragment.toString(), length: fragment.length });
  };
  const observeFragment = (nextFragment: typeof fragment) => {
    nextFragment.observeDeep(fragmentObserver);
  };
  const unobserveFragment = (prevFragment: typeof fragment) => {
    prevFragment.unobserveDeep(fragmentObserver);
  };
  observeFragment(fragment);
  const createState = (targetFragment: ReturnType<typeof getNodeTextFragment>) =>
    EditorState.create({
      schema,
      doc: schema.topNodeType.createAndFill() || undefined,
      plugins: createPlugins({
        fragment: targetFragment,
        awareness,
        undoManager,
        schema,
        awarenessIndicatorsEnabled,
        outlineKeymapPlugin,
        wikiLinkPlugin,
        mirrorPlugin,
        tagPlugins
      })
    });

  let view: EditorView | undefined;
  const dispatchTransaction = (transaction: Transaction) => {
    if (!view) {
      log("dispatchTransaction ignored – view missing");
      return;
    }
    log("dispatchTransaction", {
      docChanged: transaction.docChanged,
      steps: transaction.steps.length,
      addToHistory: transaction.getMeta("addToHistory")
    });
    const newState = view.state.apply(transaction);
    if (transaction.docChanged) {
      log("next state text", newState.doc.textContent);
    }
    view.updateState(newState);
  };

  view = new EditorView(container, {
    state: createState(fragment),
    attributes: {
      class: "thortiq-prosemirror"
    },
    dispatchTransaction
  });
  view.dom.style.fontFamily = "inherit";
  view.dom.style.fontSize = "inherit";
  view.dom.style.lineHeight = "inherit";
  view.dom.style.padding = "0";
  view.dom.style.whiteSpace = "pre-wrap";
  view.dom.style.wordBreak = "break-word";
  view.dom.style.outline = "none";
  log("view created");

  const shouldLogAwareness = debugLoggingEnabled && awarenessDebugLoggingEnabled;
  const awarenessUpdateHandler = (changes: unknown) => {
    if (shouldLogAwareness) {
      log("awareness update", changes);
    }
  };
  awareness.on("update", awarenessUpdateHandler);

  const forceSync = () => {
    if (!view) {
      return;
    }
    const syncState = ySyncPluginKey.getState(view.state);
    syncState?.binding._forceRerender();
    undoManager.stopCapturing();
    log("forceSync", { text: fragment.toString(), length: fragment.length });
  };

  if (view) {
    view.dom.dataset.nodeId = currentNodeId;
    forceSync();
  }

  const focus = (): void => {
    if (currentContainer && currentContainer.isConnected && view) {
      log("focus");
      view.focus();
    }
  };

  // Allow callers to reparent the live ProseMirror DOM without tearing the view down.
  const setContainer = (nextContainer: HTMLElement | null): void => {
    if (!view) {
      return;
    }
    if (nextContainer === currentContainer) {
      return;
    }
    if (nextContainer) {
      nextContainer.appendChild(view.dom);
      currentContainer = nextContainer;
      return;
    }
    if (view.dom.parentElement) {
      view.dom.parentElement.removeChild(view.dom);
    }
    currentContainer = null;
  };

  const setOutlineKeymapOptions = (nextOptions: OutlineKeymapOptions | undefined): void => {
    outlineKeymapOptionsRef.current = nextOptions ?? null;
  };

  const setWikiLinkOptions = (nextOptions: EditorWikiLinkOptions | null): void => {
    wikiLinkOptionsRef.current = nextOptions ?? null;
  };

  const setMirrorOptions = (nextOptions: EditorMirrorOptions | null): void => {
    mirrorOptionsRef.current = nextOptions ?? null;
  };

  const setTagOptions = (nextOptions: EditorTagOptions | null): void => {
    tagOptionsRef.current = nextOptions ?? null;
    tagPluginHandle.refresh();
  };

  const getCurrentWikiLinkTrigger = (): WikiLinkTrigger | null => {
    if (!view) {
      return null;
    }
    return getWikiLinkTrigger(view.state);
  };

  const getCurrentMirrorTrigger = (): MirrorTrigger | null => {
    if (!view) {
      return null;
    }
    return getMirrorTrigger(view.state);
  };

  const getCurrentTagTrigger = (): TagTrigger | null => {
    if (!view) {
      return null;
    }
    return getTagTrigger(view.state);
  };

  const applyWikiLink = (options: ApplyWikiLinkOptions): boolean => {
    if (!view) {
      return false;
    }
    const trigger = getWikiLinkTrigger(view.state);
    if (!trigger) {
      return false;
    }
    const markType = schema.marks.wikilink;
    if (!markType) {
      return false;
    }
    const textContent = options.displayText;
    if (textContent.length === 0) {
      return false;
    }
    const mark = markType.create({ nodeId: options.targetNodeId });
    const textNode = schema.text(textContent, [mark]) as unknown as ReplaceWithContent;
    let transaction = view.state.tr.replaceWith(trigger.from, trigger.to, textNode);
    const linkEnd = trigger.from + textContent.length;
    const docAfterReplace = transaction.doc;
    const nextChar = docAfterReplace.textBetween(linkEnd, linkEnd + 1, "\n", "\n");
    let caretPosition = linkEnd;
    if (nextChar === " ") {
      caretPosition = linkEnd + 1;
    } else {
      transaction.insertText(" ", linkEnd);
      caretPosition = linkEnd + 1;
    }
    const selectionDoc = transaction.doc as unknown as SelectionDoc;
    transaction.setSelection(TextSelection.create(selectionDoc, caretPosition));
    markWikiLinkTransaction(transaction, "commit");
    view.dispatch(transaction);
    view.focus();
    return true;
  };

  const applyTag = (options: ApplyTagOptions): boolean => {
    const currentView = view;
    if (!currentView) {
      return false;
    }
    const trigger = getTagTrigger(currentView.state);
    if (!trigger) {
      return false;
    }
    const markType = schema.marks.tag;
    if (!markType) {
      return false;
    }
    const tagLabel = options.label.trim();
    if (tagLabel.length === 0) {
      return false;
    }
    let applied = false;

    const applyTransaction = () => {
      const mark = markType.create({ id: options.id, trigger: options.trigger, label: tagLabel });
      const taggedText = schema.text(tagLabel, [mark]) as unknown as ReplaceWithContent;
      let transaction = currentView.state.tr.replaceWith(trigger.from, trigger.to, taggedText);
      let tagEnd = trigger.from + tagLabel.length;
      const docAfterReplace = transaction.doc;
      const nextChar = docAfterReplace.textBetween(tagEnd, tagEnd + 1, "\n", "\n");
      if (nextChar !== " ") {
        transaction.insertText(" ", tagEnd);
        tagEnd += 1;
      }
      const selectionDoc = transaction.doc as unknown as SelectionDoc;
      transaction.setSelection(TextSelection.create(selectionDoc, tagEnd));
      markTagTransaction(transaction, options.trigger, "commit");
      currentView.dispatch(transaction);
      touchTagRegistryEntryInScope(outline, options.id, { timestamp: Date.now() });
      applied = true;
    };

    outline.doc.transact(applyTransaction, localOrigin);

    if (applied) {
      currentView.focus();
    }
    return applied;
  };

  const cancelWikiLink = (): void => {
    if (!view) {
      return;
    }
    const trigger = getWikiLinkTrigger(view.state);
    if (!trigger) {
      return;
    }
    let transaction = view.state.tr.delete(trigger.from, trigger.to);
    const selectionDoc = transaction.doc as unknown as SelectionDoc;
    transaction.setSelection(TextSelection.create(selectionDoc, trigger.from));
    markWikiLinkTransaction(transaction, "cancel");
    view.dispatch(transaction);
    view.focus();
  };

  const consumeMirrorTrigger = (): MirrorTrigger | null => {
    if (!view) {
      return null;
    }
    const trigger = getMirrorTrigger(view.state);
    if (!trigger) {
      return null;
    }
    let transaction = view.state.tr.delete(trigger.from, trigger.to);
    const selectionDoc = transaction.doc as unknown as SelectionDoc;
    transaction.setSelection(TextSelection.create(selectionDoc, trigger.from));
    markMirrorTransaction(transaction, "commit");
    view.dispatch(transaction);
    view.focus();
    return trigger;
  };

  const cancelMirrorTrigger = (): void => {
    if (!view) {
      return;
    }
    const trigger = getMirrorTrigger(view.state);
    if (!trigger) {
      return;
    }
    let transaction = view.state.tr.delete(trigger.from, trigger.to);
    const selectionDoc = transaction.doc as unknown as SelectionDoc;
    transaction.setSelection(TextSelection.create(selectionDoc, trigger.from));
    markMirrorTransaction(transaction, "cancel");
    view.dispatch(transaction);
    view.focus();
  };

  const consumeTagTrigger = (): TagTrigger | null => {
    if (!view) {
      return null;
    }
    const trigger = getTagTrigger(view.state);
    if (!trigger) {
      return null;
    }
    let transaction = view.state.tr.delete(trigger.from, trigger.to);
    const selectionDoc = transaction.doc as unknown as SelectionDoc;
    transaction.setSelection(TextSelection.create(selectionDoc, trigger.from));
    markTagTransaction(transaction, trigger.triggerChar, "commit");
    view.dispatch(transaction);
    view.focus();
    return trigger;
  };

  const cancelTagTrigger = (): void => {
    if (!view) {
      return;
    }
    const trigger = getTagTrigger(view.state);
    if (!trigger) {
      return;
    }
    let transaction = view.state.tr.delete(trigger.from, trigger.to);
    const selectionDoc = transaction.doc as unknown as SelectionDoc;
    transaction.setSelection(TextSelection.create(selectionDoc, trigger.from));
    markTagTransaction(transaction, trigger.triggerChar, "cancel");
    view.dispatch(transaction);
    view.focus();
  };

  // Swap the collaborative fragment backing the editor while reusing plugins and DOM.
  const setNode = (nextNodeId: NodeId): void => {
    if (!view) {
      return;
    }
    if (nextNodeId === currentNodeId) {
      return;
    }
    const previousFragment = fragment;
    unobserveFragment(previousFragment);
    fragment = getNodeTextFragment(outline, nextNodeId);
    observeFragment(fragment);
    const nextState = createState(fragment);
    currentNodeId = nextNodeId;
    log("setNode", { nodeId: currentNodeId });
    view.updateState(nextState);
    view.dom.dataset.nodeId = currentNodeId;
    forceSync();
  };

  const destroy = (): void => {
    log("destroy");
    awareness.off("update", awarenessUpdateHandler);
    if (awareness.getLocalState()) {
      awareness.setLocalStateField("cursor", null);
    }
    outline.doc.off("afterTransaction", docTransactionObserver);
    unobserveFragment(fragment);
    const oldView = view;
    view = undefined;
    oldView?.destroy();
    releaseUndoManagerDestroy();
  };

  return {
    view: view!,
    focus,
    setNode,
    setContainer,
    setOutlineKeymapOptions,
    setWikiLinkOptions,
    setMirrorOptions,
    setTagOptions,
    getWikiLinkTrigger: getCurrentWikiLinkTrigger,
    getMirrorTrigger: getCurrentMirrorTrigger,
    getTagTrigger: getCurrentTagTrigger,
    applyWikiLink,
    applyTag,
    cancelWikiLink,
    consumeMirrorTrigger,
    cancelMirrorTrigger,
    consumeTagTrigger,
    cancelTagTrigger,
    destroy
  };
};

interface PluginConfig {
  readonly fragment: ReturnType<typeof getNodeTextFragment>;
  readonly awareness: Awareness;
  readonly undoManager: UndoManager;
  readonly schema: typeof editorSchema;
  readonly awarenessIndicatorsEnabled: boolean;
  readonly outlineKeymapPlugin: Plugin;
  readonly wikiLinkPlugin: Plugin;
  readonly mirrorPlugin: Plugin;
  readonly tagPlugins: readonly Plugin[];
}

const createPlugins = ({
  fragment,
  awareness,
  undoManager,
  schema,
  awarenessIndicatorsEnabled,
  outlineKeymapPlugin,
  wikiLinkPlugin,
  mirrorPlugin,
  tagPlugins
}: PluginConfig) => {

  const markBindings: Record<string, Command> = {};
  if (schema.marks.strong) {
    markBindings["Mod-b"] = toggleMark(schema.marks.strong);
  }
  if (schema.marks.em) {
    markBindings["Mod-i"] = toggleMark(schema.marks.em);
  }

  const historyBindings = {
    "Mod-z": undo,
    "Mod-Shift-z": redo,
    "Mod-y": redo
  };

  const plugins: Plugin[] = [ySyncPlugin(fragment)];
  if (awarenessIndicatorsEnabled) {
    plugins.push(yCursorPlugin(awareness));
  }
  plugins.push(wikiLinkPlugin);
  plugins.push(mirrorPlugin);
  tagPlugins.forEach((plugin) => plugins.push(plugin));
  plugins.push(yUndoPlugin({ undoManager }));
  plugins.push(outlineKeymapPlugin);
  plugins.push(keymap(historyBindings));
  plugins.push(keymap(markBindings));
  plugins.push(keymap(baseKeymap));

  return plugins;
};

export { editorSchema };
export {
  createOutlineKeymap,
  type OutlineKeymapHandler,
  type OutlineKeymapHandlerArgs,
  type OutlineKeymapHandlers,
  type OutlineKeymapOptions,
  type OutlineKeymapOptionsRef
} from "./outlineKeymap";
export type {
  EditorWikiLinkOptions,
  WikiLinkActivationEvent,
  WikiLinkHoverEvent,
  WikiLinkTrigger,
  WikiLinkTriggerEvent
} from "./wikiLinkPlugin";
export type { EditorMirrorOptions, MirrorTrigger } from "./mirrorPlugin";
export type { MirrorTriggerEvent } from "./mirrorPlugin";
export type { EditorTagOptions, TagTrigger, TagTriggerEvent } from "./tagPlugin";
