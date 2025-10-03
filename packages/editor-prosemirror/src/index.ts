import { keymap } from "prosemirror-keymap";
import { baseKeymap, toggleMark } from "prosemirror-commands";
import { EditorState, type Command, type Plugin, type Transaction } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import type { Awareness } from "y-protocols/awareness";
import type { Transaction as YTransaction, UndoManager } from "yjs";
import { yCursorPlugin, ySyncPlugin, yUndoPlugin, ySyncPluginKey, undo, redo } from "y-prosemirror";

import type { EdgeId, OutlineDoc, NodeId } from "@thortiq/client-core";
import { getNodeTextFragment } from "@thortiq/client-core";

import { editorSchema } from "./schema";
import type { OutlineKeymapOptions } from "./outlineKeymap";
import { createOutlineKeymap } from "./outlineKeymap";

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
}

export interface CollaborativeEditor {
  readonly view: EditorView;
  focus: () => void;
  setNode: (nodeId: NodeId) => void;
  setContainer: (container: HTMLElement | null) => void;
  setOutlineKeymapOptions: (options: OutlineKeymapOptions | undefined) => void;
  destroy: () => void;
}

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
    options?: { readonly cursor?: "start" | "end" }
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
  let currentOutlineKeymapOptions = options.outlineKeymapOptions;
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
        outlineKeymapOptions: currentOutlineKeymapOptions
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
    if (currentOutlineKeymapOptions === nextOptions) {
      return;
    }
    currentOutlineKeymapOptions = nextOptions;
    if (!view) {
      return;
    }
    const plugins = createPlugins({
      fragment,
      awareness,
      undoManager,
      schema,
      awarenessIndicatorsEnabled,
      outlineKeymapOptions: currentOutlineKeymapOptions
    });
    const reconfiguredState = view.state.reconfigure({
      plugins
    });
    view.updateState(reconfiguredState);
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
    destroy
  };
};

interface PluginConfig {
  readonly fragment: ReturnType<typeof getNodeTextFragment>;
  readonly awareness: Awareness;
  readonly undoManager: UndoManager;
  readonly schema: typeof editorSchema;
  readonly awarenessIndicatorsEnabled: boolean;
  readonly outlineKeymapOptions?: OutlineKeymapOptions;
}

const createPlugins = ({
  fragment,
  awareness,
  undoManager,
  schema,
  awarenessIndicatorsEnabled,
  outlineKeymapOptions
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

  const plugins: Array<Plugin | null> = [
    ySyncPlugin(fragment),
    yUndoPlugin({ undoManager }),
    outlineKeymapOptions ? createOutlineKeymap(outlineKeymapOptions) : null,
    keymap(historyBindings),
    keymap(markBindings),
    keymap(baseKeymap)
  ];

  if (awarenessIndicatorsEnabled) {
    plugins.splice(1, 0, yCursorPlugin(awareness));
  }

  return plugins.filter((plugin): plugin is NonNullable<typeof plugin> => Boolean(plugin));
};

export { editorSchema };
export {
  createOutlineKeymap,
  type OutlineKeymapHandler,
  type OutlineKeymapHandlerArgs,
  type OutlineKeymapHandlers,
  type OutlineKeymapOptions
} from "./outlineKeymap";
