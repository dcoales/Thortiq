import { describe, expect, it, vi } from "vitest";

import {
  clearPaneFocus,
  createMemorySessionStorageAdapter,
  createSessionStore,
  defaultSessionState,
  focusPaneEdge,
  reconcilePaneFocus
} from "./sessionStore";

describe("createSessionStore", () => {
  it("hydrates from adapter value when available", () => {
    const existing = {
      version: 3,
      selectedEdgeId: "edge-123",
      activePaneId: "outline",
      panes: [
        {
          paneId: "outline",
          rootEdgeId: "edge-root",
          activeEdgeId: "edge-123",
          selectionRange: { anchorEdgeId: "edge-123", headEdgeId: "edge-321" },
          collapsedEdgeIds: ["edge-987"],
          pendingFocusEdgeId: "edge-456",
          quickFilter: "tag:urgent",
          focusPathEdgeIds: ["edge-root", "edge-123"]
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

  it("ignores payloads with unsupported version", () => {
    const unsupported = {
      version: 999,
      selectedEdgeId: "edge-unsupported",
      activePaneId: "outline",
      panes: []
    };
    const adapter = createMemorySessionStorageAdapter(JSON.stringify(unsupported));

    const store = createSessionStore(adapter);

    expect(store.getState()).toEqual(defaultSessionState());
  });
});

describe("focus helpers", () => {
  it("stores focus edge and path", () => {
    const store = createSessionStore(createMemorySessionStorageAdapter());

    focusPaneEdge(store, "outline", {
      edgeId: "edge-focused",
      pathEdgeIds: ["edge-root", "edge-focused"]
    });

    const pane = store.getState().panes[0];
    expect(pane.rootEdgeId).toBe("edge-focused");
    expect(pane.focusPathEdgeIds).toEqual(["edge-root", "edge-focused"]);
    expect(store.getState().activePaneId).toBe("outline");
  });

  it("clears stored focus state", () => {
    const store = createSessionStore(createMemorySessionStorageAdapter());
    focusPaneEdge(store, "outline", {
      edgeId: "edge-focused",
      pathEdgeIds: ["edge-root", "edge-focused"]
    });

    clearPaneFocus(store, "outline");

    const pane = store.getState().panes[0];
    expect(pane.rootEdgeId).toBeNull();
    expect(pane.focusPathEdgeIds).toBeUndefined();
  });

  it("drops focus when the edge disappears", () => {
    const store = createSessionStore(createMemorySessionStorageAdapter());
    focusPaneEdge(store, "outline", {
      edgeId: "edge-focused",
      pathEdgeIds: ["edge-root", "edge-focused"]
    });

    reconcilePaneFocus(store, new Set(["edge-other"]));

    const pane = store.getState().panes[0];
    expect(pane.rootEdgeId).toBeNull();
    expect(pane.focusPathEdgeIds).toBeUndefined();
  });

  it("normalises focus path to available edges", () => {
    const store = createSessionStore(createMemorySessionStorageAdapter());
    focusPaneEdge(store, "outline", {
      edgeId: "edge-focused",
      pathEdgeIds: ["edge-root", "edge-middle", "edge-focused"]
    });

    reconcilePaneFocus(store, new Set(["edge-root", "edge-focused"]));

    const pane = store.getState().panes[0];
    expect(pane.rootEdgeId).toBe("edge-focused");
    expect(pane.focusPathEdgeIds).toEqual(["edge-root", "edge-focused"]);
  });
});
