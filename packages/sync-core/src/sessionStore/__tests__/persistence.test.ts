import { describe, expect, it, vi } from "vitest";

import {
  createMemorySessionStorageAdapter,
  createSessionStore,
  defaultSessionState,
  SESSION_VERSION
} from "../index";

describe("session persistence", () => {
  it("hydrates from adapter value when available", () => {
    const existing = {
      version: SESSION_VERSION,
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
          focusPathEdgeIds: ["edge-root", "edge-123"],
          focusHistory: [
            { rootEdgeId: null },
            { rootEdgeId: "edge-123", focusPathEdgeIds: ["edge-root", "edge-123"] }
          ],
          focusHistoryIndex: 1,
          search: {
            draft: "tag:urgent",
            submitted: "tag:urgent",
            isInputVisible: true,
            resultEdgeIds: ["edge-123"],
            manuallyExpandedEdgeIds: ["edge-777"],
            manuallyCollapsedEdgeIds: ["edge-999"],
            appendedEdgeIds: ["edge-appended"]
          }
        }
      ]
    };
    const adapter = createMemorySessionStorageAdapter(JSON.stringify(existing));

    const store = createSessionStore(adapter);

    expect(store.getState()).toEqual(existing);
  });

  it("migrates legacy quickFilter payloads into structured search state", () => {
    const legacy = {
      version: 3,
      selectedEdgeId: "edge-legacy",
      activePaneId: "outline",
      panes: [
        {
          paneId: "outline",
          rootEdgeId: "edge-legacy",
          activeEdgeId: "edge-legacy",
          collapsedEdgeIds: [],
          pendingFocusEdgeId: null,
          quickFilter: "  tag:legacy  ",
          focusHistory: [{ rootEdgeId: null }],
          focusHistoryIndex: 0
        }
      ]
    };
    const adapter = createMemorySessionStorageAdapter(JSON.stringify(legacy));

    const store = createSessionStore(adapter);
    const [pane] = store.getState().panes;

    expect(pane.search).toEqual({
      draft: "  tag:legacy  ",
      submitted: "  tag:legacy  ",
      isInputVisible: false,
      resultEdgeIds: [],
      manuallyExpandedEdgeIds: [],
      manuallyCollapsedEdgeIds: [],
      appendedEdgeIds: []
    });
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
        version: SESSION_VERSION,
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
      version: SESSION_VERSION,
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
