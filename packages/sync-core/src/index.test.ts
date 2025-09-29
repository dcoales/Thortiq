import "fake-indexeddb/auto";

import { describe, expect, it } from "vitest";

import {
  createSyncContext,
  createEphemeralProvider,
  createNoopPersistence,
  createIndexeddbPersistence
} from "./index";
import {
  createOutlineSnapshot,
  createNode,
  getNodeText,
  setNodeText
} from "@thortiq/client-core";

describe("createSyncContext", () => {
  it("initialises undo manager and awareness against a shared doc", () => {
    const { outline, undoManager, awareness, localOrigin } = createSyncContext();

    expect(outline.doc).toBeDefined();
    expect(outline.doc.gc).toBe(false);
    expect(undoManager).toBeDefined();

    awareness.setLocalStateField("user", { id: "test" });
    expect(awareness.getLocalState()?.user.id).toBe("test");

    const nodeId = createNode(outline);
    setNodeText(outline, nodeId, "hello", localOrigin);

    const stackSize = getUndoStackSize(undoManager);
    expect(stackSize).toBeGreaterThan(0);

    undoManager.undo();
    expect(getNodeText(outline, nodeId)).toBe("");

    undoManager.redo();
    expect(getNodeText(outline, nodeId)).toBe("hello");

    setNodeText(outline, nodeId, "remote", Symbol("remote"));
    const afterRemote = getUndoStackSize(undoManager);
    expect(afterRemote).toBe(stackSize);

    undoManager.undo();
    expect(getNodeText(outline, nodeId)).toBe("remote");
  });

  it("allows callers to verify tracked origins", () => {
    const { isTrackedOrigin, localOrigin } = createSyncContext();

    expect(isTrackedOrigin(localOrigin)).toBe(true);
    expect(isTrackedOrigin(Symbol("other"))).toBe(false);
  });

  it("creates snapshots without mutating live Yjs structures", () => {
    const { outline, localOrigin } = createSyncContext();
    const nodeId = createNode(outline, { origin: localOrigin });
    setNodeText(outline, nodeId, "snap", localOrigin);

    const snapshot = createOutlineSnapshot(outline);
    expect(snapshot.nodes.get(nodeId)?.text).toBe("snap");
  });
});

const getUndoStackSize = (manager: unknown): number => {
  return ((manager as { undoStack: unknown[] }).undoStack ?? []).length;
};

describe("createEphemeralProvider", () => {
  it("emits status transitions on connect/disconnect", async () => {
    const provider = createEphemeralProvider();
    const states: string[] = [];

    const unsubscribe = provider.onStatusChange((status) => states.push(status));

    await provider.connect();
    await provider.disconnect();

    unsubscribe();

    expect(states).toEqual(["connecting", "connected", "disconnected"]);
    expect(provider.status).toBe("disconnected");
  });
});

describe("createNoopPersistence", () => {
  it("exposes start/destroy hooks without side effects", async () => {
    const persistence = createNoopPersistence();

    await expect(persistence.start()).resolves.toBeUndefined();
    await expect(persistence.whenReady).resolves.toBeUndefined();
    await expect(persistence.destroy()).resolves.toBeUndefined();
  });
});

describe("createIndexeddbPersistence", () => {
  it("persists Yjs state to IndexedDB and hydrates new sessions", async () => {
    const databaseName = `thortiq-test-${Math.random().toString(36).slice(2)}`;

    const first = createSyncContext();
    const persistenceA = createIndexeddbPersistence(first.doc, { databaseName });
    await persistenceA.start();

    const nodeId = createNode(first.outline, { origin: first.localOrigin });
    setNodeText(first.outline, nodeId, "offline snapshot", first.localOrigin);
    await flushMicrotasks();
    await persistenceA.destroy();

    const second = createSyncContext();
    const persistenceB = createIndexeddbPersistence(second.doc, { databaseName });
    await persistenceB.start();
    const snapshot = createOutlineSnapshot(second.outline);

    expect(Array.from(snapshot.nodes.values()).some((node) => node.text === "offline snapshot")).toBe(true);

    await persistenceB.destroy();
    await deleteIndexedDb(databaseName);
  });
});

const flushMicrotasks = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

const deleteIndexedDb = async (name: string): Promise<void> => {
  const factory = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
  if (!factory) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const request = factory.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("Failed to delete IndexedDB"));
  });
};
