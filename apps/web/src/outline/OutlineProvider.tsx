import {
  addEdge,
  createNode,
  createOutlineSnapshot,
  createSyncContext,
  getRootEdgeIds,
  type OutlineSnapshot,
  type SyncContext
} from "@thortiq/sync-core";
import type { PropsWithChildren } from "react";
import { createContext, useContext, useEffect, useRef, useSyncExternalStore } from "react";
import type { Doc as YDoc, Transaction as YTransaction } from "yjs";

interface OutlineStore {
  readonly sync: SyncContext;
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => OutlineSnapshot;
  attach: () => void;
  detach: () => void;
}

const OutlineStoreContext = createContext<OutlineStore | null>(null);

const createOutlineStore = (): OutlineStore => {
  const sync = createSyncContext();
  seedOutline(sync);

  let snapshot = createOutlineSnapshot(sync.outline);
  const listeners = new Set<() => void>();

  const notify = () => {
    listeners.forEach((listener) => listener());
  };

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

  log("[outline-store]", "store created", { clientId: sync.doc.clientID });

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
    const summary = Array.from(snapshot.nodes.values())
      .slice(0, 5)
      .map((node) => ({ id: node.id, text: node.text }));
    log("[outline-store]", "snapshot updated", {
      nodeCount: snapshot.nodes.size,
      sampleNodes: summary
    });
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
  let listenersAttached = false;

  const attach = () => {
    if (listenersAttached) {
      return;
    }
    listenersAttached = true;
    log("[outline-store]", "attached", { clientId: sync.doc.clientID });
    sync.doc.on("afterTransaction", handleDocAfterTransaction);
    sync.doc.on("update", handleDocBinaryUpdate);
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
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot() {
      return snapshot;
    },
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

  useEffect(() => {
    store.attach();
    return () => {
      store.detach();
    };
  }, [store]);

  return <OutlineStoreContext.Provider value={store}>{children}</OutlineStoreContext.Provider>;
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

const seedOutline = (sync: SyncContext): void => {
  if (getRootEdgeIds(sync.outline).length > 0) {
    return;
  }

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
