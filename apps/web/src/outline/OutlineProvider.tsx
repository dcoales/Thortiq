import {
  addEdge,
  claimBootstrap,
  createNode,
  createOutlineSnapshot,
  createSessionStore,
  defaultSessionState,
  markBootstrapComplete,
  releaseBootstrapClaim,
  type EdgeId,
  type OutlineSnapshot,
  type SessionState,
  type SessionStore,
  type SessionStorageAdapter
} from "@thortiq/sync-core";
import {
  createEphemeralPersistenceFactory,
  createEphemeralProviderFactory,
  createSyncManager,
  type SyncAwarenessState,
  type SyncManager,
  type SyncManagerOptions,
  type SyncManagerStatus,
  type SyncPresenceSelection
} from "@thortiq/client-core";
import type { PropsWithChildren } from "react";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore
} from "react";
import type { Doc as YDoc, Transaction as YTransaction } from "yjs";

import { createBrowserSessionAdapter, createBrowserSyncPersistenceFactory } from "./platformAdapters";
import { createWebsocketProviderFactory } from "./websocketProvider";

export interface OutlinePresenceParticipant {
  readonly clientId: number;
  readonly userId: string;
  readonly displayName: string;
  readonly color: string;
  readonly focusEdgeId: EdgeId | null;
  readonly selection?: SyncPresenceSelection;
  readonly metadata?: Readonly<Record<string, string>>;
  readonly isLocal: boolean;
}

export interface OutlinePresenceSnapshot {
  readonly participants: readonly OutlinePresenceParticipant[];
  readonly byEdgeId: ReadonlyMap<EdgeId, readonly OutlinePresenceParticipant[]>;
}

export interface OutlineProviderOptions {
  readonly docId?: string;
  readonly persistenceFactory?: SyncManagerOptions["persistenceFactory"];
  readonly providerFactory?: SyncManagerOptions["providerFactory"];
  readonly autoConnect?: boolean;
  readonly awarenessDefaults?: SyncAwarenessState;
  readonly enableAwarenessIndicators?: boolean;
  readonly enableSyncDebugLogging?: boolean;
  readonly seedOutline?: (sync: SyncManager) => void;
  readonly skipDefaultSeed?: boolean;
  readonly sessionAdapter?: SessionStorageAdapter;
}

interface OutlineProviderProps extends PropsWithChildren {
  readonly options?: OutlineProviderOptions;
}

interface OutlineStore {
  readonly sync: SyncManager;
  readonly session: SessionStore;
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => OutlineSnapshot;
  readonly subscribePresence: (listener: () => void) => () => void;
  readonly getPresenceSnapshot: () => OutlinePresenceSnapshot;
  readonly subscribeStatus: (listener: () => void) => () => void;
  readonly getStatus: () => SyncManagerStatus;
  readonly ready: Promise<void>;
  readonly awarenessIndicatorsEnabled: boolean;
  readonly syncDebugLoggingEnabled: boolean;
  attach: () => void;
  detach: () => void;
}

const OutlineStoreContext = createContext<OutlineStore | null>(null);

const SYNC_DOC_ID = "primary";

const readEnv = (key: string): string | undefined => {
  const env = (import.meta.env as Record<string, string | undefined> | undefined) ?? undefined;
  const value = env?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

const getDefaultEndpoint = (): string => {
  if (typeof window === "undefined") {
    return "ws://localhost:1234/sync/v1/{docId}";
  }
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${window.location.host}/sync/v1/{docId}`;
};

const isTestEnvironment = (): boolean => import.meta.env?.MODE === "test";

const createOutlineStore = (options: OutlineProviderOptions = {}): OutlineStore => {
  const envEndpoint = readEnv("VITE_SYNC_WEBSOCKET_URL");
  const envToken = readEnv("VITE_SYNC_AUTH_TOKEN");
  const envUserId = readEnv("VITE_SYNC_USER_ID") ?? "local";
  const envDisplayName = readEnv("VITE_SYNC_DISPLAY_NAME") ?? envUserId;
  const envColor = readEnv("VITE_SYNC_COLOR") ?? "#4f46e5";

  const persistenceFactory = options.persistenceFactory
    ?? (isTestEnvironment()
      ? createEphemeralPersistenceFactory()
      : createBrowserSyncPersistenceFactory());

  const providerFactory = options.providerFactory
    ?? ((isTestEnvironment() || typeof globalThis.WebSocket !== "function")
      ? createEphemeralProviderFactory()
      : createWebsocketProviderFactory({
          endpoint: envEndpoint ?? getDefaultEndpoint(),
          token: envToken
        }));

  const awarenessDefaults: SyncAwarenessState = options.awarenessDefaults ?? {
    userId: envUserId,
    displayName: envDisplayName,
    color: envColor,
    focusEdgeId: null
  };

  const awarenessIndicatorsEnabled = options.enableAwarenessIndicators ?? false;
  const syncDebugLoggingEnabled = options.enableSyncDebugLogging ?? false;

  const storeConfig = {
    autoConnect: options.autoConnect ?? true,
    skipDefaultSeed: options.skipDefaultSeed ?? false,
    seedOutline: options.seedOutline
  } as const;

  const sync = createSyncManager({
    docId: options.docId ?? SYNC_DOC_ID,
    persistenceFactory,
    providerFactory,
    awarenessDefaults
  });
  const sessionAdapter = options.sessionAdapter ?? createBrowserSessionAdapter();
  const session = createSessionStore(sessionAdapter, {
    initialState: defaultSessionState()
  });

  let snapshot = createOutlineSnapshot(sync.outline);
  const listeners = new Set<() => void>();
  const presenceListeners = new Set<() => void>();
  const statusListeners = new Set<() => void>();
  const teardownCallbacks: Array<() => void> = [];
  let listenersAttached = false;
  let status: SyncManagerStatus = sync.status;

  const log = (...args: Parameters<Console["log"]>) => {
    if (!syncDebugLoggingEnabled) {
      return;
    }
    if (typeof console === "undefined") {
      return;
    }
    if (typeof console.log === "function") {
      console.log(...args);
      return;
    }
    if (typeof console.debug === "function") {
      console.debug(...args);
    }
  };

  const notify = () => {
    listeners.forEach((listener) => listener());
  };

  const notifyPresence = () => {
    presenceListeners.forEach((listener) => listener());
  };

  const notifyStatus = () => {
    statusListeners.forEach((listener) => listener());
  };

  const mapAwarenessState = (
    clientId: number,
    state: Partial<SyncAwarenessState>
  ): OutlinePresenceParticipant => {
    const userId = typeof state.userId === "string" && state.userId.length > 0 ? state.userId : `client:${clientId}`;
    const displayName =
      typeof state.displayName === "string" && state.displayName.length > 0 ? state.displayName : userId;
    const color = typeof state.color === "string" && state.color.length > 0 ? state.color : "#6b7280";
    const focusEdgeId = typeof state.focusEdgeId === "string" ? (state.focusEdgeId as EdgeId) : null;
    const selection = state.selection && typeof state.selection === "object" ? state.selection : undefined;
    const metadata = state.metadata && typeof state.metadata === "object" ? state.metadata : undefined;
    return {
      clientId,
      userId,
      displayName,
      color,
      focusEdgeId,
      selection,
      metadata,
      isLocal: clientId === sync.awareness.clientID
    } satisfies OutlinePresenceParticipant;
  };

  const computePresenceSnapshot = (): OutlinePresenceSnapshot => {
    const states = sync.awareness.getStates();
    const participants: OutlinePresenceParticipant[] = [];
    const byEdgeId = new Map<EdgeId, OutlinePresenceParticipant[]>();
    states.forEach((value, clientId) => {
      if (!value) {
        return;
      }
      const participant = mapAwarenessState(clientId, value as Partial<SyncAwarenessState>);
      participants.push(participant);
      if (participant.focusEdgeId) {
        const list = byEdgeId.get(participant.focusEdgeId) ?? [];
        list.push(participant);
        byEdgeId.set(participant.focusEdgeId, list);
      }
    });
    const frozenByEdgeId = new Map<EdgeId, readonly OutlinePresenceParticipant[]>();
    byEdgeId.forEach((value, key) => {
      frozenByEdgeId.set(key, value.slice());
    });
    return {
      participants,
      byEdgeId: frozenByEdgeId
    } satisfies OutlinePresenceSnapshot;
  };

  let presenceSnapshot = computePresenceSnapshot();

  const syncSessionSelectionToAwareness = (): void => {
    const { selectedEdgeId } = session.getState();
    const selection: SyncPresenceSelection | undefined = selectedEdgeId
      ? { anchorEdgeId: selectedEdgeId, headEdgeId: selectedEdgeId }
      : undefined;
    sync.updateAwareness({
      focusEdgeId: selectedEdgeId ?? null,
      selection
    });
  };

  const handleStatusChange = (nextStatus: SyncManagerStatus) => {
    if (status === nextStatus) {
      return;
    }
    status = nextStatus;
    notifyStatus();
  };

  const unsubscribeSession = session.subscribe(syncSessionSelectionToAwareness);
  teardownCallbacks.push(unsubscribeSession);
  const unsubscribeStatus = sync.onStatusChange(handleStatusChange);
  teardownCallbacks.push(unsubscribeStatus);
  syncSessionSelectionToAwareness();
  presenceSnapshot = computePresenceSnapshot();

  const handleAwarenessUpdate = () => {
    presenceSnapshot = computePresenceSnapshot();
    notifyPresence();
  };

  log("[outline-store]", "store created", { clientId: sync.doc.clientID });

  const ensureSelectionValid = () => {
    const state = session.getState();
    const currentEdgeId = state.selectedEdgeId;
    if (currentEdgeId && snapshot.edges.has(currentEdgeId)) {
      return;
    }
    const fallbackEdgeId = snapshot.rootEdgeIds[0] ?? null;
    session.update((existing) => {
      if (existing.selectedEdgeId === fallbackEdgeId) {
        return existing;
      }
      return {
        ...existing,
        selectedEdgeId: fallbackEdgeId
      };
    });
  };

  const ready = (async () => {
    await sync.ready;

    const claim = claimBootstrap(sync.outline, sync.localOrigin);
    if (claim.claimed) {
      try {
        if (!storeConfig.skipDefaultSeed) {
          seedDefaultOutline(sync);
        }
        storeConfig.seedOutline?.(sync);
        markBootstrapComplete(sync.outline, sync.localOrigin);
      } catch (error) {
        releaseBootstrapClaim(sync.outline, sync.localOrigin);
        throw error;
      }
    }
    snapshot = createOutlineSnapshot(sync.outline);
    ensureSelectionValid();
    if (storeConfig.autoConnect) {
      // Fire network connect without blocking local bootstrap readiness
      void sync.connect().catch((error) => {
        if (typeof console !== "undefined" && typeof console.error === "function") {
          console.error("[outline-store] failed to connect provider", error);
        }
      });
    }
  })();

  const handleDocAfterTransaction = (transaction: YTransaction) => {
    if (typeof console !== "undefined") {
      const changed = Array.from(transaction.changedParentTypes.keys()).map((type) => type.constructor.name);
      log("[outline-store]", "afterTransaction", {
        origin: transaction.origin,
        local: transaction.local,
        changedParents: changed
      });
    }
    snapshot = createOutlineSnapshot(sync.outline);
    ensureSelectionValid();
    notify();
  };

  const handleDocBinaryUpdate = (update: Uint8Array, origin: unknown, doc: YDoc, transaction: YTransaction) => {
    const changed = Array.from(transaction.changedParentTypes.keys()).map((type) => type.constructor.name);
    log("[outline-store]", "update", {
      bytes: update.length,
      origin,
      local: transaction.local,
      changedParents: changed,
      clientId: doc.clientID
    });
  };

  const attach = () => {
    if (listenersAttached) {
      return;
    }
    listenersAttached = true;
    void ready
      .then(() => {
        if (!listenersAttached) {
          return;
        }
        log("[outline-store]", "attached", { clientId: sync.doc.clientID });
        sync.doc.on("afterTransaction", handleDocAfterTransaction);
        sync.doc.on("update", handleDocBinaryUpdate);
        sync.awareness.on("update", handleAwarenessUpdate);
        handleAwarenessUpdate();
      })
      .catch((error) => {
        if (typeof console !== "undefined" && typeof console.error === "function") {
          console.error("[outline-store] failed to attach listeners", error);
        }
      });
  };

  const detach = () => {
    if (!listenersAttached) {
      return;
    }
    sync.updateAwareness({ focusEdgeId: null, selection: undefined });
    listenersAttached = false;
    sync.doc.off("afterTransaction", handleDocAfterTransaction);
    sync.doc.off("update", handleDocBinaryUpdate);
    sync.awareness.off("update", handleAwarenessUpdate);
    handleAwarenessUpdate();
    while (teardownCallbacks.length > 0) {
      const dispose = teardownCallbacks.pop();
      try {
        dispose?.();
      } catch (error) {
        if (typeof console !== "undefined" && typeof console.error === "function") {
          console.error("[outline-store] teardown callback failed", error);
        }
      }
    }
    log("[outline-store]", "detached", { clientId: sync.doc.clientID });
    void sync.disconnect().catch((error) => {
      if (typeof console !== "undefined" && typeof console.error === "function") {
        console.error("[outline-store] failed to disconnect", error);
      }
    });
  };

  return {
    sync,
    session,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot() {
      return snapshot;
    },
    subscribePresence(listener) {
      presenceListeners.add(listener);
      return () => {
        presenceListeners.delete(listener);
      };
    },
    getPresenceSnapshot() {
      return presenceSnapshot;
    },
    subscribeStatus(listener) {
      statusListeners.add(listener);
      return () => {
        statusListeners.delete(listener);
      };
    },
    getStatus() {
      return status;
    },
    ready,
    awarenessIndicatorsEnabled,
    syncDebugLoggingEnabled,
    attach,
    detach
  };
};

export const OutlineProvider = ({ children, options }: OutlineProviderProps): JSX.Element => {
  const storeRef = useRef<OutlineStore | null>(null);
  if (!storeRef.current) {
    storeRef.current = createOutlineStore(options);
  }
  const store = storeRef.current;
  if (!store) {
    throw new Error("Failed to create outline store");
  }

  const [isReady, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    store.attach();
    store.ready
      .then(() => {
        if (active) {
          setReady(true);
        }
      })
      .catch((error) => {
        if (typeof console !== "undefined" && typeof console.error === "function") {
          console.error("[outline-store] failed to initialise", error);
        }
        if (active) {
          setReady(true);
        }
      });
    return () => {
      active = false;
      store.detach();
    };
  }, [store]);

  const value = useMemo(() => store, [store]);

  if (!isReady) {
    return <div data-testid="outline-loading" />;
  }

  return <OutlineStoreContext.Provider value={value}>{children}</OutlineStoreContext.Provider>;
};

export const useOutlineSnapshot = (): OutlineSnapshot => {
  const store = useContext(OutlineStoreContext);
  if (!store) {
    throw new Error("useOutlineSnapshot must be used within OutlineProvider");
  }

  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
};

export const useOutlinePresence = (): OutlinePresenceSnapshot => {
  const store = useContext(OutlineStoreContext);
  if (!store) {
    throw new Error("useOutlinePresence must be used within OutlineProvider");
  }
  return useSyncExternalStore(
    store.subscribePresence,
    store.getPresenceSnapshot,
    store.getPresenceSnapshot
  );
}; 

export const useSyncContext = (): SyncManager => {
  const store = useContext(OutlineStoreContext);
  if (!store) {
    throw new Error("useSyncContext must be used within OutlineProvider");
  }
  return store.sync;
};

export const useAwarenessIndicatorsEnabled = (): boolean => {
  const store = useContext(OutlineStoreContext);
  if (!store) {
    throw new Error("useAwarenessIndicatorsEnabled must be used within OutlineProvider");
  }
  return store.awarenessIndicatorsEnabled;
};

export const useSyncDebugLoggingEnabled = (): boolean => {
  const store = useContext(OutlineStoreContext);
  if (!store) {
    throw new Error("useSyncDebugLoggingEnabled must be used within OutlineProvider");
  }
  return store.syncDebugLoggingEnabled;
};

export const useSyncStatus = (): SyncManagerStatus => {
  const store = useContext(OutlineStoreContext);
  if (!store) {
    throw new Error("useSyncStatus must be used within OutlineProvider");
  }
  return useSyncExternalStore(store.subscribeStatus, store.getStatus, store.getStatus);
};

export const useOutlineSessionStore = (): SessionStore => {
  const store = useContext(OutlineStoreContext);
  if (!store) {
    throw new Error("useOutlineSessionStore must be used within OutlineProvider");
  }
  return store.session;
};

export const useOutlineSessionState = (): SessionState => {
  const sessionStore = useOutlineSessionStore();
  return useSyncExternalStore(sessionStore.subscribe, sessionStore.getState, sessionStore.getState);
};

export const seedDefaultOutline = (sync: SyncManager): void => {
  const { outline, localOrigin } = sync;

  const createSeedNode = (text: string) =>
    createNode(outline, {
      text,
      origin: localOrigin
    });

  const welcomeNode = createSeedNode("Welcome to Thortiq");
  addEdge(outline, { parentNodeId: null, childNodeId: welcomeNode, origin: localOrigin });

  const instructionsNode = createSeedNode("Phase 1 focuses on the collaborative outliner core.");
  addEdge(outline, { parentNodeId: welcomeNode, childNodeId: instructionsNode, origin: localOrigin });

  const virtualizationNode = createSeedNode(
    "Scroll to see TanStack Virtual keeping the outline performant."
  );
  addEdge(outline, { parentNodeId: welcomeNode, childNodeId: virtualizationNode, origin: localOrigin });

  const syncNode = createSeedNode(
    "All text and structural changes flow through the unified Yjs document."
  );
  addEdge(outline, { parentNodeId: welcomeNode, childNodeId: syncNode, origin: localOrigin });
};
