import { describe, expect, it } from "vitest";

import { createOutlineStore } from "../store";
import { createEphemeralPersistenceFactory } from "../../sync/persistence";
import { createEphemeralProviderFactory } from "../../sync/ephemeralProvider";
import { createMemorySessionStorageAdapter } from "@thortiq/sync-core";
import { addEdge, createNode } from "../../doc";
import type { SearchExpression } from "../../search/types";

const createTestStore = () =>
  createOutlineStore({
    persistenceFactory: createEphemeralPersistenceFactory(),
    providerFactory: createEphemeralProviderFactory(),
    sessionAdapter: createMemorySessionStorageAdapter(),
    autoConnect: false,
    skipDefaultSeed: true
  });

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

const getPane = (store: ReturnType<typeof createTestStore>, paneId: string) => {
  const state = store.session.getState();
  return state.panesById[paneId] ?? null;
};

describe("outline store search commands", () => {
  it("runs pane search, stores ancestors, and exposes runtime metadata", async () => {
    const store = createTestStore();

    try {
      store.attach();
      await store.ready;

      const { outline, localOrigin } = store.sync;
      const rootNodeId = createNode(outline, { text: "Parent", origin: localOrigin });
      const { edgeId: rootEdgeId } = addEdge(outline, {
        parentNodeId: null,
        childNodeId: rootNodeId,
        origin: localOrigin
      });
      const { edgeId: childEdgeId } = addEdge(outline, {
        parentNodeId: rootNodeId,
        text: "Child match",
        origin: localOrigin
      });

      await flushMicrotasks();

      const expression: SearchExpression = {
        type: "predicate",
        field: "text",
        comparator: ":",
        value: { kind: "string", value: "child match" }
      };

      store.runPaneSearch("outline", { query: "text:\"Child match\"", expression });

      const pane = getPane(store, "outline");
      expect(pane).toBeDefined();
      expect(pane?.search.submitted).toBe("text:\"Child match\"");
      expect(pane?.search.resultEdgeIds).toEqual([rootEdgeId, childEdgeId]);
      expect(pane?.search.manuallyExpandedEdgeIds).toEqual([]);
      expect(pane?.search.manuallyCollapsedEdgeIds).toEqual([]);

      const runtime = store.getPaneSearchRuntime("outline");
      expect(runtime).not.toBeNull();
      expect(runtime?.matches.has(childEdgeId)).toBe(true);
      expect(runtime?.ancestorEdgeIds.has(rootEdgeId)).toBe(true);
      expect(runtime?.resultEdgeIds).toEqual([rootEdgeId, childEdgeId]);
    } finally {
      store.detach();
    }
  });

  it("cycles search expansion overrides and clears search state", async () => {
    const store = createTestStore();

    try {
      store.attach();
      await store.ready;

      const { outline, localOrigin } = store.sync;
      const parentNodeId = createNode(outline, { text: "Parent", origin: localOrigin });
      const { edgeId: parentEdgeId } = addEdge(outline, {
        parentNodeId: null,
        childNodeId: parentNodeId,
        origin: localOrigin
      });
      addEdge(outline, { parentNodeId, text: "Find me", origin: localOrigin });

      await flushMicrotasks();

      const expression: SearchExpression = {
        type: "predicate",
        field: "text",
        comparator: ":",
        value: { kind: "string", value: "find me" }
      };

      store.runPaneSearch("outline", { query: "text:\"Find me\"", expression });

      const initialPane = getPane(store, "outline");
      expect(initialPane?.search.manuallyExpandedEdgeIds).toHaveLength(0);
      expect(initialPane?.search.manuallyCollapsedEdgeIds).toHaveLength(0);

      store.toggleSearchExpansion("outline", parentEdgeId);

      const expandedPane = getPane(store, "outline");
      expect(expandedPane?.search.manuallyExpandedEdgeIds).toContain(parentEdgeId);
      expect(expandedPane?.search.manuallyCollapsedEdgeIds).not.toContain(parentEdgeId);

      store.toggleSearchExpansion("outline", parentEdgeId);

      const collapsedPane = getPane(store, "outline");
      expect(collapsedPane?.search.manuallyExpandedEdgeIds).not.toContain(parentEdgeId);
      expect(collapsedPane?.search.manuallyCollapsedEdgeIds).toContain(parentEdgeId);

      store.toggleSearchExpansion("outline", parentEdgeId);

      const resetPane = getPane(store, "outline");
      expect(resetPane?.search.manuallyExpandedEdgeIds).not.toContain(parentEdgeId);
      expect(resetPane?.search.manuallyCollapsedEdgeIds).not.toContain(parentEdgeId);

      store.clearPaneSearch("outline");

      const clearedPane = getPane(store, "outline");
      expect(clearedPane?.search.submitted).toBeNull();
      expect(clearedPane?.search.draft).toBe("");
      expect(clearedPane?.search.resultEdgeIds).toHaveLength(0);
      expect(store.getPaneSearchRuntime("outline")).toBeNull();
      // Input visibility stays consistent so UI can decide whether to hide the field.
      expect(clearedPane?.search.isInputVisible).toBe(initialPane?.search.isInputVisible);
    } finally {
      store.detach();
    }
  });
});
