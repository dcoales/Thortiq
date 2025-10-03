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

export interface SessionPaneFocusHistoryEntry {
  readonly rootEdgeId: EdgeId | null;
  readonly focusPathEdgeIds?: readonly EdgeId[];
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
  readonly focusHistory: readonly SessionPaneFocusHistoryEntry[];
  readonly focusHistoryIndex: number;
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
      focusPathEdgeIds: undefined,
      focusHistory: [{ rootEdgeId: null }],
      focusHistoryIndex: 0
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
    const historyEntry: SessionPaneFocusHistoryEntry = {
      rootEdgeId: payload.edgeId,
      focusPathEdgeIds: normalisedPath
    };
    const { history, index } = appendFocusHistoryEntry(pane, historyEntry);
    if (
      pane.rootEdgeId === payload.edgeId
      && areOptionalEdgeArraysEqual(pane.focusPathEdgeIds, normalisedPath)
      && pane.focusHistoryIndex === index
      && areFocusHistoriesEqual(pane.focusHistory, history)
    ) {
      return state;
    }
    const nextPane: SessionPaneState = {
      ...pane,
      rootEdgeId: payload.edgeId,
      focusPathEdgeIds: normalisedPath,
      focusHistory: history,
      focusHistoryIndex: index
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
    if (pane.rootEdgeId === null && !pane.focusPathEdgeIds && pane.focusHistory[pane.focusHistoryIndex]?.rootEdgeId === null) {
      return state;
    }
    const historyEntry: SessionPaneFocusHistoryEntry = createHomeFocusEntry();
    const { history, index } = appendFocusHistoryEntry(pane, historyEntry);
    const nextPane: SessionPaneState = {
      ...pane,
      rootEdgeId: null,
      focusPathEdgeIds: undefined,
      focusHistory: history,
      focusHistoryIndex: index
    };
    const panes = state.panes.map((current, index) => (index === paneIndex ? nextPane : current));
    return {
      ...state,
      panes
    } satisfies SessionState;
  });
};

export type FocusHistoryDirection = "back" | "forward";

export const stepPaneFocusHistory = (
  store: SessionStore,
  paneId: string,
  direction: FocusHistoryDirection
): SessionPaneFocusHistoryEntry | null => {
  let selectedEntry: SessionPaneFocusHistoryEntry | null = null;
  store.update((state) => {
    const paneIndex = state.panes.findIndex((pane) => pane.paneId === paneId);
    if (paneIndex === -1) {
      return state;
    }
    const pane = state.panes[paneIndex];
    if (pane.focusHistory.length === 0) {
      return state;
    }
    const targetIndex = direction === "back" ? pane.focusHistoryIndex - 1 : pane.focusHistoryIndex + 1;
    if (targetIndex < 0 || targetIndex >= pane.focusHistory.length) {
      return state;
    }
    const entry = pane.focusHistory[targetIndex];
    const nextPane: SessionPaneState = entry.rootEdgeId === null
      ? {
          ...pane,
          rootEdgeId: null,
          focusPathEdgeIds: undefined,
          focusHistoryIndex: targetIndex
        }
      : {
          ...pane,
          rootEdgeId: entry.rootEdgeId,
          ...(entry.focusPathEdgeIds && entry.focusPathEdgeIds.length > 0
            ? { focusPathEdgeIds: [...entry.focusPathEdgeIds] }
            : { focusPathEdgeIds: undefined }),
          focusHistoryIndex: targetIndex
        };
    selectedEntry = cloneFocusHistoryEntry(entry);
    const panes = state.panes.map((current, index) => (index === paneIndex ? nextPane : current));
    return {
      ...state,
      panes,
      activePaneId: paneId
    } satisfies SessionState;
  });
  return selectedEntry;
};

export const reconcilePaneFocus = (
  store: SessionStore,
  availableEdgeIds: ReadonlySet<EdgeId>
): void => {
  if (availableEdgeIds.size === 0) {
    store.update((state) => {
      let mutated = false;
      const panes = state.panes.map((pane) => {
        if (
          pane.rootEdgeId === null
          && !pane.focusPathEdgeIds
          && pane.focusHistory.length === 1
          && pane.focusHistory[0]?.rootEdgeId === null
          && pane.focusHistoryIndex === 0
        ) {
          return pane;
        }
        mutated = true;
        return {
          ...pane,
          rootEdgeId: null,
          focusPathEdgeIds: undefined,
          focusHistory: [createHomeFocusEntry()],
          focusHistoryIndex: 0
        } satisfies SessionPaneState;
      });
      if (!mutated) {
        return state;
      }
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
      let nextRootEdgeId = pane.rootEdgeId;
      let nextFocusPathEdgeIds = pane.focusPathEdgeIds ? [...pane.focusPathEdgeIds] : undefined;
      let paneMutated = false;

      if (nextRootEdgeId === null) {
        if (nextFocusPathEdgeIds && nextFocusPathEdgeIds.length > 0) {
          nextFocusPathEdgeIds = undefined;
          paneMutated = true;
        }
      } else if (!availableEdgeIds.has(nextRootEdgeId)) {
        nextRootEdgeId = null;
        nextFocusPathEdgeIds = undefined;
        paneMutated = true;
      } else if (nextFocusPathEdgeIds && nextFocusPathEdgeIds.length > 0) {
        const filtered = nextFocusPathEdgeIds.filter((edgeId) => availableEdgeIds.has(edgeId));
        const normalisedPath = normaliseFocusPath(nextRootEdgeId, filtered);
        if (!areEdgeArraysEqual(normalisedPath, nextFocusPathEdgeIds)) {
          nextFocusPathEdgeIds = normalisedPath;
          paneMutated = true;
        }
      }

      const interimPane: SessionPaneState = paneMutated
        ? {
            ...pane,
            rootEdgeId: nextRootEdgeId,
            ...(nextFocusPathEdgeIds && nextFocusPathEdgeIds.length > 0
              ? { focusPathEdgeIds: nextFocusPathEdgeIds }
              : { focusPathEdgeIds: undefined })
          }
        : pane;

      const { history, index } = reconcileFocusHistoryForPane(interimPane, availableEdgeIds);
      if (
        paneMutated
        || !areFocusHistoriesEqual(interimPane.focusHistory, history)
        || interimPane.focusHistoryIndex !== index
      ) {
        mutated = true;
        return {
          ...interimPane,
          focusHistory: history,
          focusHistoryIndex: index
        } satisfies SessionPaneState;
      }
      return interimPane;
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
      && pane.focusHistoryIndex === other.focusHistoryIndex
      && areFocusHistoriesEqual(pane.focusHistory, other.focusHistory)
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

const clonePaneState = (pane: SessionPaneState): SessionPaneState => {
  const focusHistory = cloneFocusHistory(pane.focusHistory);
  const focusHistoryIndex = clampFocusHistoryIndex(pane.focusHistoryIndex, focusHistory.length);

  return {
    paneId: pane.paneId,
    rootEdgeId: pane.rootEdgeId,
    activeEdgeId: pane.activeEdgeId,
    collapsedEdgeIds: [...pane.collapsedEdgeIds],
    focusHistory,
    focusHistoryIndex,
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
  } satisfies SessionPaneState;
};

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
  const focusHistory = normaliseFocusHistory(candidate.focusHistory, fallback?.focusHistory);
  const rawHistoryIndex = typeof candidate.focusHistoryIndex === "number"
    ? candidate.focusHistoryIndex
    : fallback?.focusHistoryIndex ?? focusHistory.length - 1;
  const focusHistoryIndex = clampFocusHistoryIndex(rawHistoryIndex, focusHistory.length);

  return {
    paneId,
    rootEdgeId,
    activeEdgeId,
    collapsedEdgeIds: [...collapsedEdgeIds],
    focusHistory,
    focusHistoryIndex,
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

const createHomeFocusEntry = (): SessionPaneFocusHistoryEntry => ({
  rootEdgeId: null
});

const cloneFocusHistoryEntry = (
  entry: SessionPaneFocusHistoryEntry
): SessionPaneFocusHistoryEntry => ({
  rootEdgeId: entry.rootEdgeId,
  ...(entry.focusPathEdgeIds && entry.focusPathEdgeIds.length > 0
    ? { focusPathEdgeIds: [...entry.focusPathEdgeIds] }
    : {})
});

const cloneFocusHistory = (
  history: readonly SessionPaneFocusHistoryEntry[] | undefined
): SessionPaneFocusHistoryEntry[] => {
  if (!history || history.length === 0) {
    return [createHomeFocusEntry()];
  }
  return history.map(cloneFocusHistoryEntry);
};

const clampFocusHistoryIndex = (index: number, length: number): number => {
  if (!Number.isFinite(index)) {
    return Math.max(0, length - 1);
  }
  if (index < 0) {
    return 0;
  }
  if (index >= length) {
    return Math.max(0, length - 1);
  }
  return index;
};

const normaliseFocusHistoryEntry = (
  value: unknown
): SessionPaneFocusHistoryEntry | null => {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const rawRoot = candidate.rootEdgeId;
  const rootEdgeId = rawRoot === null ? null : isEdgeIdValue(rawRoot) ? rawRoot : undefined;
  if (rootEdgeId === undefined) {
    return null;
  }
  const rawPath = candidate.focusPathEdgeIds;
  const focusPathEdgeIds = Array.isArray(rawPath)
    ? rawPath.filter(isEdgeIdValue)
    : undefined;
  if (focusPathEdgeIds && focusPathEdgeIds.length === 0) {
    return { rootEdgeId };
  }
  return focusPathEdgeIds ? { rootEdgeId, focusPathEdgeIds } : { rootEdgeId };
};

const normaliseFocusHistory = (
  raw: unknown,
  fallback: readonly SessionPaneFocusHistoryEntry[] | undefined
): SessionPaneFocusHistoryEntry[] => {
  if (!Array.isArray(raw)) {
    return cloneFocusHistory(fallback);
  }
  const entries = raw
    .map((entry) => normaliseFocusHistoryEntry(entry))
    .filter((entry): entry is SessionPaneFocusHistoryEntry => entry !== null);
  if (entries.length === 0) {
    return cloneFocusHistory(fallback);
  }
  return cloneFocusHistory(entries);
};

const appendFocusHistoryEntry = (
  pane: SessionPaneState,
  entry: SessionPaneFocusHistoryEntry
): { history: SessionPaneFocusHistoryEntry[]; index: number } => {
  const trimmed = pane.focusHistory
    .slice(0, pane.focusHistoryIndex + 1)
    .map(cloneFocusHistoryEntry);
  const lastEntry = trimmed[trimmed.length - 1];
  if (lastEntry && areFocusHistoryEntriesEqual(lastEntry, entry)) {
    return { history: trimmed, index: trimmed.length - 1 };
  }
  trimmed.push(cloneFocusHistoryEntry(entry));
  return { history: trimmed, index: trimmed.length - 1 };
};

const reconcileFocusHistoryForPane = (
  pane: SessionPaneState,
  availableEdgeIds: ReadonlySet<EdgeId>
): { history: SessionPaneFocusHistoryEntry[]; index: number } => {
  const reconciled: SessionPaneFocusHistoryEntry[] = [];

  pane.focusHistory.forEach((entry) => {
    if (entry.rootEdgeId === null) {
      reconciled.push(createHomeFocusEntry());
      return;
    }
    if (!availableEdgeIds.has(entry.rootEdgeId)) {
      return;
    }
    const filteredPath = (entry.focusPathEdgeIds ?? []).filter((edgeId) => availableEdgeIds.has(edgeId));
    const normalisedPath = normaliseFocusPath(entry.rootEdgeId, filteredPath);
    reconciled.push({
      rootEdgeId: entry.rootEdgeId,
      focusPathEdgeIds: normalisedPath
    });
  });

  if (reconciled.length === 0) {
    reconciled.push(createHomeFocusEntry());
  }

  let index = clampFocusHistoryIndex(pane.focusHistoryIndex, reconciled.length);
  const currentRoot = pane.rootEdgeId;
  if (currentRoot === null) {
    const lastHomeIndex = reconciled.reduce<number | null>((acc, entry, entryIndex) => {
      if (entry.rootEdgeId === null) {
        return entryIndex;
      }
      return acc;
    }, null);
    if (lastHomeIndex !== null) {
      index = lastHomeIndex;
    } else {
      reconciled.push(createHomeFocusEntry());
      index = reconciled.length - 1;
    }
  } else {
    const desiredPath = normaliseFocusPath(currentRoot, pane.focusPathEdgeIds ?? []);
    let targetIndex = -1;
    for (let entryIndex = reconciled.length - 1; entryIndex >= 0; entryIndex -= 1) {
      const candidate = reconciled[entryIndex];
      if (
        candidate.rootEdgeId === currentRoot
        && areOptionalEdgeArraysEqual(candidate.focusPathEdgeIds, desiredPath)
      ) {
        targetIndex = entryIndex;
        break;
      }
    }
    if (targetIndex === -1) {
      reconciled.push({ rootEdgeId: currentRoot, focusPathEdgeIds: desiredPath });
      index = reconciled.length - 1;
    } else {
      const candidate = reconciled[targetIndex];
      const normalisedCandidatePath = normaliseFocusPath(currentRoot, candidate.focusPathEdgeIds ?? []);
      if (!areEdgeArraysEqual(normalisedCandidatePath, candidate.focusPathEdgeIds ?? [])) {
        reconciled[targetIndex] = {
          rootEdgeId: currentRoot,
          focusPathEdgeIds: normalisedCandidatePath
        };
      }
      index = targetIndex;
    }
  }

  return { history: reconciled.map(cloneFocusHistoryEntry), index };
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

const areFocusHistoryEntriesEqual = (
  a: SessionPaneFocusHistoryEntry,
  b: SessionPaneFocusHistoryEntry
): boolean => {
  if (a.rootEdgeId !== b.rootEdgeId) {
    return false;
  }
  return areOptionalEdgeArraysEqual(a.focusPathEdgeIds, b.focusPathEdgeIds);
};

const areFocusHistoriesEqual = (
  a: readonly SessionPaneFocusHistoryEntry[],
  b: readonly SessionPaneFocusHistoryEntry[]
): boolean => {
  if (a === b) {
    return true;
  }
  if (a.length !== b.length) {
    return false;
  }
  for (let index = 0; index < a.length; index += 1) {
    if (!areFocusHistoryEntriesEqual(a[index], b[index])) {
      return false;
    }
  }
  return true;
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
