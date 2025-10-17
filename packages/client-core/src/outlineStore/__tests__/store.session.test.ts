import { beforeEach, describe, expect, it, vi } from "vitest";

import { createOutlineStore } from "../store";
import { createEphemeralPersistenceFactory } from "../../sync/persistence";
import { createEphemeralProviderFactory } from "../../sync/ephemeralProvider";
import { createNode, addEdge } from "../../doc";
import { createMemorySessionStorageAdapter, defaultSessionState } from "@thortiq/sync-core";
import type { SessionState } from "@thortiq/sync-core";
import * as ids from "../../ids";

describe("outline store session bootstrap", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("retains pane focus from persisted session state until the outline snapshot is ready", async () => {
    const focusEdgeId = "test-focus-edge";
    const focusNodeId = "test-focus-node";

    const baseState = defaultSessionState();
    const paneId = baseState.activePaneId;
    const focusPane = {
      ...baseState.panesById[paneId],
      activeEdgeId: focusEdgeId,
      rootEdgeId: focusEdgeId,
      focusPathEdgeIds: [focusEdgeId],
      focusHistory: [
        {
          rootEdgeId: focusEdgeId,
          focusPathEdgeIds: [focusEdgeId]
        }
      ],
      focusHistoryIndex: 0
    };
    const persistedState: SessionState = {
      ...baseState,
      selectedEdgeId: focusEdgeId,
      panesById: {
        ...baseState.panesById,
        [paneId]: focusPane
      }
    };

    const adapter = createMemorySessionStorageAdapter(JSON.stringify(persistedState));
    const edgeIdStub = vi.spyOn(ids, "createEdgeId").mockImplementation(() => focusEdgeId);

    const store = createOutlineStore({
      persistenceFactory: createEphemeralPersistenceFactory(),
      providerFactory: createEphemeralProviderFactory(),
      sessionAdapter: adapter,
      autoConnect: false,
      skipDefaultSeed: true,
      seedOutline: (sync) => {
        const { outline, localOrigin } = sync;
        createNode(outline, {
          id: focusNodeId,
          text: "Focus",
          origin: localOrigin
        });
        addEdge(outline, {
          parentNodeId: null,
          childNodeId: focusNodeId,
          origin: localOrigin
        });
      }
    });

    try {
      const initialState = store.session.getState();
      expect(initialState.selectedEdgeId).toBe(focusEdgeId);
      expect(initialState.panesById[paneId]?.activeEdgeId).toBe(focusEdgeId);

      store.attach();
      await store.ready;

      const hydratedState = store.session.getState();
      expect(hydratedState.selectedEdgeId).toBe(focusEdgeId);
      expect(hydratedState.panesById[paneId]?.activeEdgeId).toBe(focusEdgeId);
    } finally {
      store.detach();
      edgeIdStub.mockRestore();
    }
  });
});
