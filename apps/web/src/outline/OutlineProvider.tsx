import {
  addEdge,
  claimBootstrap,
  createNode,
  createOutlineSnapshot,
  createSessionStore,
  createSyncContext,
  defaultSessionState,
  markBootstrapComplete,
  releaseBootstrapClaim,
  type OutlineSnapshot,
  type SessionState,
  type SessionStore,
  type SyncContext
} from "@thortiq/sync-core";
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

import { createBrowserPersistence, createBrowserSessionAdapter } from "./platformAdapters";

interface OutlineStore {
  readonly sync: SyncContext;
  readonly session: SessionStore;
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => OutlineSnapshot;
  readonly ready: Promise<void>;
  attach: () => void;
  detach: () => void;
}

const OutlineStoreContext = createContext<OutlineStore | null>(null);

const createOutlineStore = (): OutlineStore => {
  const sync = createSyncContext();
  const persistence = createBrowserPersistence(sync.doc);
  const sessionAdapter = createBrowserSessionAdapter();
  const session = createSessionStore(sessionAdapter, {
    initialState: defaultSessionState()
  });

  let snapshot = createOutlineSnapshot(sync.outline);
  const listeners = new Set<() => void>();
  let listenersAttached = false;

  const log = (...args: Parameters<Console["log"]>) => {
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
    await persistence.start();
    await persistence.whenReady;

    const claim = claimBootstrap(sync.outline, sync.localOrigin);
    if (claim.claimed) {
      try {
        seedOutline(sync);
        markBootstrapComplete(sync.outline, sync.localOrigin);
      } catch (error) {
        releaseBootstrapClaim(sync.outline, sync.localOrigin);
        throw error;
      }
    }
    snapshot = createOutlineSnapshot(sync.outline);
    ensureSelectionValid();
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
    listenersAttached = false;
    sync.doc.off("afterTransaction", handleDocAfterTransaction);
    sync.doc.off("update", handleDocBinaryUpdate);
    log("[outline-store]", "detached", { clientId: sync.doc.clientID });
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
    ready,
    attach,
    detach
  };
};

export const OutlineProvider = ({ children }: PropsWithChildren): JSX.Element => {
  const storeRef = useRef<OutlineStore | null>(null);
  if (!storeRef.current) {
    storeRef.current = createOutlineStore();
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

export const useSyncContext = (): SyncContext => {
  const store = useContext(OutlineStoreContext);
  if (!store) {
    throw new Error("useSyncContext must be used within OutlineProvider");
  }
  return store.sync;
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

const seedOutline = (sync: SyncContext): void => {
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
