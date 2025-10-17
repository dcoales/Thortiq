import { describe, expect, it } from "vitest";

import {
  createMemorySessionStorageAdapter,
  createSessionStore,
  focusPaneEdge,
  reconcilePaneFocus
} from "../index";

const getOutlinePane = (store: ReturnType<typeof createSessionStore>) => {
  const pane = store.getState().panesById["outline"];
  if (!pane) {
    throw new Error("expected outline pane");
  }
  return pane;
};

describe("session reconciliation", () => {
  it("drops focus when the edge disappears", () => {
    const store = createSessionStore(createMemorySessionStorageAdapter());
    focusPaneEdge(store, "outline", {
      edgeId: "edge-focused",
      pathEdgeIds: ["edge-root", "edge-focused"]
    });

    reconcilePaneFocus(store, new Set(["edge-other"]));

    const pane = getOutlinePane(store);
    expect(pane.rootEdgeId).toBeNull();
    expect(pane.focusPathEdgeIds).toBeUndefined();
    expect(pane.focusHistoryIndex).toBe(0);
    expect(pane.focusHistory).toEqual([{ rootEdgeId: null }]);
  });

  it("normalises focus path to available edges", () => {
    const store = createSessionStore(createMemorySessionStorageAdapter());
    focusPaneEdge(store, "outline", {
      edgeId: "edge-focused",
      pathEdgeIds: ["edge-root", "edge-middle", "edge-focused"]
    });

    reconcilePaneFocus(store, new Set(["edge-root", "edge-focused"]));

    const pane = getOutlinePane(store);
    expect(pane.rootEdgeId).toBe("edge-focused");
    expect(pane.focusPathEdgeIds).toEqual(["edge-root", "edge-focused"]);
    expect(pane.focusHistoryIndex).toBe(1);
    expect(pane.focusHistory).toEqual([
      { rootEdgeId: null },
      { rootEdgeId: "edge-focused", focusPathEdgeIds: ["edge-root", "edge-focused"] }
    ]);
  });
});
