import { describe, expect, it } from "vitest";

import {
  clearPaneFocus,
  createMemorySessionStorageAdapter,
  createSessionStore,
  focusPaneEdge,
  stepPaneFocusHistory
} from "../index";

describe("session commands", () => {
  it("stores focus edge and path", () => {
    const store = createSessionStore(createMemorySessionStorageAdapter());

    focusPaneEdge(store, "outline", {
      edgeId: "edge-focused",
      pathEdgeIds: ["edge-root", "edge-focused"]
    });

    const pane = store.getState().panes[0];
    expect(pane.rootEdgeId).toBe("edge-focused");
    expect(pane.focusPathEdgeIds).toEqual(["edge-root", "edge-focused"]);
    expect(pane.focusHistoryIndex).toBe(1);
    expect(pane.focusHistory).toEqual([
      { rootEdgeId: null },
      { rootEdgeId: "edge-focused", focusPathEdgeIds: ["edge-root", "edge-focused"] }
    ]);
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
    expect(pane.focusHistoryIndex).toBe(2);
    expect(pane.focusHistory).toEqual([
      { rootEdgeId: null },
      { rootEdgeId: "edge-focused", focusPathEdgeIds: ["edge-root", "edge-focused"] },
      { rootEdgeId: null }
    ]);
  });

  it("navigates backward and forward through focus history", () => {
    const store = createSessionStore(createMemorySessionStorageAdapter());
    focusPaneEdge(store, "outline", {
      edgeId: "edge-focused",
      pathEdgeIds: ["edge-root", "edge-focused"]
    });
    focusPaneEdge(store, "outline", {
      edgeId: "edge-alt",
      pathEdgeIds: ["edge-root", "edge-alt"]
    });

    let entry = stepPaneFocusHistory(store, "outline", "back");
    expect(entry).toEqual({ rootEdgeId: "edge-focused", focusPathEdgeIds: ["edge-root", "edge-focused"] });
    let pane = store.getState().panes[0];
    expect(pane.rootEdgeId).toBe("edge-focused");
    expect(pane.focusHistoryIndex).toBe(1);

    entry = stepPaneFocusHistory(store, "outline", "back");
    expect(entry).toEqual({ rootEdgeId: null });
    pane = store.getState().panes[0];
    expect(pane.rootEdgeId).toBeNull();
    expect(pane.focusHistoryIndex).toBe(0);

    const noop = stepPaneFocusHistory(store, "outline", "back");
    expect(noop).toBeNull();
    expect(store.getState().panes[0].focusHistoryIndex).toBe(0);

    entry = stepPaneFocusHistory(store, "outline", "forward");
    expect(entry).toEqual({ rootEdgeId: "edge-focused", focusPathEdgeIds: ["edge-root", "edge-focused"] });
    pane = store.getState().panes[0];
    expect(pane.rootEdgeId).toBe("edge-focused");
    expect(pane.focusHistoryIndex).toBe(1);
  });

  it("trims forward history when focusing a new edge", () => {
    const store = createSessionStore(createMemorySessionStorageAdapter());
    focusPaneEdge(store, "outline", {
      edgeId: "edge-one",
      pathEdgeIds: ["edge-root", "edge-one"]
    });
    focusPaneEdge(store, "outline", {
      edgeId: "edge-two",
      pathEdgeIds: ["edge-root", "edge-two"]
    });

    stepPaneFocusHistory(store, "outline", "back");
    focusPaneEdge(store, "outline", {
      edgeId: "edge-three",
      pathEdgeIds: ["edge-root", "edge-three"]
    });

    const pane = store.getState().panes[0];
    expect(pane.rootEdgeId).toBe("edge-three");
    expect(pane.focusHistoryIndex).toBe(2);
    expect(pane.focusHistory).toEqual([
      { rootEdgeId: null },
      { rootEdgeId: "edge-one", focusPathEdgeIds: ["edge-root", "edge-one"] },
      { rootEdgeId: "edge-three", focusPathEdgeIds: ["edge-root", "edge-three"] }
    ]);
    const forward = stepPaneFocusHistory(store, "outline", "forward");
    expect(forward).toBeNull();
    expect(store.getState().panes[0].focusHistoryIndex).toBe(2);
  });
});
