/**
 * Session store keeps per-device UI metadata (pane layout, selections) aligned across reloads
 * and browser tabs without coupling shared packages to platform APIs. Callers provide a storage
 * adapter (localStorage, AsyncStorage, etc.) so the logic remains portable while persisting
 * stable edge/node identifiers instead of array indices.
 */
import type { EdgeId } from "@thortiq/client-core";

const SESSION_VERSION = 3;

export interface SessionPaneSelectionRange {
  readonly anchorEdgeId: EdgeId;
  readonly headEdgeId: EdgeId;
}

export interface SessionPaneState {
  readonly paneId: string;
  readonly rootEdgeId: EdgeId | null;
  readonly activeEdgeId: EdgeId | null;
  readonly selectionRange?: SessionPaneSelectionRange;
  readonly collapsedEdgeIds: readonly EdgeId[];
  readonly pendingFocusEdgeId?: EdgeId | null;
  readonly quickFilter?: string;
  readonly focusPathEdgeIds?: readonly EdgeId[];
}

export interface SessionState {
  readonly version: number;
  readonly selectedEdgeId: EdgeId | null;
  readonly activePaneId: string;
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
  activePaneId: "outline",
  panes: [
    {
      paneId: "outline",
      rootEdgeId: null,
      activeEdgeId: null,
      collapsedEdgeIds: [],
      pendingFocusEdgeId: null,
      quickFilter: undefined,
      focusPathEdgeIds: undefined
    }
  ]
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

export interface FocusPanePayload {
  readonly edgeId: EdgeId;
  readonly pathEdgeIds: ReadonlyArray<EdgeId>;
}

export const focusPaneEdge = (
  store: SessionStore,
  paneId: string,
  payload: FocusPanePayload
): void => {
  const normalisedPath = normaliseFocusPath(payload.edgeId, payload.pathEdgeIds);
  store.update((state) => {
    const paneIndex = state.panes.findIndex((pane) => pane.paneId === paneId);
    if (paneIndex === -1) {
      return state;
    }
    const pane = state.panes[paneIndex];
    const existingPath = pane.focusPathEdgeIds;
    if (
      pane.rootEdgeId === payload.edgeId
      && existingPath
      && areEdgeArraysEqual(existingPath, normalisedPath)
    ) {
      return state;
    }
    const nextPane: SessionPaneState = {
      ...pane,
      rootEdgeId: payload.edgeId,
      focusPathEdgeIds: normalisedPath
    };
    const panes = state.panes.map((current, index) => (index === paneIndex ? nextPane : current));
    if (state.activePaneId === paneId) {
      return {
        ...state,
        panes
      } satisfies SessionState;
    }
    return {
      ...state,
      panes,
      activePaneId: paneId
    } satisfies SessionState;
  });
};

export const clearPaneFocus = (store: SessionStore, paneId: string): void => {
  store.update((state) => {
    const paneIndex = state.panes.findIndex((pane) => pane.paneId === paneId);
    if (paneIndex === -1) {
      return state;
    }
    const pane = state.panes[paneIndex];
    if (pane.rootEdgeId === null && !pane.focusPathEdgeIds) {
      return state;
    }
    const nextPane: SessionPaneState = {
      ...pane,
      rootEdgeId: null,
      focusPathEdgeIds: undefined
    };
    const panes = state.panes.map((current, index) => (index === paneIndex ? nextPane : current));
    return {
      ...state,
      panes
    } satisfies SessionState;
  });
};

export const reconcilePaneFocus = (
  store: SessionStore,
  availableEdgeIds: ReadonlySet<EdgeId>
): void => {
  if (availableEdgeIds.size === 0) {
    store.update((state) => {
      if (!state.panes.some((pane) => pane.rootEdgeId !== null || pane.focusPathEdgeIds)) {
        return state;
      }
      const panes = state.panes.map((pane) => {
        if (pane.rootEdgeId === null && !pane.focusPathEdgeIds) {
          return pane;
        }
        return {
          ...pane,
          rootEdgeId: null,
          focusPathEdgeIds: undefined
        } satisfies SessionPaneState;
      });
      return {
        ...state,
        panes
      } satisfies SessionState;
    });
    return;
  }

  store.update((state) => {
    let mutated = false;
    const panes = state.panes.map((pane) => {
      if (pane.rootEdgeId === null) {
        if (pane.focusPathEdgeIds && pane.focusPathEdgeIds.length > 0) {
          mutated = true;
          return {
            ...pane,
            focusPathEdgeIds: undefined
          } satisfies SessionPaneState;
        }
        return pane;
      }
      if (!availableEdgeIds.has(pane.rootEdgeId)) {
        mutated = true;
        return {
          ...pane,
          rootEdgeId: null,
          focusPathEdgeIds: undefined
        } satisfies SessionPaneState;
      }
      if (pane.focusPathEdgeIds && pane.focusPathEdgeIds.length > 0) {
        const filtered = pane.focusPathEdgeIds.filter((edgeId) => availableEdgeIds.has(edgeId));
        const normalisedPath = normaliseFocusPath(pane.rootEdgeId, filtered);
        if (!areEdgeArraysEqual(normalisedPath, pane.focusPathEdgeIds)) {
          mutated = true;
          return {
            ...pane,
            focusPathEdgeIds: normalisedPath
          } satisfies SessionPaneState;
        }
      }
      return pane;
    });
    if (!mutated) {
      return state;
    }
    return {
      ...state,
      panes
    } satisfies SessionState;
  });
};

const normaliseFocusPath = (edgeId: EdgeId, pathEdgeIds: ReadonlyArray<EdgeId>): EdgeId[] => {
  const result: EdgeId[] = [];
  for (const candidate of pathEdgeIds) {
    if (typeof candidate !== "string") {
      continue;
    }
    if (result.length === 0 || result[result.length - 1] !== candidate) {
      result.push(candidate);
    }
  }
  if (result.length === 0 || result[result.length - 1] !== edgeId) {
    result.push(edgeId);
  }
  return result;
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
    const fallbackPanes = fallback.panes;
    const panes: SessionPaneState[] = Array.isArray(parsed.panes)
      ? parsed.panes
          .map((pane, index) => normalisePane(pane, fallbackPanes[index]))
          .filter((pane): pane is SessionPaneState => pane !== null)
      : fallbackPanes.map(clonePaneState);

    return {
      version: SESSION_VERSION,
      selectedEdgeId:
        typeof parsed.selectedEdgeId === "string" || parsed.selectedEdgeId === null
          ? parsed.selectedEdgeId ?? null
          : null,
      activePaneId: normaliseActivePaneId(parsed.activePaneId, panes, fallback.activePaneId),
      panes
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
  if (a.activePaneId !== b.activePaneId) {
    return false;
  }
  if (a.panes.length !== b.panes.length) {
    return false;
  }
  return a.panes.every((pane, index) => {
    const other = b.panes[index];
    return (
      pane.paneId === other.paneId
      && pane.rootEdgeId === other.rootEdgeId
      && pane.activeEdgeId === other.activeEdgeId
      && pane.pendingFocusEdgeId === other.pendingFocusEdgeId
      && pane.quickFilter === other.quickFilter
      && areOptionalEdgeArraysEqual(pane.focusPathEdgeIds, other.focusPathEdgeIds)
      && isSelectionRangeEqual(pane.selectionRange, other.selectionRange)
      && areEdgeArraysEqual(pane.collapsedEdgeIds, other.collapsedEdgeIds)
    );
  });
};

const cloneState = (state: SessionState): SessionState => ({
  version: state.version,
  selectedEdgeId: state.selectedEdgeId,
  activePaneId: state.activePaneId,
  panes: state.panes.map(clonePaneState)
});

const clonePaneState = (pane: SessionPaneState): SessionPaneState => ({
  paneId: pane.paneId,
  rootEdgeId: pane.rootEdgeId,
  activeEdgeId: pane.activeEdgeId,
  collapsedEdgeIds: [...pane.collapsedEdgeIds],
  ...(pane.focusPathEdgeIds && pane.focusPathEdgeIds.length > 0
    ? { focusPathEdgeIds: [...pane.focusPathEdgeIds] }
    : {}),
  ...(pane.selectionRange
    ? {
        selectionRange: {
          anchorEdgeId: pane.selectionRange.anchorEdgeId,
          headEdgeId: pane.selectionRange.headEdgeId
        }
      }
    : {}),
  ...(pane.pendingFocusEdgeId !== undefined ? { pendingFocusEdgeId: pane.pendingFocusEdgeId } : {}),
  ...(pane.quickFilter !== undefined ? { quickFilter: pane.quickFilter } : {})
});

const normalisePane = (
  rawPane: unknown,
  fallback: SessionPaneState | undefined
): SessionPaneState | null => {
  if (typeof rawPane !== "object" || rawPane === null) {
    return fallback ? clonePaneState(fallback) : null;
  }
  const candidate = rawPane as Record<string, unknown>;
  const paneId = candidate.paneId;
  if (typeof paneId !== "string") {
    return fallback ? clonePaneState(fallback) : null;
  }

  const rootEdgeId = toEdgeIdOrNull(candidate.rootEdgeId);
  const activeEdgeId = toEdgeIdOrNull(candidate.activeEdgeId);
  const selectionRange = toSelectionRange(candidate.selectionRange) ?? fallback?.selectionRange;
  const collapsedEdgeIds = Array.isArray(candidate.collapsedEdgeIds)
    ? candidate.collapsedEdgeIds.filter(isEdgeIdValue)
    : fallback?.collapsedEdgeIds ?? [];
  const pendingFocusEdgeId = toEdgeIdOrNullOrUndefined(candidate.pendingFocusEdgeId);
  const quickFilter = typeof candidate.quickFilter === "string" ? candidate.quickFilter : fallback?.quickFilter;
  const focusPathEdgeIds = Array.isArray(candidate.focusPathEdgeIds)
    ? candidate.focusPathEdgeIds.filter(isEdgeIdValue)
    : fallback?.focusPathEdgeIds;

  return {
    paneId,
    rootEdgeId,
    activeEdgeId,
    collapsedEdgeIds: [...collapsedEdgeIds],
    ...(focusPathEdgeIds && focusPathEdgeIds.length > 0
      ? { focusPathEdgeIds: [...focusPathEdgeIds] }
      : {}),
    ...(selectionRange ? { selectionRange: { ...selectionRange } } : {}),
    ...(pendingFocusEdgeId !== undefined
      ? { pendingFocusEdgeId }
      : fallback?.pendingFocusEdgeId !== undefined
        ? { pendingFocusEdgeId: fallback.pendingFocusEdgeId }
        : {}),
    ...(quickFilter !== undefined ? { quickFilter } : {})
  };
};

const areEdgeArraysEqual = (a: readonly EdgeId[], b: readonly EdgeId[]): boolean => {
  if (a === b) {
    return true;
  }
  if (a.length !== b.length) {
    return false;
  }
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) {
      return false;
    }
  }
  return true;
};

const areOptionalEdgeArraysEqual = (
  a: readonly EdgeId[] | undefined,
  b: readonly EdgeId[] | undefined
): boolean => {
  if (!a && !b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  return areEdgeArraysEqual(a, b);
};

const isSelectionRangeEqual = (
  a: SessionPaneSelectionRange | undefined,
  b: SessionPaneSelectionRange | undefined
): boolean => {
  if (!a && !b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  return a.anchorEdgeId === b.anchorEdgeId && a.headEdgeId === b.headEdgeId;
};

const isEdgeIdValue = (value: unknown): value is EdgeId => typeof value === "string";

const toEdgeIdOrNull = (value: unknown): EdgeId | null => {
  if (value === null) {
    return null;
  }
  if (isEdgeIdValue(value)) {
    return value;
  }
  return null;
};

const toEdgeIdOrNullOrUndefined = (value: unknown): EdgeId | null | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (isEdgeIdValue(value)) {
    return value;
  }
  return undefined;
};

const toSelectionRange = (value: unknown): SessionPaneSelectionRange | undefined => {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const candidate = value as Record<string, unknown>;
  const anchorEdgeId = candidate.anchorEdgeId;
  const headEdgeId = candidate.headEdgeId;
  if (!isEdgeIdValue(anchorEdgeId) || !isEdgeIdValue(headEdgeId)) {
    return undefined;
  }
  return { anchorEdgeId, headEdgeId };
};

const normaliseActivePaneId = (
  value: unknown,
  panes: readonly SessionPaneState[],
  fallback: string
): string => {
  if (typeof value === "string" && panes.some((pane) => pane.paneId === value)) {
    return value;
  }
  const firstPane = panes[0];
  if (firstPane) {
    return firstPane.paneId;
  }
  return fallback;
};



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
