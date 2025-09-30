import { describe, expect, it, vi } from "vitest";
import { Awareness, encodeAwarenessUpdate } from "y-protocols/awareness";
import { encodeStateAsUpdate, Doc } from "yjs";

import { addEdge, createNode, createOutlineDoc } from "../doc";
import {
  createSyncManager,
  type SyncAwarenessState,
  type SyncManager,
  type SyncManagerEvent,
  type SyncPersistenceAdapter,
  type SyncProviderAdapter,
  type SyncProviderError,
  type SyncProviderStatus,
  type SyncManagerOptions
} from "./SyncManager";
import { createEphemeralPersistenceFactory } from "./persistence";

const createMockPersistenceFactory = () => {
  const startMock = vi.fn(async () => {});
  const destroyMock = vi.fn(async () => {});
  const factory: SyncManagerOptions["persistenceFactory"] = () => {
    const adapter: SyncPersistenceAdapter = {
      start: startMock,
      whenReady: Promise.resolve(),
      destroy: destroyMock
    };
    return adapter;
  };
  return { factory, startMock, destroyMock } as const;
};

type UpdateListener = (update: Uint8Array) => void;
type AwarenessListener = (payload: Uint8Array) => void;
type StatusListener = (status: SyncProviderStatus) => void;
type ErrorListener = (error: SyncProviderError) => void;

class TestProvider implements SyncProviderAdapter {
  public status: SyncProviderStatus = "disconnected";
  public readonly sentUpdates: Uint8Array[] = [];
  public readonly awarenessPayloads: Uint8Array[] = [];
  public connectCalls = 0;
  public disconnectCalls = 0;
  public destroyCalls = 0;

  private readonly updateListeners = new Set<UpdateListener>();
  private readonly awarenessListeners = new Set<AwarenessListener>();
  private readonly statusListeners = new Set<StatusListener>();
  private readonly errorListeners = new Set<ErrorListener>();

  async connect(): Promise<void> {
    this.connectCalls += 1;
    this.setStatus("connecting");
    await Promise.resolve();
    this.setStatus("connected");
  }

  async disconnect(): Promise<void> {
    this.disconnectCalls += 1;
    this.setStatus("disconnected");
  }

  async destroy(): Promise<void> {
    this.destroyCalls += 1;
    this.setStatus("disconnected");
  }

  sendUpdate(update: Uint8Array): void {
    this.sentUpdates.push(update);
  }

  broadcastAwareness(payload: Uint8Array): void {
    this.awarenessPayloads.push(payload);
  }

  onUpdate(listener: UpdateListener): () => void {
    this.updateListeners.add(listener);
    return () => this.updateListeners.delete(listener);
  }

  onAwareness(listener: AwarenessListener): () => void {
    this.awarenessListeners.add(listener);
    return () => this.awarenessListeners.delete(listener);
  }

  onStatusChange(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  onError(listener: ErrorListener): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  emitUpdate(update: Uint8Array): void {
    this.updateListeners.forEach((listener) => listener(update));
  }

  emitAwareness(payload: Uint8Array): void {
    this.awarenessListeners.forEach((listener) => listener(payload));
  }

  emitError(error: SyncProviderError): void {
    this.errorListeners.forEach((listener) => listener(error));
  }

  forceStatus(status: SyncProviderStatus): void {
    this.setStatus(status);
  }

  protected setStatus(next: SyncProviderStatus): void {
    this.status = next;
    this.statusListeners.forEach((listener) => listener(next));
  }
}

describe("createSyncManager", () => {
  it("supports the ephemeral persistence factory", async () => {
    const provider = new TestProvider();
    const manager = createSyncManager({
      docId: "ephemeral",
      persistenceFactory: createEphemeralPersistenceFactory(),
      providerFactory: () => provider
    });

    await manager.connect();
    expect(provider.status).toBe("connected");
    await manager.destroy();
  });

  it("connects the provider and forwards local updates", async () => {
    const persistence = createMockPersistenceFactory();
    const provider = new TestProvider();
    const manager = createSyncManager({
      docId: "test",
      persistenceFactory: persistence.factory,
      providerFactory: () => provider
    });

    await manager.connect();

    expect(persistence.startMock).toHaveBeenCalledTimes(1);
    expect(provider.status).toBe("connected");
    expect(manager.status).toBe("connected");

    const updatesBefore = provider.sentUpdates.length;
    const nodeId = createNode(manager.outline, { origin: manager.localOrigin, text: "Local" });
    addEdge(manager.outline, { parentNodeId: null, childNodeId: nodeId, origin: manager.localOrigin });

    expect(provider.sentUpdates.length).toBeGreaterThan(updatesBefore);
  });

  it("resolves connect even when the provider never reaches connected", async () => {
    const persistence = createMockPersistenceFactory();
    class NeverConnectingProvider extends TestProvider {
      override async connect(): Promise<void> {
        this.connectCalls += 1;
        // Leave the provider in a perpetual connecting state to mimic a stalled socket.
        this.setStatus("connecting");
      }
    }
    const provider = new NeverConnectingProvider();
    const manager = createSyncManager({
      docId: "never-connected",
      persistenceFactory: persistence.factory,
      providerFactory: () => provider
    });

    await expect(manager.connect()).resolves.toBeUndefined();
    expect(provider.connectCalls).toBe(1);
    expect(manager.status).toBe("connecting");

    await manager.destroy();
  });

  it("applies remote updates from the provider", async () => {
    const persistence = createMockPersistenceFactory();
    const provider = new TestProvider();
    const manager = createSyncManager({
      docId: "remote-test",
      persistenceFactory: persistence.factory,
      providerFactory: () => provider
    });

    await manager.connect();

    const remote = createOutlineDoc();
    const remoteNodeId = createNode(remote, { text: "Remote" });
    addEdge(remote, { parentNodeId: null, childNodeId: remoteNodeId });

    const update = encodeStateAsUpdate(remote.doc);
    provider.emitUpdate(update);

    expect(manager.outline.nodes.has(remoteNodeId)).toBe(true);
  });

  it("broadcasts awareness changes to the provider", async () => {
    const persistence = createMockPersistenceFactory();
    const provider = new TestProvider();
    const defaults: SyncAwarenessState = {
      userId: "local",
      displayName: "Local User",
      color: "#111827",
      focusEdgeId: null
    };
    const manager = createSyncManager({
      docId: "awareness-test",
      persistenceFactory: persistence.factory,
      providerFactory: () => provider,
      awarenessDefaults: defaults
    });

    await manager.connect();

    const broadcastsBefore = provider.awarenessPayloads.length;
    manager.updateAwareness({ focusEdgeId: "edge-1" });

    expect(provider.awarenessPayloads.length).toBeGreaterThan(broadcastsBefore);
  });

  it("applies remote awareness payloads", async () => {
    const persistence = createMockPersistenceFactory();
    const provider = new TestProvider();
    const manager = createSyncManager({
      docId: "awareness-remote",
      persistenceFactory: persistence.factory,
      providerFactory: () => provider
    });

    await manager.connect();

    const remoteDoc = new Doc();
    const remoteAwareness = new Awareness(remoteDoc);
    remoteAwareness.setLocalState({
      userId: "remote",
      displayName: "Remote User",
      color: "#10b981",
      focusEdgeId: null
    });
    const payload = encodeAwarenessUpdate(remoteAwareness, [remoteAwareness.clientID]);

    provider.emitAwareness(payload);

    expect(manager.awareness.getStates().size).toBeGreaterThan(1);
  });

  it("notifies registered event listeners", async () => {
    const persistence = createMockPersistenceFactory();
    const provider = new TestProvider();
    const manager = createSyncManager({
      docId: "events",
      persistenceFactory: persistence.factory,
      providerFactory: () => provider
    });

    await manager.connect();

    const captured: SyncManagerEvent[] = [];
    const unsubscribe = manager.onEvent((event) => {
      captured.push(event);
    });

    const beforeUpdateSent = captured.filter((event) => event.type === "update-sent").length;
    const nodeId = createNode(manager.outline, { origin: manager.localOrigin, text: "Event" });
    addEdge(manager.outline, { parentNodeId: null, childNodeId: nodeId, origin: manager.localOrigin });

    await Promise.resolve();

    const afterUpdateSent = captured.filter((event) => event.type === "update-sent").length;
    expect(afterUpdateSent).toBeGreaterThanOrEqual(beforeUpdateSent + 1);

    unsubscribe();
  });

  it("emits reconnect events and retries after recoverable errors", async () => {
    vi.useFakeTimers();
    const persistence = createMockPersistenceFactory();
    const provider = new TestProvider();
    const events: SyncManagerEvent[] = [];
    const manager = createSyncManager({
      docId: "reconnect",
      persistenceFactory: persistence.factory,
      providerFactory: () => provider,
      reconnectOptions: { initialDelayMs: 20, maxDelayMs: 20, jitter: 0 }
    });
    manager.onEvent((event) => events.push(event));

    try {
      await manager.connect();
      expect(provider.connectCalls).toBe(1);

      provider.emitError({ code: "socket", message: "recoverable", recoverable: true });
      provider.forceStatus("disconnected");

      expect(events.some((event) => event.type === "reconnect-scheduled")).toBe(true);

      await vi.runOnlyPendingTimersAsync();
      await Promise.resolve();

      expect(events.some((event) => event.type === "reconnect-attempt")).toBe(true);
      expect(provider.connectCalls).toBeGreaterThanOrEqual(2);
    } finally {
      await manager.destroy();
      vi.useRealTimers();
    }
  });

  it("pauses reconnect attempts while offline and resumes when online", async () => {
    vi.useFakeTimers();
    const persistence = createMockPersistenceFactory();
    const provider = new TestProvider();
    const listeners: Record<string, Array<(event?: unknown) => void>> = {};
    const originalNavigator = (globalThis as { navigator?: unknown }).navigator;
    type GlobalListenerFn = (type: string, listener: (event?: unknown) => void) => void;
    const originalAddEventListener = (globalThis as { addEventListener?: GlobalListenerFn }).addEventListener;
    const originalRemoveEventListener = (globalThis as { removeEventListener?: GlobalListenerFn }).removeEventListener;

    const fakeNavigator = { onLine: true } as { onLine: boolean };
    (globalThis as { navigator: { onLine: boolean } }).navigator = fakeNavigator;
    (globalThis as { addEventListener: GlobalListenerFn }).addEventListener = (type: string, listener: (event?: unknown) => void) => {
      (listeners[type] ??= []).push(listener);
    };
    (globalThis as { removeEventListener: GlobalListenerFn }).removeEventListener = (type: string, listener: (event?: unknown) => void) => {
      const bucket = listeners[type];
      if (!bucket) {
        return;
      }
      const index = bucket.indexOf(listener);
      if (index >= 0) {
        bucket.splice(index, 1);
      }
    };

    const events: SyncManagerEvent[] = [];
    let manager: SyncManager | null = null;

    try {
      manager = createSyncManager({
        docId: "network",
        persistenceFactory: persistence.factory,
        providerFactory: () => provider,
        reconnectOptions: { initialDelayMs: 20, maxDelayMs: 20, jitter: 0 }
      });
      manager.onEvent((event) => events.push(event));

      await manager.connect();
      expect(provider.connectCalls).toBe(1);

      fakeNavigator.onLine = false;
      listeners.offline?.forEach((listener) => listener());

      expect(events.some((event) => event.type === "network-offline")).toBe(true);
      expect(manager.status).toBe("offline");
      provider.forceStatus("disconnected");

      fakeNavigator.onLine = true;
      listeners.online?.forEach((listener) => listener());

      await Promise.resolve();
      expect(events.some((event) => event.type === "network-online")).toBe(true);
      expect(provider.connectCalls).toBeGreaterThanOrEqual(2);
    } finally {
      if (manager) {
        await manager.destroy();
      }
      if (originalNavigator === undefined) {
        delete (globalThis as { navigator?: unknown }).navigator;
      } else {
        (globalThis as { navigator?: unknown }).navigator = originalNavigator;
      }
      if (originalAddEventListener) {
        (globalThis as { addEventListener?: GlobalListenerFn }).addEventListener = originalAddEventListener;
      } else {
        delete (globalThis as { addEventListener?: GlobalListenerFn }).addEventListener;
      }
      if (originalRemoveEventListener) {
        (globalThis as { removeEventListener?: GlobalListenerFn }).removeEventListener = originalRemoveEventListener;
      } else {
        delete (globalThis as { removeEventListener?: GlobalListenerFn }).removeEventListener;
      }
      vi.useRealTimers();
    }
  });

  it("cleans up provider and persistence on destroy", async () => {
    const persistence = createMockPersistenceFactory();
    const provider = new TestProvider();
    const manager = createSyncManager({
      docId: "teardown",
      persistenceFactory: persistence.factory,
      providerFactory: () => provider
    });

    await manager.connect();
    await manager.destroy();

    expect(provider.destroyCalls).toBeGreaterThanOrEqual(1);
    expect(persistence.destroyMock).toHaveBeenCalledTimes(1);
    expect(manager.status).toBe("offline");
  });
});
