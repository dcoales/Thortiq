/**
 * Shared sync contracts describing how platforms wire persistence and transport around the
 * collaborative outline document. Implementations live in higher-level packages while this module
 * keeps the types reusable and aligned with AGENTS.md invariants (single Y.Doc, unified undo,
 * transaction-only mutations).
 */
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate
} from "y-protocols/awareness";
import {
  applyUpdate,
  encodeStateAsUpdate,
  UndoManager,
  type Doc
} from "yjs";

import { createOutlineDoc } from "../doc";
import type { OutlineDoc } from "../types";

type Listener<T> = (value: T) => void;

type ListenerSet<T> = Set<Listener<T>>;

const DEFAULT_LOCAL_ORIGIN_LABEL = "thortiq-sync-local";
const PROVIDER_ORIGIN_LABEL = "thortiq-sync-provider";

const DEFAULT_RECONNECT_INITIAL_DELAY_MS = 1_000;
const DEFAULT_RECONNECT_MAX_DELAY_MS = 30_000;
const DEFAULT_RECONNECT_MULTIPLIER = 2;
const DEFAULT_RECONNECT_JITTER = 0.25;

type TimeoutHandle = ReturnType<typeof setTimeout> | null;

export type SyncManagerStatus = "offline" | "connecting" | "connected" | "recovering";

export type SyncProviderStatus = "disconnected" | "connecting" | "connected";

export interface SyncProviderError {
  readonly code: string;
  readonly message: string;
  readonly recoverable: boolean;
  readonly cause?: unknown;
}

export interface SyncProviderAdapter {
  readonly status: SyncProviderStatus;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  destroy(): Promise<void>;
  sendUpdate(update: Uint8Array): void;
  broadcastAwareness(payload: Uint8Array): void;
  onUpdate(listener: (update: Uint8Array) => void): () => void;
  onAwareness(listener: (payload: Uint8Array) => void): () => void;
  onStatusChange(listener: (status: SyncProviderStatus) => void): () => void;
  onError(listener: (error: SyncProviderError) => void): () => void;
}

export interface SyncPersistenceAdapter {
  start(): Promise<void>;
  readonly whenReady: Promise<void>;
  flush?(): Promise<void>;
  destroy(): Promise<void>;
}

export interface SyncManagerEventBase {
  readonly timestamp: number;
}

export type SyncManagerEvent =
  | (SyncManagerEventBase & { readonly type: "snapshot-applied"; readonly bytes: number })
  | (SyncManagerEventBase & { readonly type: "update-sent"; readonly bytes: number })
  | (SyncManagerEventBase & { readonly type: "update-received"; readonly bytes: number })
  | (SyncManagerEventBase & { readonly type: "throttled"; readonly retryAt: number })
  | (SyncManagerEventBase & { readonly type: "awareness-update" })
  | (SyncManagerEventBase & {
      readonly type: "reconnect-scheduled";
      readonly attempt: number;
      readonly delayMs: number;
      readonly reason: "error" | "disconnect" | "network";
    })
  | (SyncManagerEventBase & { readonly type: "reconnect-attempt"; readonly attempt: number })
  | (SyncManagerEventBase & { readonly type: "reconnect-cancelled" })
  | (SyncManagerEventBase & { readonly type: "network-offline" })
  | (SyncManagerEventBase & { readonly type: "network-online" });

export interface SyncReconnectOptions {
  readonly initialDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly multiplier?: number;
  readonly jitter?: number;
}

export interface SyncPresenceSelection {
  readonly anchorEdgeId: string | null;
  readonly headEdgeId: string | null;
}

export interface SyncAwarenessState {
  readonly userId: string;
  readonly displayName: string;
  readonly color: string;
  readonly focusEdgeId: string | null;
  readonly selection?: SyncPresenceSelection;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface SyncManagerObservers {
  readonly onStatusChange?: (status: SyncManagerStatus) => void;
  readonly onEvent?: (event: SyncManagerEvent) => void;
  readonly onError?: (error: SyncProviderError) => void;
}

export interface SyncPersistenceContext {
  readonly docId: string;
  readonly doc: Doc;
}

export interface SyncManagerOptions extends SyncManagerObservers {
  readonly docId: string;
  readonly persistenceFactory: (context: SyncPersistenceContext) => SyncPersistenceAdapter;
  readonly providerFactory: (context: SyncProviderContext) => SyncProviderAdapter;
  readonly localOrigin?: symbol;
  readonly trackedOrigins?: Iterable<unknown>;
  readonly awarenessDefaults?: SyncAwarenessState;
  readonly reconnectOptions?: SyncReconnectOptions;
  readonly enableNetworkMonitoring?: boolean;
}

export interface SyncProviderContext {
  readonly docId: string;
  readonly doc: Doc;
  readonly awareness: Awareness;
}

export interface SyncManager {
  readonly outline: OutlineDoc;
  readonly doc: Doc;
  readonly awareness: Awareness;
  readonly undoManager: UndoManager;
  readonly localOrigin: symbol;
  readonly status: SyncManagerStatus;
  readonly ready: Promise<void>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  destroy(): Promise<void>;
  updateAwareness(state: Partial<SyncAwarenessState>): void;
  onStatusChange(listener: (status: SyncManagerStatus) => void): () => void;
  onEvent(listener: (event: SyncManagerEvent) => void): () => void;
  onError(listener: (error: SyncProviderError) => void): () => void;
}

const notify = <T>(listeners: ListenerSet<T>, value: T): void => {
  listeners.forEach((listener) => {
    try {
      listener(value);
    } catch (error) {
      if (typeof console !== "undefined" && typeof console.error === "function") {
        console.error("[sync-manager] listener error", error);
      }
    }
  });
};

const createSyncError = (
  code: string,
  cause: unknown,
  recoverable: boolean,
  fallbackMessage?: string
): SyncProviderError => ({
  code,
  recoverable,
  cause,
  message: fallbackMessage ?? (cause instanceof Error ? cause.message : String(cause))
});

export const createSyncManager = (options: SyncManagerOptions): SyncManager => {
  const outline = createOutlineDoc();
  const doc = outline.doc;
  doc.gc = false;

  const providerOrigin = Symbol(PROVIDER_ORIGIN_LABEL);
  const localOrigin = options.localOrigin ?? Symbol(`${DEFAULT_LOCAL_ORIGIN_LABEL}:${options.docId}`);
  const trackedOrigins = new Set<unknown>(options.trackedOrigins ?? []);
  trackedOrigins.add(localOrigin);

  const awareness = new Awareness(doc);
  if (options.awarenessDefaults) {
    awareness.setLocalState({ ...options.awarenessDefaults });
  } else if (!awareness.getLocalState()) {
    awareness.setLocalState({ focusEdgeId: null, userId: "local", displayName: "Local", color: "#4f46e5" });
  }

  const undoTargets = [outline.nodes, outline.edges, outline.rootEdges, outline.childEdgeMap];
  const undoManager = new UndoManager(undoTargets, { trackedOrigins });

  const persistence = options.persistenceFactory({ docId: options.docId, doc });

  const reconnectOptions = {
    initialDelayMs: options.reconnectOptions?.initialDelayMs ?? DEFAULT_RECONNECT_INITIAL_DELAY_MS,
    maxDelayMs: options.reconnectOptions?.maxDelayMs ?? DEFAULT_RECONNECT_MAX_DELAY_MS,
    multiplier: options.reconnectOptions?.multiplier ?? DEFAULT_RECONNECT_MULTIPLIER,
    jitter: options.reconnectOptions?.jitter ?? DEFAULT_RECONNECT_JITTER
  } as const;
  const enableNetworkMonitoring = options.enableNetworkMonitoring !== false;

  let currentStatus: SyncManagerStatus = "offline";
  let destroyed = false;
  let provider: SyncProviderAdapter | null = null;
  const providerListeners: Array<() => void> = [];
  let reconnectAttempts = 0;
  let reconnectTimer: TimeoutHandle = null;
  let manualDisconnect = false;
  let networkOffline = false;
  const teardownCallbacks: Array<() => void> = [];

  const statusListeners: ListenerSet<SyncManagerStatus> = new Set();
  const eventListeners: ListenerSet<SyncManagerEvent> = new Set();
  const errorListeners: ListenerSet<SyncProviderError> = new Set();

  const transitionStatus = (next: SyncManagerStatus) => {
    if (currentStatus === next) {
      return;
    }
    currentStatus = next;
    options.onStatusChange?.(next);
    notify(statusListeners, next);
  };

  const emitEvent = (event: SyncManagerEvent): void => {
    options.onEvent?.(event);
    notify(eventListeners, event);
  };

  const emitError = (error: SyncProviderError): void => {
    options.onError?.(error);
    notify(errorListeners, error);
  };

  const computeReconnectDelay = (attempt: number): number => {
    const baseDelay = reconnectOptions.initialDelayMs * reconnectOptions.multiplier ** Math.max(0, attempt - 1);
    const cappedDelay = Math.min(reconnectOptions.maxDelayMs, baseDelay);
    const jitterRange = Math.max(0, reconnectOptions.jitter) * cappedDelay;
    const jitter = jitterRange > 0 ? (Math.random() * jitterRange * 2 - jitterRange) : 0;
    const delay = Math.round(cappedDelay + jitter);
    return Math.max(reconnectOptions.initialDelayMs, delay);
  };

  const cancelReconnectTimer = (emitEventOnCancel: boolean): void => {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
      if (emitEventOnCancel) {
        emitEvent({ type: "reconnect-cancelled", timestamp: Date.now() });
      }
    }
  };

  const scheduleReconnect = (reason: "error" | "disconnect" | "network"): void => {
    if (destroyed || manualDisconnect) {
      return;
    }
    if (networkOffline && reason !== "network") {
      return;
    }
    if (reconnectTimer !== null) {
      return;
    }
    const attempt = reconnectAttempts + 1;
    reconnectAttempts = attempt;
    const delayMs = computeReconnectDelay(attempt);
    emitEvent({ type: "reconnect-scheduled", attempt, delayMs, reason, timestamp: Date.now() });
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (destroyed || manualDisconnect) {
        return;
      }
      emitEvent({ type: "reconnect-attempt", attempt, timestamp: Date.now() });
      void connectInternal(true).catch(() => {
        scheduleReconnect("error");
      });
    }, delayMs);
  };

  const handleNetworkStatusChange = (offline: boolean): void => {
    if (networkOffline === offline) {
      return;
    }
    networkOffline = offline;
    if (offline) {
      emitEvent({ type: "network-offline", timestamp: Date.now() });
      if (!manualDisconnect) {
        transitionStatus("offline");
        cancelReconnectTimer(true);
      }
      return;
    }
    emitEvent({ type: "network-online", timestamp: Date.now() });
    if (manualDisconnect) {
      return;
    }
    reconnectAttempts = 0;
    if (currentStatus !== "connected") {
      void connectInternal(true).catch(() => {
        scheduleReconnect("error");
      });
    }
  };

  if (enableNetworkMonitoring) {
    const globalNavigator = (globalThis as { navigator?: { onLine?: boolean } }).navigator;
    if (globalNavigator?.onLine === false) {
      handleNetworkStatusChange(true);
    }
    type GlobalEventListener = (event?: unknown) => void;
    const globalWithEvents = globalThis as unknown as {
      addEventListener?: (type: string, listener: GlobalEventListener) => void;
      removeEventListener?: (type: string, listener: GlobalEventListener) => void;
    };
    const onlineListener: GlobalEventListener = () => handleNetworkStatusChange(false);
    const offlineListener: GlobalEventListener = () => handleNetworkStatusChange(true);
    if (typeof globalWithEvents.addEventListener === "function" && typeof globalWithEvents.removeEventListener === "function") {
      globalWithEvents.addEventListener("online", onlineListener);
      globalWithEvents.addEventListener("offline", offlineListener);
      teardownCallbacks.push(() => {
        globalWithEvents.removeEventListener?.("online", onlineListener);
        globalWithEvents.removeEventListener?.("offline", offlineListener);
      });
    }
  }

  const handleDocUpdate = (update: Uint8Array, origin: unknown): void => {
    if (destroyed) {
      return;
    }
    if (origin === providerOrigin) {
      return;
    }
    if (!provider || provider.status !== "connected") {
      return;
    }
    try {
      provider.sendUpdate(update);
      emitEvent({ type: "update-sent", timestamp: Date.now(), bytes: update.length });
    } catch (error) {
      emitError(createSyncError("provider-send-failed", error, false));
    }
  };

  const handleAwarenessUpdate = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown
  ): void => {
    if (destroyed || origin === providerOrigin) {
      return;
    }
    if (!provider || provider.status !== "connected") {
      return;
    }
    const changed = [...added, ...updated, ...removed];
    if (changed.length === 0) {
      return;
    }
    const payload = encodeAwarenessUpdate(awareness, changed);
    if (payload.byteLength === 0) {
      return;
    }
    try {
      provider.broadcastAwareness(payload);
      emitEvent({ type: "awareness-update", timestamp: Date.now() });
    } catch (error) {
      emitError(createSyncError("provider-awareness-send-failed", error, true));
    }
  };

  doc.on("update", handleDocUpdate);
  awareness.on("update", handleAwarenessUpdate);

  const sendInitialSync = (): void => {
    if (!provider || provider.status !== "connected") {
      return;
    }
    const snapshot = encodeStateAsUpdate(doc);
    if (snapshot.byteLength > 0) {
      try {
        provider.sendUpdate(snapshot);
        emitEvent({ type: "update-sent", timestamp: Date.now(), bytes: snapshot.length });
      } catch (error) {
        emitError(createSyncError("provider-send-failed", error, false));
      }
    }
    const localState = awareness.getLocalState();
    if (localState) {
      const payload = encodeAwarenessUpdate(awareness, [awareness.clientID]);
      if (payload.byteLength > 0) {
        try {
          provider.broadcastAwareness(payload);
          emitEvent({ type: "awareness-update", timestamp: Date.now() });
        } catch (error) {
          emitError(createSyncError("provider-awareness-send-failed", error, true));
        }
      }
    }
  };

  const detachProviderListeners = (): void => {
    while (providerListeners.length) {
      const teardown = providerListeners.pop();
      try {
        teardown?.();
      } catch (error) {
        if (typeof console !== "undefined" && typeof console.error === "function") {
          console.error("[sync-manager] provider listener cleanup failed", error);
        }
      }
    }
  };

  const attachProvider = (): void => {
    if (!provider) {
      return;
    }
    detachProviderListeners();
    providerListeners.push(
      provider.onUpdate((update) => {
        applyUpdate(doc, update, providerOrigin);
        emitEvent({ type: "update-received", timestamp: Date.now(), bytes: update.length });
      }),
      provider.onAwareness((payload) => {
        applyAwarenessUpdate(awareness, payload, providerOrigin);
        emitEvent({ type: "awareness-update", timestamp: Date.now() });
      }),
      provider.onStatusChange((status) => {
        if (destroyed) {
          return;
        }
        if (status === "connecting") {
          transitionStatus("connecting");
          return;
        }
        if (status === "connected") {
          manualDisconnect = false;
          reconnectAttempts = 0;
          cancelReconnectTimer(true);
          transitionStatus("connected");
          sendInitialSync();
          return;
        }
        if (status === "disconnected") {
          transitionStatus("offline");
          if (manualDisconnect) {
            cancelReconnectTimer(true);
          } else {
            scheduleReconnect("disconnect");
          }
        }
      }),
      provider.onError((error) => {
        emitError(error);
        if (error.recoverable) {
          transitionStatus("recovering");
          scheduleReconnect("error");
        } else {
          transitionStatus("offline");
          cancelReconnectTimer(true);
        }
      })
    );
  };

  const ensureProvider = (): SyncProviderAdapter => {
    if (provider) {
      return provider;
    }
    try {
      provider = options.providerFactory({ docId: options.docId, doc, awareness });
    } catch (error) {
      const syncError = createSyncError("provider-factory-failed", error, false);
      emitError(syncError);
      throw error;
    }
    attachProvider();
    return provider;
  };

  const waitForConnected = async (currentProvider: SyncProviderAdapter): Promise<void> => {
    if (currentProvider.status === "connected") {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const offStatus = currentProvider.onStatusChange((status) => {
        if (status === "connected") {
          offStatus();
          offError();
          resolve();
        }
      });
      const offError = currentProvider.onError((error) => {
        if (!error.recoverable) {
          offStatus();
          offError();
          reject(error);
        }
      });
    });
  };

  const startPersistence = async (): Promise<void> => {
    try {
      await persistence.start();
      await persistence.whenReady;
      const snapshot = encodeStateAsUpdate(doc);
      emitEvent({ type: "snapshot-applied", timestamp: Date.now(), bytes: snapshot.length });
    } catch (error) {
      const syncError = createSyncError("persistence-start-failed", error, false);
      emitError(syncError);
      throw error;
    }
  };

  const ready = startPersistence();

  async function connectInternal(isRetry: boolean): Promise<void> {
    if (destroyed) {
      throw new Error("SyncManager has been destroyed");
    }
    manualDisconnect = false;
    if (!isRetry) {
      cancelReconnectTimer(false);
    }
    if (networkOffline) {
      transitionStatus("offline");
      return;
    }
    await ready;
    const currentProvider = ensureProvider();
    if (currentProvider.status === "connected") {
      reconnectAttempts = 0;
      cancelReconnectTimer(true);
      transitionStatus("connected");
      return;
    }
    if (currentProvider.status !== "connecting") {
      transitionStatus("connecting");
      try {
        await currentProvider.connect();
      } catch (error) {
        const syncError = createSyncError("provider-connect-failed", error, true);
        emitError(syncError);
        transitionStatus("recovering");
        scheduleReconnect("error");
        throw error;
      }
    }
    void waitForConnected(currentProvider)
      .then(() => {
        reconnectAttempts = 0;
        cancelReconnectTimer(true);
        transitionStatus("connected");
      })
      .catch(() => {
        transitionStatus("recovering");
        scheduleReconnect("error");
      });
  }

  let connectPromise: Promise<void> | null = null;
  // `connect()` resolves once a connection attempt is underway; callers should observe `status`
  // changes rather than awaiting a successful socket open. Reusing the in-flight promise prevents
  // overlapping connect attempts when multiple consumers ask for connectivity at the same time.
  const connect = async (): Promise<void> => {
    if (!connectPromise) {
      connectPromise = (async () => {
        try {
          await connectInternal(false);
        } finally {
          connectPromise = null;
        }
      })();
    }
    return connectPromise;
  };

  const disconnect = async (): Promise<void> => {
    manualDisconnect = true;
    reconnectAttempts = 0;
    cancelReconnectTimer(true);
    if (!provider) {
      transitionStatus("offline");
      return;
    }
    try {
      await provider.disconnect();
    } catch (error) {
      const syncError = createSyncError("provider-disconnect-failed", error, true);
      emitError(syncError);
    } finally {
      transitionStatus("offline");
    }
  };

  const destroy = async (): Promise<void> => {
    if (destroyed) {
      return;
    }
    destroyed = true;
    doc.off("update", handleDocUpdate);
    awareness.off("update", handleAwarenessUpdate);

    await disconnect();
    detachProviderListeners();
    teardownCallbacks.splice(0, teardownCallbacks.length).forEach((teardown) => {
      try {
        teardown();
      } catch (error) {
        if (typeof console !== "undefined" && typeof console.error === "function") {
          console.error("[sync-manager] teardown failed", error);
        }
      }
    });
    cancelReconnectTimer(false);
    if (provider) {
      try {
        await provider.destroy();
      } catch (error) {
        const syncError = createSyncError("provider-destroy-failed", error, true);
        emitError(syncError);
      }
      provider = null;
    }

    try {
      await ready.catch(() => undefined);
    } catch (_error) {
      // already surfaced through emitError
    }

    try {
      await persistence.destroy();
    } catch (error) {
      const syncError = createSyncError("persistence-destroy-failed", error, true);
      emitError(syncError);
    }

    try {
      awareness.destroy();
    } catch (error) {
      if (typeof console !== "undefined" && typeof console.error === "function") {
        console.error("[sync-manager] awareness destroy failed", error);
      }
    }

    try {
      undoManager.destroy();
    } catch (error) {
      if (typeof console !== "undefined" && typeof console.error === "function") {
        console.error("[sync-manager] undo manager destroy failed", error);
      }
    }

    statusListeners.clear();
    eventListeners.clear();
    errorListeners.clear();
  };

  const updateAwareness = (state: Partial<SyncAwarenessState>): void => {
    const previous = awareness.getLocalState() ?? {};
    awareness.setLocalState({ ...previous, ...state });
  };

  const onStatusChange = (listener: Listener<SyncManagerStatus>): (() => void) => {
    statusListeners.add(listener);
    return () => {
      statusListeners.delete(listener);
    };
  };

  const onEvent = (listener: Listener<SyncManagerEvent>): (() => void) => {
    eventListeners.add(listener);
    return () => {
      eventListeners.delete(listener);
    };
  };

  const onError = (listener: Listener<SyncProviderError>): (() => void) => {
    errorListeners.add(listener);
    return () => {
      errorListeners.delete(listener);
    };
  };

  return {
    outline,
    doc,
    awareness,
    undoManager,
    localOrigin,
    get status() {
      return currentStatus;
    },
    ready,
    connect,
    disconnect,
    destroy,
    updateAwareness,
    onStatusChange,
    onEvent,
    onError
  };
};
