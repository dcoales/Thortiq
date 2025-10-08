import { describe, expect, it, vi } from "vitest";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";

import { editorSchema } from "./schema";
import { createOutlineKeymap, type OutlineKeymapHandlers } from "./outlineKeymap";
import { createSyncContext } from "@thortiq/sync-core";
import {
  addEdge,
  createNode,
  getEdgeSnapshot,
  type EdgeId
} from "@thortiq/client-core";
import { indentEdges } from "@thortiq/outline-commands";

describe("createOutlineKeymap", () => {
  const createView = (handlers: OutlineKeymapHandlers) => {
    const optionsRef = {
      current: { handlers }
    };
    const state = EditorState.create({
      schema: editorSchema,
      plugins: [createOutlineKeymap(optionsRef)]
    });
    const dom = document.createElement("div");
    const view = new EditorView(dom, {
      state,
      dispatchTransaction: () => {
        /* outline keymap tests do not expect transactions */
      }
    });
    return view;
  };

  it("invokes the indent handler for Tab presses", () => {
    const indent = vi.fn().mockReturnValue(true);
    const view = createView({ indent });
    view.focus();
    const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true });
    const preventDefaultSpy = vi.spyOn(event, "preventDefault");
    view.dom.dispatchEvent(event);
    expect(indent).toHaveBeenCalledOnce();
    expect(preventDefaultSpy).toHaveBeenCalledOnce();
    view.destroy();
  });

  it("invokes the merge handler for Backspace presses", () => {
    const mergeWithPrevious = vi.fn().mockReturnValue(true);
    const view = createView({ mergeWithPrevious });
    view.focus();
    const event = new KeyboardEvent("keydown", { key: "Backspace", bubbles: true });
    const preventDefaultSpy = vi.spyOn(event, "preventDefault");
    view.dom.dispatchEvent(event);
    expect(mergeWithPrevious).toHaveBeenCalledOnce();
    expect(preventDefaultSpy).toHaveBeenCalledOnce();
    view.destroy();
  });

  it("invokes the arrow down handler", () => {
    const arrowDown = vi.fn().mockReturnValue(true);
    const view = createView({ arrowDown });
    view.focus();
    const event = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true });
    const preventDefaultSpy = vi.spyOn(event, "preventDefault");
    view.dom.dispatchEvent(event);
    expect(arrowDown).toHaveBeenCalledOnce();
    expect(preventDefaultSpy).toHaveBeenCalledOnce();
    view.destroy();
  });

  it("invokes the arrow up handler", () => {
    const arrowUp = vi.fn().mockReturnValue(true);
    const view = createView({ arrowUp });
    view.focus();
    const event = new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true });
    const preventDefaultSpy = vi.spyOn(event, "preventDefault");
    view.dom.dispatchEvent(event);
    expect(arrowUp).toHaveBeenCalledOnce();
    expect(preventDefaultSpy).toHaveBeenCalledOnce();
    view.destroy();
  });

  it("invokes the delete handler for Ctrl-Shift-Backspace presses", () => {
    const deleteSelection = vi.fn().mockReturnValue(true);
    const view = createView({ deleteSelection });
    view.focus();
    const event = new KeyboardEvent("keydown", {
      key: "Backspace",
      ctrlKey: true,
      shiftKey: true,
      bubbles: true
    });
    const preventDefaultSpy = vi.spyOn(event, "preventDefault");
    view.dom.dispatchEvent(event);
    expect(deleteSelection).toHaveBeenCalledOnce();
    expect(preventDefaultSpy).toHaveBeenCalledOnce();
    view.destroy();
  });

  it("allows handlers to mutate the outline on Tab", () => {
    const sync = createSyncContext();
    const firstNode = createNode(sync.outline, { text: "First" });
    const secondNode = createNode(sync.outline, { text: "Second" });
    addEdge(sync.outline, {
      parentNodeId: null,
      childNodeId: firstNode,
      origin: sync.localOrigin
    }).edgeId;
    const secondEdge = addEdge(sync.outline, {
      parentNodeId: null,
      childNodeId: secondNode,
      origin: sync.localOrigin
    }).edgeId;

    let currentSelection: EdgeId[] = [secondEdge];
    const indent = vi.fn(() => {
      const result = indentEdges({ outline: sync.outline, origin: sync.localOrigin }, [...currentSelection].reverse());
      if (!result) {
        return false;
      }
      currentSelection = [result[result.length - 1]!.edgeId];
      return true;
    });

    const view = createView({ indent });
    view.focus();
    const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true });
    view.dom.dispatchEvent(event);

    expect(indent).toHaveBeenCalledOnce();
    const updatedSnapshot = getEdgeSnapshot(sync.outline, secondEdge);
    expect(updatedSnapshot.parentNodeId).toBe(firstNode);

    view.destroy();
  });
});
