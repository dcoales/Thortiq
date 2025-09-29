import { describe, expect, it } from "vitest";
import * as encoding from "lib0/encoding";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as Y from "yjs";

import { InMemorySnapshotStorage } from "./storage/inMemory";
import { DocManager } from "./docManager";

describe("DocManager", () => {
  it("applies sync messages and persists snapshots", async () => {
    const storage = new InMemorySnapshotStorage();
    const manager = new DocManager(storage, 10);
    const managed = await manager.ensureDoc("doc-1");

    const remoteDoc = new Y.Doc();
    remoteDoc.getText("content").insert(0, "Persisted");
    const update = Y.encodeStateAsUpdate(remoteDoc);

    const encoder = encoding.createEncoder();
    syncProtocol.writeUpdate(encoder, update);

    const reply = manager.applySyncMessage(managed.doc, encoding.toUint8Array(encoder), "test");
    expect(reply).toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 20));
    const snapshot = await storage.loadSnapshot("doc-1");
    expect(snapshot).not.toBeNull();
    expect((snapshot as Uint8Array).byteLength).toBeGreaterThan(0);
  });

  it("broadcasts awareness updates", async () => {
    const storage = new InMemorySnapshotStorage();
    const manager = new DocManager(storage, 10);
    const managed = await manager.ensureDoc("doc-2");

    let received = false;
    manager.subscribeAwareness("doc-2", () => {
      received = true;
    });

    managed.awareness.setLocalState({ userId: "local" });
    const payload = awarenessProtocol.encodeAwarenessUpdate(managed.awareness, [managed.awareness.clientID]);
    manager.applyAwarenessUpdate(managed, payload, "client");
    expect(received).toBe(true);
  });
});
