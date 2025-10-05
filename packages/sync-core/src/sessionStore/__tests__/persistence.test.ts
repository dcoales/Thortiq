import { describe, expect, it, vi } from "vitest";

import {
  createMemorySessionStorageAdapter,
  createSessionStore,
  defaultSessionState
} from "../index";

describe("session persistence", () => {
  it("hydrates from adapter value when available", () => {
    const existing = {
      version: 3,
      selectedEdgeId: "edge-123",
      activePaneId: "outline",
      panes: [
        {
          paneId: "outline",
          rootEdgeId: "edge-123",
          activeEdgeId: "edge-123",
          selectionRange: { anchorEdgeId: "edge-123", headEdgeId: "edge-321" },
          collapsedEdgeIds: ["edge-987"],
          pendingFocusEdgeId: "edge-456",
          quickFilter: "tag:urgent",
          focusPathEdgeIds: ["edge-root", "edge-123"],
          focusHistory: [
            { rootEdgeId: null },
            { rootEdgeId: "edge-123", focusPathEdgeIds: ["edge-root", "edge-123"] }
          ],
          focusHistoryIndex: 1,
          searchActive: false,
          searchFrozen: false
        }
      ]
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
        version: 3,
        selectedEdgeId: "edge-789",
        activePaneId: "outline",
        panes: defaultSessionState().panes
      })
    );

    expect(store.getState().selectedEdgeId).toBe("edge-789");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("falls back to default state when payload is malformed", () => {
    const malformed = {
      version: 3,
      selectedEdgeId: 42,
      activePaneId: null,
      panes: "not-an-array"
    };
    const adapter = createMemorySessionStorageAdapter(JSON.stringify(malformed));

    const store = createSessionStore(adapter);

    expect(store.getState()).toEqual(defaultSessionState());
  });

  it("clears incompatible versions during migration", () => {
    const unsupported = {
      version: 1,
      selectedEdgeId: "edge-deprecated",
      activePaneId: "outline",
      panes: []
    };
    const adapter = createMemorySessionStorageAdapter(JSON.stringify(unsupported));

    const store = createSessionStore(adapter);

    expect(store.getState()).toEqual(defaultSessionState());
  });
});
