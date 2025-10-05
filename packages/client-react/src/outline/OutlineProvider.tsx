import type { PropsWithChildren, ReactNode } from "react";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore
} from "react";

import {
  createOutlineStore,
  type OutlinePresenceSnapshot,
  type OutlineStore,
  type OutlineStoreOptions
} from "@thortiq/client-core/outlineStore";
import type { OutlineSnapshot } from "@thortiq/client-core";
import type {
  SessionPaneState,
  SessionState,
  SessionStore
} from "@thortiq/sync-core";
import type { SyncManager, SyncManagerStatus } from "@thortiq/client-core";

const OutlineStoreContext = createContext<OutlineStore | null>(null);

export interface OutlineProviderProps extends PropsWithChildren {
  readonly options: OutlineStoreOptions;
  readonly loadingFallback?: ReactNode;
}

export const OutlineProvider = ({ options, loadingFallback = null, children }: OutlineProviderProps) => {
  const store = useMemo(() => createOutlineStore(options), [options]);
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
          console.error("[OutlineProvider] failed to initialise", error);
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
    return <>{loadingFallback}</>;
  }

  return <OutlineStoreContext.Provider value={value}>{children}</OutlineStoreContext.Provider>;
};

export const useOutlineStore = (): OutlineStore => {
  const store = useContext(OutlineStoreContext);
  if (!store) {
    throw new Error("useOutlineStore must be used within OutlineProvider");
  }
  return store;
};

export const useOutlineSnapshot = (): OutlineSnapshot => {
  const store = useOutlineStore();
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
};

export const useOutlinePresence = (): OutlinePresenceSnapshot => {
  const store = useOutlineStore();
  return useSyncExternalStore(
    store.subscribePresence,
    store.getPresenceSnapshot,
    store.getPresenceSnapshot
  );
};

export const useSyncContext = (): SyncManager => {
  const store = useOutlineStore();
  return store.sync;
};

export const useAwarenessIndicatorsEnabled = (): boolean => {
  const store = useOutlineStore();
  return store.awarenessIndicatorsEnabled;
};

export const useSyncDebugLoggingEnabled = (): boolean => {
  const store = useOutlineStore();
  return store.syncDebugLoggingEnabled;
};

export const useSyncStatus = (): SyncManagerStatus => {
  const store = useOutlineStore();
  return useSyncExternalStore(store.subscribeStatus, store.getStatus, store.getStatus);
};

export const useOutlineSessionStore = (): SessionStore => {
  const store = useOutlineStore();
  return store.session;
};

export const useOutlineSessionState = (): SessionState => {
  const sessionStore = useOutlineSessionStore();
  return useSyncExternalStore(sessionStore.subscribe, sessionStore.getState, sessionStore.getState);
};

export const useOutlinePaneState = (paneId: string): SessionPaneState | null => {
  const sessionStore = useOutlineSessionStore();
  const getSnapshot = () => {
    const state = sessionStore.getState();
    const pane = state.panes.find((candidate) => candidate.paneId === paneId) ?? null;
    return pane;
  };
  return useSyncExternalStore(sessionStore.subscribe, getSnapshot, getSnapshot);
};

export const useOutlinePaneIds = (): readonly string[] => {
  const sessionStore = useOutlineSessionStore();
  const getSnapshot = () => sessionStore.getState().panes.map((pane) => pane.paneId);
  return useSyncExternalStore(sessionStore.subscribe, getSnapshot, getSnapshot);
};

export const useOutlineActivePaneId = (): string => {
  const sessionStore = useOutlineSessionStore();
  const getSnapshot = () => sessionStore.getState().activePaneId;
  return useSyncExternalStore(sessionStore.subscribe, getSnapshot, getSnapshot);
};

// Re-export search hooks
export {
  useSearchIndex,
  useSearchQuery,
  useSearchCommands,
  useSearchResults
} from "./hooks/useSearchCommands";
