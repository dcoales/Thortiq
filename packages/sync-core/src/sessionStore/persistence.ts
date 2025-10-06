/**
 * Persistence wiring for the session store. It provides the storage adapter contract and ensures
 * serialised payloads upgrade or fall back safely when schemas evolve.
 */
import {
  SESSION_VERSION,
  cloneFocusHistory,
  clonePaneState,
  cloneSearchState,
  cloneState,
  clampFocusHistoryIndex,
  defaultSessionState,
  areEdgeArraysEqual,
  areFocusHistoriesEqual,
  areOptionalEdgeArraysEqual,
  areSearchStatesEqual,
  isEdgeIdValue,
  isSelectionRangeEqual,
  toEdgeIdOrNull,
  toEdgeIdOrNullOrUndefined,
  toSelectionRange,
  type SessionPaneSearchState,
  type SessionPaneFocusHistoryEntry,
  type SessionPaneState,
  type SessionState
} from "./state";
import type { EdgeId } from "@thortiq/client-core";

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

export interface CreateSessionStoreOptions {
  readonly initialState?: SessionState;
}

export const createSessionStore = (
  adapter: SessionStorageAdapter,
  options: CreateSessionStoreOptions = {}
): SessionStore => {
  let state = normaliseState(adapter.read(), options.initialState ?? defaultSessionState());
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
  const searchState = normaliseSearchState(candidate.search, fallback?.search);

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
    ...(quickFilter !== undefined ? { quickFilter } : {}),
    ...(searchState ? { search: searchState } : {})
  };
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

const normaliseSearchState = (
  raw: unknown,
  fallback: SessionPaneSearchState | undefined
): SessionPaneSearchState | undefined => {
  if (typeof raw !== "object" || raw === null) {
    return fallback ? cloneSearchState(fallback) : undefined;
  }
  const candidate = raw as Record<string, unknown>;
  const isOpen = typeof candidate.isOpen === "boolean" ? candidate.isOpen : fallback?.isOpen ?? false;
  const draft = typeof candidate.draft === "string" ? candidate.draft : fallback?.draft ?? "";
  const appliedQuery = typeof candidate.appliedQuery === "string"
    ? candidate.appliedQuery
    : fallback?.appliedQuery;
  const matchedEdgeIds = Array.isArray(candidate.matchedEdgeIds)
    ? candidate.matchedEdgeIds.filter(isEdgeIdValue)
    : fallback?.matchedEdgeIds ?? [];
  const visibleEdgeIds = Array.isArray(candidate.visibleEdgeIds)
    ? candidate.visibleEdgeIds.filter(isEdgeIdValue)
    : fallback?.visibleEdgeIds ?? [];
  const partialEdgeIds = Array.isArray(candidate.partialEdgeIds)
    ? candidate.partialEdgeIds.filter(isEdgeIdValue)
    : fallback?.partialEdgeIds ?? [];
  const stickyEdgeIds = Array.isArray(candidate.stickyEdgeIds)
    ? candidate.stickyEdgeIds.filter(isEdgeIdValue)
    : fallback?.stickyEdgeIds ?? [];

  const result: SessionPaneSearchState = {
    isOpen,
    draft,
    matchedEdgeIds: [...matchedEdgeIds],
    visibleEdgeIds: [...visibleEdgeIds],
    partialEdgeIds: [...partialEdgeIds],
    stickyEdgeIds: [...stickyEdgeIds],
    ...(appliedQuery !== undefined ? { appliedQuery } : {})
  } satisfies SessionPaneSearchState;

  const hasState =
    isOpen
    || draft.length > 0
    || appliedQuery !== undefined
    || matchedEdgeIds.length > 0
    || visibleEdgeIds.length > 0
    || partialEdgeIds.length > 0
    || stickyEdgeIds.length > 0;

  return hasState ? result : undefined;
};

const normaliseFocusHistoryEntry = (
  value: unknown
): SessionPaneFocusHistoryEntry | null => {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const rawRoot = candidate.rootEdgeId;
  const rootEdgeId = rawRoot === null ? null : isEdgeIdValue(rawRoot) ? (rawRoot as EdgeId) : undefined;
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
      && areSearchStatesEqual(pane.search, other.search)
    );
  });
};

export const createMemorySessionStorageAdapter = (
  initialValue: string | null = null
): SessionStorageAdapter => {
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
