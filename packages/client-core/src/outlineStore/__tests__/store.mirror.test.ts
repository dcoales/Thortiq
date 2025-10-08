import { describe, expect, it } from "vitest";

import { createOutlineStore } from "../store";
import { createEphemeralPersistenceFactory } from "../../sync/persistence";
import { createEphemeralProviderFactory } from "../../sync/ephemeralProvider";
import { createNode, addEdge } from "../../doc";
import { createMirrorEdge } from "../../mirror";
import { createMemorySessionStorageAdapter } from "@thortiq/sync-core";

describe("outline store mirror integration", () => {
  it("updates the snapshot immediately when converting an edge into a mirror", async () => {
    const store = createOutlineStore({
      persistenceFactory: createEphemeralPersistenceFactory(),
      providerFactory: createEphemeralProviderFactory(),
      sessionAdapter: createMemorySessionStorageAdapter(),
      autoConnect: false,
      skipDefaultSeed: true
    });

    try {
      store.attach();
      await store.ready;

      const { outline, localOrigin } = store.sync;

      const sourceNodeId = createNode(outline, {
        text: "Source node",
        origin: localOrigin
      });
      const { edgeId: sourceEdgeId } = addEdge(outline, {
        parentNodeId: null,
        childNodeId: sourceNodeId,
        origin: localOrigin
      });
      expect(sourceEdgeId).toBeDefined();

      const targetNodeId = createNode(outline, {
        text: "",
        origin: localOrigin
      });
      const { edgeId: targetEdgeId } = addEdge(outline, {
        parentNodeId: null,
        childNodeId: targetNodeId,
        origin: localOrigin
      });

      const snapshotBefore = store.getSnapshot();
      expect(snapshotBefore.edges.get(targetEdgeId)?.mirrorOfNodeId).toBeNull();
      expect(snapshotBefore.nodes.has(targetNodeId)).toBe(true);

      const result = createMirrorEdge({
        outline,
        targetEdgeId,
        mirrorNodeId: sourceNodeId,
        origin: localOrigin
      });
      expect(result).not.toBeNull();

      await new Promise((resolve) => setTimeout(resolve, 0));

      const snapshotAfter = store.getSnapshot();
      const updatedEdge = snapshotAfter.edges.get(targetEdgeId);
      expect(updatedEdge?.mirrorOfNodeId).toBe(sourceNodeId);
      expect(updatedEdge?.childNodeId).toBe(sourceNodeId);
      expect(snapshotAfter.nodes.has(targetNodeId)).toBe(false);
    } finally {
      store.detach();
    }
  });
});
