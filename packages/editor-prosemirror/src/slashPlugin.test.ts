import { describe, expect, it, vi } from "vitest";

import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { schema as basicSchema } from "prosemirror-schema-basic";

import {
  createSlashPlugin,
  getSlashTrigger,
  markSlashTransaction,
  type EditorSlashOptions,
  type SlashOptionsRef
} from "./slashPlugin";

const createView = (
  options: EditorSlashOptions | null = null
): { view: EditorView; optionsRef: SlashOptionsRef } => {
  const optionsRef: SlashOptionsRef = { current: options };
  const plugin = createSlashPlugin(optionsRef);
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
  return { view, optionsRef };
};

describe("slashPlugin", () => {
  it("activates when typing '/' and updates query as characters are typed", () => {
    const onStateChange = vi.fn();
    const { view, optionsRef } = createView({ onStateChange });
    optionsRef.current = { onStateChange };

    // Type '/'
    const tr1 = view.state.tr.insertText("/");
    view.dispatch(tr1);
    expect(onStateChange).toHaveBeenCalled();
    const trigger1 = getSlashTrigger(view.state);
    expect(trigger1).not.toBeNull();
    expect(trigger1?.from).toBeLessThan(trigger1!.to);
    expect(trigger1?.query).toBe("");

    onStateChange.mockClear();
    // Type 'h2' after '/'
    const tr2 = view.state.tr.insertText("h2");
    view.dispatch(tr2);
    expect(onStateChange).toHaveBeenCalled();
    const trigger2 = getSlashTrigger(view.state);
    expect(trigger2?.query).toBe("h2");
  });

  it("forwards key handling to options first, else prevents default for Enter/Escape/Arrows", () => {
    const onKeyDown = vi.fn((event: KeyboardEvent) => {
      void event;
      return false;
    });
    const { view, optionsRef } = createView({ onKeyDown });
    optionsRef.current = { onKeyDown };

    // Activate with '/'
    view.dispatch(view.state.tr.insertText("/"));

    const mkEvent = (key: string) => ({ key, preventDefault: vi.fn() }) as unknown as KeyboardEvent;

    // Default handled keys
    const keys = ["Enter", "Escape", "ArrowDown", "ArrowUp"] as const;
    for (const key of keys) {
      const event = mkEvent(key);
      const handled = view.someProp("handleKeyDown", (fn) => (fn as any)?.(view, event));
      // someProp returns true if any prop function returns true; we can directly invoke plugin props
      // however here, validate preventDefault was called via plugin
      void handled;
      expect((event as unknown as { preventDefault: () => void; _calls?: number }).preventDefault).toHaveBeenCalled();
    }
  });

  it("clears state when a cancel meta is marked on a transaction", () => {
    const { view } = createView();
    view.dispatch(view.state.tr.insertText("/"));
    expect(getSlashTrigger(view.state)).not.toBeNull();
    const tr = view.state.tr;
    markSlashTransaction(tr, "cancel");
    view.dispatch(tr);
    expect(getSlashTrigger(view.state)).toBeNull();
  });
});


