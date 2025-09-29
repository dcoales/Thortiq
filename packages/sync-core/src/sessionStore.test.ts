import { describe, expect, it, vi } from "vitest";

import {
  createMemorySessionStorageAdapter,
  createSessionStore,
  defaultSessionState
} from "./sessionStore";

describe("createSessionStore", () => {
  it("hydrates from adapter value when available", () => {
    const existing = {
      version: 1,
      selectedEdgeId: "edge-123",
      panes: [{ paneId: "outline", rootEdgeId: "edge-root" }]
    };
    const adapter = createMemorySessionStorageAdapter(JSON.stringify(existing));

    const store = createSessionStore(adapter);

    expect(store.getState()).toEqual(existing);
  });

  it("writes updates and notifies subscribers", () => {
    const adapter = createMemorySessionStorageAdapter();
    const store = createSessionStore(adapter);
    const listener = vi.fn();

    store.subscribe(listener);

    store.update((state) => ({
      ...state,
      selectedEdgeId: "edge-456"
    }));

    expect(store.getState().selectedEdgeId).toBe("edge-456");
    expect(JSON.parse(adapter.read() ?? "null")).toMatchObject({ selectedEdgeId: "edge-456" });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("reacts to external adapter changes", () => {
    const adapter = createMemorySessionStorageAdapter();
    const store = createSessionStore(adapter);
    const listener = vi.fn();

    store.subscribe(listener);

    adapter.write(
      JSON.stringify({
        version: 1,
        selectedEdgeId: "edge-789",
        panes: defaultSessionState().panes
      })
    );

    expect(store.getState().selectedEdgeId).toBe("edge-789");
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
