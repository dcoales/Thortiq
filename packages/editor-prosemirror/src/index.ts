import { keymap } from "prosemirror-keymap";
import { baseKeymap, toggleMark } from "prosemirror-commands";
import { history, redo, undo } from "prosemirror-history";
import { EditorState, TextSelection, type Command } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import type { Awareness } from "y-protocols/awareness";
import type { UndoManager } from "yjs";
import { yCursorPlugin, ySyncPlugin, yUndoPlugin } from "y-prosemirror";

import type { OutlineDoc, NodeId } from "@thortiq/client-core";
import { getNodeTextFragment } from "@thortiq/client-core";

import { editorSchema } from "./schema";

export interface CreateCollaborativeEditorOptions {
  readonly container: HTMLElement;
  readonly outline: OutlineDoc;
  readonly awareness: Awareness;
  readonly undoManager: UndoManager;
  readonly localOrigin: symbol;
}

export interface CollaborativeEditor {
  readonly view: EditorView;
  setNode: (nodeId: NodeId) => void;
  focus: () => void;
  destroy: () => void;
}

export const createCollaborativeEditor = (
  options: CreateCollaborativeEditorOptions
): CollaborativeEditor => {
  const { container, awareness, undoManager, outline } = options;
  const schema = editorSchema;

  if (!awareness.getLocalState()) {
    awareness.setLocalStateField("user", {
      name: "local",
      color: "#4f46e5"
    });
  }

  const placeholderState = EditorState.create({
    schema,
    doc: schema.topNodeType.createAndFill() || undefined
  });

  const view = new EditorView(container, {
    state: placeholderState,
    attributes: {
      class: "thortiq-prosemirror"
    },
    dispatchTransaction(transaction) {
      const newState = view.state.apply(transaction);
      view.updateState(newState);
    }
  });
  view.dom.style.fontFamily = "inherit";
  view.dom.style.fontSize = "inherit";
  view.dom.style.lineHeight = "inherit";
  view.dom.style.padding = "0";
  view.dom.style.whiteSpace = "pre-wrap";
  view.dom.style.wordBreak = "break-word";
  view.dom.style.outline = "none";

  let currentNodeId: NodeId | null = null;

  const setNode = (nodeId: NodeId): void => {
    if (currentNodeId === nodeId) {
      return;
    }

    const fragment = getNodeTextFragment(outline, nodeId);
    const plugins = createPlugins({ fragment, awareness, undoManager, schema });

    let state = EditorState.create({
      schema,
      doc: schema.topNodeType.createAndFill() || undefined,
      plugins
    });

    const endSelection = TextSelection.atEnd(state.doc);
    state = state.apply(state.tr.setSelection(endSelection));

    undoManager.stopCapturing();
    view.updateState(state);
    currentNodeId = nodeId;
    view.dom.dataset.nodeId = nodeId;
  };

  const focus = (): void => {
    if (container.isConnected) {
      view.focus();
    }
  };

  const destroy = (): void => {
    view.destroy();
  };

  return {
    view,
    setNode,
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
