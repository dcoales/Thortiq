import { describe, expect, it } from "vitest";
import { EditorState, PluginKey } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { schema as basicSchema } from "prosemirror-schema-basic";

import {
  createInlineTriggerPlugin,
  markInlineTriggerTransaction,
  type InlineTriggerPluginState,
  type InlineTriggerOptionsRef
} from "./inlineTriggerPlugin";

describe("inlineTriggerPlugin", () => {
  const createView = (
    optionsRef: InlineTriggerOptionsRef,
    trigger = "[["
  ): { view: EditorView; pluginKey: PluginKey<InlineTriggerPluginState> } => {
    const pluginKey = new PluginKey<InlineTriggerPluginState>("test-inline-trigger");
    const plugin = createInlineTriggerPlugin({
      trigger,
      pluginKey,
      optionsRef
    });
    const state = EditorState.create({
      schema: basicSchema,
      plugins: [plugin]
    });
    const element = document.createElement("div");
    const view = new EditorView(element, {
      state,
      dispatchTransaction: (transaction) => {
        const nextState = view.state.apply(transaction);
        view.updateState(nextState);
      }
    });
    return { view, pluginKey };
  };

  it("activates when the trigger string is typed and updates query text", () => {
    const events: Array<string | null> = [];
    const optionsRef: InlineTriggerOptionsRef = {
      current: {
        onStateChange: (payload) => {
          events.push(payload ? payload.trigger.query : null);
        }
      }
    };

    const { view, pluginKey } = createView(optionsRef);

    view.dispatch(view.state.tr.insertText("[["));
    view.dispatch(view.state.tr.insertText("Alpha"));

    const state = pluginKey.getState(view.state);
    expect(state?.active).toBe(true);
    expect(state?.query).toBe("Alpha");
    expect(events.at(-1)).toBe("Alpha");

    view.dispatch(view.state.tr.insertText("Beta"));
    expect(pluginKey.getState(view.state)?.query).toBe("AlphaBeta");

    view.destroy();
  });

  it("resets when marked as cancelled", () => {
    const optionsRef: InlineTriggerOptionsRef = {
      current: null
    };
    const { view, pluginKey } = createView(optionsRef);
    view.dispatch(view.state.tr.insertText("[["));
    view.dispatch(view.state.tr.insertText("Task"));
    expect(pluginKey.getState(view.state)?.active).toBe(true);

    const transaction = view.state.tr;
    markInlineTriggerTransaction(transaction, pluginKey, "cancel");
    view.dispatch(transaction);

    expect(pluginKey.getState(view.state)?.active).toBe(false);
    view.destroy();
  });
});
