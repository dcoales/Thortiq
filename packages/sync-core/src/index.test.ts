import { describe, expect, it } from "vitest";

import {
  createSyncContext,
  createEphemeralProvider,
  createNoopPersistence
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
    await expect(persistence.destroy()).resolves.toBeUndefined();
  });
});
