/**
 * Session store keeps per-device UI metadata (pane layout, selections) aligned across reloads
 * and browser tabs without coupling shared packages to platform APIs. Callers provide a storage
 * adapter (localStorage, AsyncStorage, etc.) so the logic remains portable while persisting
 * stable edge/node identifiers instead of array indices.
 */
import type { EdgeId } from "@thortiq/client-core";

const SESSION_VERSION = 1;

export interface SessionPaneState {
  readonly paneId: string;
  readonly rootEdgeId: EdgeId | null;
}

export interface SessionState {
  readonly version: number;
  readonly selectedEdgeId: EdgeId | null;
  readonly panes: readonly SessionPaneState[];
}

export interface SessionStorageAdapter {
  read(): string | null;
  write(value: string): void;
  clear(): void;
  subscribe(listener: () => void): () => void;
}

export interface SessionStore {
  getState(): SessionState;
  update(updater: (state: SessionState) => SessionState): void;
  setState(next: SessionState): void;
  subscribe(listener: () => void): () => void;
}

const DEFAULT_STATE: SessionState = {
  version: SESSION_VERSION,
  selectedEdgeId: null,
  panes: [{ paneId: "outline", rootEdgeId: null }]
};

export interface CreateSessionStoreOptions {
  readonly initialState?: SessionState;
}

export const createSessionStore = (
  adapter: SessionStorageAdapter,
  options: CreateSessionStoreOptions = {}
): SessionStore => {
  let state = normaliseState(adapter.read(), options.initialState ?? DEFAULT_STATE);
  const listeners = new Set<() => void>();
  let lastWritten = JSON.stringify(state);

  const notify = () => {
    listeners.forEach((listener) => listener());
  };

  const persist = (next: SessionState) => {
    state = cloneState(next);
    const serialized = JSON.stringify(state);
    lastWritten = serialized;
    adapter.write(serialized);
    notify();
  };

  const getState = (): SessionState => state;

  const update = (updater: (current: SessionState) => SessionState): void => {
    const next = updater(state);
    if (!isStateEqual(next, state)) {
      persist(next);
    }
  };

  const setState = (next: SessionState): void => {
    if (!isStateEqual(next, state)) {
      persist(next);
    }
  };

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    const unsubscribeAdapter = adapter.subscribe(() => {
      const raw = adapter.read();
      const next = normaliseState(raw, state);
      const serialized = JSON.stringify(next);
      if (raw === null && lastWritten === null) {
        return;
      }
      if (serialized === lastWritten) {
        return;
      }
      if (isStateEqual(next, state)) {
        return;
      }
      state = cloneState(next);
      lastWritten = serialized;
      notify();
    });
    return () => {
      listeners.delete(listener);
      unsubscribeAdapter();
    };
  };

  return {
    getState,
    update,
    setState,
    subscribe
  };
};

const normaliseState = (raw: string | null, fallback: SessionState): SessionState => {
  if (!raw) {
    return cloneState(fallback);
  }
  try {
    const parsed = JSON.parse(raw) as Partial<SessionState>;
    if (typeof parsed !== "object" || parsed === null) {
      return cloneState(fallback);
    }
    if (parsed.version !== SESSION_VERSION) {
      return cloneState(fallback);
    }
    return {
      version: SESSION_VERSION,
      selectedEdgeId:
        typeof parsed.selectedEdgeId === "string" || parsed.selectedEdgeId === null
          ? parsed.selectedEdgeId ?? null
          : null,
      panes: Array.isArray(parsed.panes)
        ? parsed.panes
            .map((pane) =>
              typeof pane === "object" && pane !== null && typeof pane.paneId === "string"
                ? {
                    paneId: pane.paneId,
                    rootEdgeId:
                      typeof pane.rootEdgeId === "string" || pane.rootEdgeId === null
                        ? (pane.rootEdgeId ?? null)
                        : null
                  }
                : null
            )
            .filter((pane): pane is SessionPaneState => pane !== null)
        : fallback.panes
    };
  } catch (_error) {
    return cloneState(fallback);
  }
};

const isStateEqual = (a: SessionState, b: SessionState): boolean => {
  if (a === b) {
    return true;
  }
  if (a.version !== b.version || a.selectedEdgeId !== b.selectedEdgeId) {
    return false;
  }
  if (a.panes.length !== b.panes.length) {
    return false;
  }
  return a.panes.every((pane, index) => {
    const other = b.panes[index];
    return pane.paneId === other.paneId && pane.rootEdgeId === other.rootEdgeId;
  });
};

const cloneState = (state: SessionState): SessionState => ({
  version: state.version,
  selectedEdgeId: state.selectedEdgeId,
  panes: state.panes.map((pane) => ({ ...pane }))
});

export const createMemorySessionStorageAdapter = (initialValue: string | null = null): SessionStorageAdapter => {
  let value = initialValue;
  const listeners = new Set<() => void>();

  return {
    read() {
      return value;
    },
    write(next) {
      value = next;
      listeners.forEach((listener) => listener());
    },
    clear() {
      value = null;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
};

export const defaultSessionState = (): SessionState => cloneState(DEFAULT_STATE);
