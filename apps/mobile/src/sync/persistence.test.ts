import { describe, expect, it } from "vitest";
import { encodeStateAsUpdate } from "yjs";

import { addEdge, createNode, createOutlineDoc } from "@thortiq/client-core";

import { createReactNativePersistenceFactory, type AsyncStorageLike } from "./persistence";

describe("createReactNativePersistenceFactory", () => {
  const createStorage = () => {
    const store = new Map<string, string>();
    const storage: AsyncStorageLike = {
      async getItem(key) {
        return store.has(key) ? store.get(key)! : null;
      },
      async setItem(key, value) {
        store.set(key, value);
      },
      async removeItem(key) {
        store.delete(key);
      }
    };
    return { storage, store };
  };

  it("hydrates from storage and persists updates", async () => {
    const { storage, store } = createStorage();
    const source = createOutlineDoc();
    const nodeId = createNode(source, { text: "Mobile" });
    addEdge(source, { parentNodeId: null, childNodeId: nodeId });
    const update = encodeStateAsUpdate(source.doc);
    const key = "thortiq:outline:mobile";
    store.set(key, Buffer.from(update).toString("base64"));

    const factory = createReactNativePersistenceFactory(storage);
    const target = createOutlineDoc();
    const adapter = factory({ docId: "mobile", doc: target.doc });

    await adapter.start();
    await adapter.whenReady;

    expect(target.nodes.has(nodeId)).toBe(true);

    const extraNode = createNode(target, { text: "Offline" });
    addEdge(target, { parentNodeId: null, childNodeId: extraNode });

    await adapter.flush?.();

    expect(store.get(key)).toBeDefined();
  });
});
