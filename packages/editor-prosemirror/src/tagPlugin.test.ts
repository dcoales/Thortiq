import { describe, expect, it, vi } from "vitest";

import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { schema as basicSchema } from "prosemirror-schema-basic";

import {
  createTagPlugin,
  getTagTrigger,
  markTagTransaction,
  type EditorTagOptions,
  type TagOptionsRef,
  type TagTrigger
} from "./tagPlugin";

const createView = (
  options: EditorTagOptions | null = null
): { view: EditorView; optionsRef: TagOptionsRef; refresh: () => void } => {
  const optionsRef: TagOptionsRef = { current: options };
  const handle = createTagPlugin(optionsRef);
  const state = EditorState.create({
    schema: basicSchema,
    plugins: [...handle.plugins]
  });
  const element = document.createElement("div");
  const view = new EditorView(element, {
    state,
    dispatchTransaction: (transaction) => {
      const nextState = view.state.apply(transaction);
      view.updateState(nextState);
    }
  });
  return {
    view,
    optionsRef,
    refresh: handle.refresh
  };
};

describe("tagPlugin", () => {
  it("activates for hash and at triggers with distinct callback payloads", () => {
    const events: Array<{ char: TagTrigger["triggerChar"] | null; query: string | null }> = [];
    const { view, optionsRef, refresh } = createView();
    optionsRef.current = {
      onStateChange: (event) => {
        events.push({
          char: event ? event.trigger.triggerChar : null,
          query: event ? event.trigger.query : null
        });
      }
    };
    refresh();

    view.dispatch(view.state.tr.insertText("#"));
    view.dispatch(view.state.tr.insertText("Alpha"));
    expect(events.at(-1)).toEqual({ char: "#", query: "Alpha" });
    expect(getTagTrigger(view.state)).toMatchObject({ triggerChar: "#", query: "Alpha" });

    // Reset document before testing mention trigger.
    view.dispatch(view.state.tr.delete(0, view.state.doc.content.size));
    view.dispatch(view.state.tr.insertText("@"));
    view.dispatch(view.state.tr.insertText("Beta"));
    expect(events.at(-1)).toEqual({ char: "@", query: "Beta" });
    expect(getTagTrigger(view.state)).toMatchObject({ triggerChar: "@", query: "Beta" });

    view.destroy();
  });

  it("marks tag transactions as cancelled", () => {
    const { view } = createView();
    view.dispatch(view.state.tr.insertText("#"));
    view.dispatch(view.state.tr.insertText("Todo"));
    expect(getTagTrigger(view.state)).not.toBeNull();

    const transaction = view.state.tr;
    markTagTransaction(transaction, "#", "cancel");
    view.dispatch(transaction);

    expect(getTagTrigger(view.state)).toBeNull();
    view.destroy();
  });

  it("invokes tag click handler when tag elements are clicked", () => {
    const onTagClick = vi.fn();
    const { view, optionsRef, refresh } = createView({ onTagClick });
    optionsRef.current = { onTagClick };
    refresh();

    const tagSpan = document.createElement("span");
    tagSpan.setAttribute("data-tag", "true");
    tagSpan.setAttribute("data-tag-trigger", "#");
    tagSpan.setAttribute("data-tag-label", "alpha");
    tagSpan.setAttribute("data-tag-id", "alpha");
    tagSpan.textContent = "#alpha";
    view.dom.appendChild(tagSpan);

    const handlers = view.someProp("handleDOMEvents");
    expect(handlers?.mousedown).toBeTypeOf("function");
    const event = new MouseEvent("mousedown", { bubbles: true, button: 0, cancelable: true });
    Object.defineProperty(event, "target", { configurable: true, value: tagSpan });
    const handled = handlers?.mousedown?.(view, event);

    expect(handled).toBe(true);
    expect(onTagClick).toHaveBeenCalledTimes(1);
    expect(onTagClick).toHaveBeenLastCalledWith(
      expect.objectContaining({
        trigger: "#",
        label: "alpha",
        id: "alpha"
      })
    );

    view.destroy();
  });
});
