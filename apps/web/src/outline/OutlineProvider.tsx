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
import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";

interface OutlineStore {
  readonly sync: SyncContext;
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => OutlineSnapshot;
  readonly dispose: () => void;
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

  const handleDocUpdate = () => {
    snapshot = createOutlineSnapshot(sync.outline);
    notify();
  };

  sync.doc.on("afterTransaction", handleDocUpdate);

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
    dispose() {
      sync.doc.off("afterTransaction", handleDocUpdate);
      listeners.clear();
    }
  };
};

export const OutlineProvider = ({ children }: PropsWithChildren): JSX.Element => {
  const [store] = useState(() => createOutlineStore());

  useEffect(() => () => store.dispose(), [store]);

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
