import { keymap } from "prosemirror-keymap";
import { baseKeymap, toggleMark } from "prosemirror-commands";
import { history, redo, undo } from "prosemirror-history";
import { EditorState, type Command } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import type { Awareness } from "y-protocols/awareness";
import type { UndoManager } from "yjs";
import { yCursorPlugin, ySyncPlugin, yUndoPlugin, ySyncPluginKey } from "y-prosemirror";

import type { OutlineDoc, NodeId } from "@thortiq/client-core";
import { getNodeTextFragment } from "@thortiq/client-core";

import { editorSchema } from "./schema";

export interface CreateCollaborativeEditorOptions {
  readonly container: HTMLElement;
  readonly outline: OutlineDoc;
  readonly awareness: Awareness;
  readonly undoManager: UndoManager;
  readonly localOrigin: symbol;
  readonly nodeId: NodeId;
}

export interface CollaborativeEditor {
  readonly view: EditorView;
  focus: () => void;
  destroy: () => void;
}

export const createCollaborativeEditor = (
  options: CreateCollaborativeEditorOptions
): CollaborativeEditor => {
  const { container, awareness, undoManager, outline, nodeId } = options;
  const schema = editorSchema;

  const log = (...args: unknown[]) => {
    if (typeof console !== "undefined") {
      console.debug("[editor]", `node:${nodeId}`, ...args);
    }
  };

  if (!awareness.getLocalState()) {
    awareness.setLocalStateField("user", {
      name: "local",
      color: "#4f46e5"
    });
  }

  const fragment = getNodeTextFragment(outline, nodeId);
  const createState = (targetFragment: ReturnType<typeof getNodeTextFragment>) =>
    EditorState.create({
      schema,
      doc: schema.topNodeType.createAndFill() || undefined,
      plugins: createPlugins({ fragment: targetFragment, awareness, undoManager, schema })
    });

  let view: EditorView | undefined;
  const dispatchTransaction = (transaction: Parameters<EditorView["dispatchTransaction"]>[0]) => {
    if (!view) {
      log("dispatchTransaction ignored – view missing");
      return;
    }
    log("dispatchTransaction", transaction.docChanged, transaction.getMeta("addToHistory"));
    const newState = view.state.apply(transaction);
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

  const awarenessUpdateHandler = (changes: unknown) => {
    log("awareness update", changes);
  };
  awareness.on("update", awarenessUpdateHandler);

  const forceSync = () => {
    if (!view) {
      return;
    }
    const syncState = ySyncPluginKey.getState(view.state);
    syncState?.binding._forceRerender();
    undoManager.stopCapturing();
  };

  if (view) {
    view.dom.dataset.nodeId = nodeId;
    forceSync();
  }

  const focus = (): void => {
    if (container.isConnected && view) {
      log("focus");
      view.focus();
    }
  };

  const destroy = (): void => {
    log("destroy");
    awareness.off("update", awarenessUpdateHandler);
    if (awareness.getLocalState()) {
      awareness.setLocalStateField("cursor", null);
    }
    const oldView = view;
    view = undefined;
    oldView?.destroy();
  };

  return {
    view: view!,
    focus,
    destroy
  };
};

interface PluginConfig {
  readonly fragment: ReturnType<typeof getNodeTextFragment>;
  readonly awareness: Awareness;
  readonly undoManager: UndoManager;
  readonly schema: typeof editorSchema;
}

const createPlugins = ({ fragment, awareness, undoManager, schema }: PluginConfig) => {
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

  return [
    ySyncPlugin(fragment),
    yCursorPlugin(awareness),
    yUndoPlugin({ undoManager }),
    history(),
    keymap(historyBindings),
    keymap(markBindings),
    keymap(baseKeymap)
  ];
};

export { editorSchema };
