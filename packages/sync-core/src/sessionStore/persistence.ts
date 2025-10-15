/**
 * Persistence wiring for the session store. It provides the storage adapter contract and ensures
 * serialised payloads upgrade or fall back safely when schemas evolve.
 */
import {
  SESSION_VERSION,
  cloneFocusHistory,
  clonePaneState,
  clonePaneMap,
  cloneState,
  clampFocusHistoryIndex,
  defaultSessionState,
  areEdgeArraysEqual,
  areFocusHistoriesEqual,
  areOptionalEdgeArraysEqual,
  areSearchStatesEqual,
  isEdgeIdValue,
  isSelectionRangeEqual,
  clonePaneSearchState,
  toEdgeIdOrNull,
  toEdgeIdOrNullOrUndefined,
  toSelectionRange,
  type SessionPaneFocusHistoryEntry,
  type SessionPaneState,
  type SessionPaneSearchState,
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
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return cloneState(fallback);
    }
    const candidate = parsed as Record<string, unknown>;
    const version = typeof candidate.version === "number" ? candidate.version : undefined;
    if (version === SESSION_VERSION) {
      return normaliseCurrentVersionState(candidate as Partial<SessionState>, fallback);
    }
    if (version === 4) {
      return migrateStateFromV4(candidate, fallback);
    }
    if (version === 3) {
      return migrateStateFromV3(candidate, fallback);
    }
    return cloneState(fallback);
  } catch (_error) {
    return cloneState(fallback);
  }
};

const normaliseCurrentVersionState = (
  parsed: Partial<SessionState>,
  fallback: SessionState
): SessionState => {
  const panesById = normalisePaneMapFromRecord(parsed.panesById, fallback);
  const paneOrder = normalisePaneOrder(parsed.paneOrder, panesById, fallback);
  const selectedEdgeId =
    typeof parsed.selectedEdgeId === "string" || parsed.selectedEdgeId === null
      ? parsed.selectedEdgeId ?? null
      : null;

  return {
    version: SESSION_VERSION,
    selectedEdgeId,
    activePaneId: normaliseActivePaneId(
      parsed.activePaneId,
      paneOrder,
      panesById,
      fallback.activePaneId
    ),
    paneOrder,
    panesById
  };
};

const migrateStateFromV4 = (
  parsed: Record<string, unknown>,
  fallback: SessionState
): SessionState => {
  const legacy = parsed as Record<string, unknown> & { panes?: unknown };
  const { paneOrder, panesById } = buildPaneCollectionFromArray(legacy.panes, fallback);
  const selectedEdgeId =
    typeof legacy.selectedEdgeId === "string" || legacy.selectedEdgeId === null
      ? (legacy.selectedEdgeId ?? null)
      : null;

  return {
    version: SESSION_VERSION,
    selectedEdgeId,
    activePaneId: normaliseActivePaneId(
      legacy.activePaneId,
      paneOrder,
      panesById,
      fallback.activePaneId
    ),
    paneOrder,
    panesById
  };
};

const migrateStateFromV3 = (
  parsed: Record<string, unknown>,
  fallback: SessionState
): SessionState => {
  const legacy = parsed as Record<string, unknown> & { panes?: unknown };
  const { paneOrder, panesById } = buildPaneCollectionFromArray(
    legacy.panes,
    fallback,
    (pane) => {
      if (!pane) {
        return undefined;
      }
      const value = pane["quickFilter"];
      return typeof value === "string" ? value : undefined;
    }
  );
  const selectedEdgeId =
    typeof legacy.selectedEdgeId === "string" || legacy.selectedEdgeId === null
      ? (legacy.selectedEdgeId ?? null)
      : null;

  return {
    version: SESSION_VERSION,
    selectedEdgeId,
    activePaneId: normaliseActivePaneId(
      legacy.activePaneId,
      paneOrder,
      panesById,
      fallback.activePaneId
    ),
    paneOrder,
    panesById
  };
};

const buildPaneCollectionFromArray = (
  rawPanes: unknown,
  fallback: SessionState,
  legacyQuickFilterResolver?: (pane: Record<string, unknown> | null) => string | undefined
): { paneOrder: string[]; panesById: Record<string, SessionPaneState> } => {
  const seen = new Set<string>();
  const panes: SessionPaneState[] = [];
  const fallbackOrder = fallback.paneOrder;
  const fallbackByOrder = fallbackOrder.map((paneId) => fallback.panesById[paneId]);

  if (Array.isArray(rawPanes)) {
    rawPanes.forEach((pane, index) => {
      const record =
        typeof pane === "object" && pane !== null ? (pane as Record<string, unknown>) : null;
      const paneId =
        record && typeof record.paneId === "string" ? (record.paneId as string) : undefined;
      const fallbackById = paneId ? fallback.panesById[paneId] : undefined;
      const fallbackCandidate = fallbackById ?? fallbackByOrder[index];
      const quickFilter = legacyQuickFilterResolver
        ? legacyQuickFilterResolver(record)
        : undefined;
      const normalised = normalisePane(pane, fallbackCandidate, quickFilter);
      if (normalised && !seen.has(normalised.paneId)) {
        seen.add(normalised.paneId);
        panes.push(normalised);
      }
    });
  }

  if (panes.length === 0) {
    for (const paneId of fallbackOrder) {
      const fallbackPane = fallback.panesById[paneId];
      if (!fallbackPane || seen.has(paneId)) {
        continue;
      }
      seen.add(paneId);
      panes.push(clonePaneState(fallbackPane));
    }
  }

  if (panes.length === 0) {
    for (const fallbackPane of Object.values(fallback.panesById)) {
      if (!fallbackPane || seen.has(fallbackPane.paneId)) {
        continue;
      }
      seen.add(fallbackPane.paneId);
      panes.push(clonePaneState(fallbackPane));
    }
  }

  if (panes.length === 0) {
    const defaultState = defaultSessionState();
    return {
      paneOrder: [...defaultState.paneOrder],
      panesById: clonePaneMap(defaultState.panesById)
    };
  }

  const paneOrder: string[] = [];
  const panesById: Record<string, SessionPaneState> = {};

  for (const pane of panes) {
    if (panesById[pane.paneId]) {
      continue;
    }
    panesById[pane.paneId] = pane;
    paneOrder.push(pane.paneId);
  }

  return { paneOrder, panesById };
};

const normalisePaneMapFromRecord = (
  raw: unknown,
  fallback: SessionState
): Record<string, SessionPaneState> => {
  if (typeof raw !== "object" || raw === null) {
    return clonePaneMap(fallback.panesById);
  }
  const candidate = raw as Record<string, unknown>;
  const panesById: Record<string, SessionPaneState> = {};

  for (const [paneId, paneValue] of Object.entries(candidate)) {
    if (typeof paneId !== "string") {
      continue;
    }
    const fallbackPane = fallback.panesById[paneId];
    const normalised = normalisePane(paneValue, fallbackPane);
    if (normalised) {
      panesById[paneId] = normalised;
    }
  }

  if (Object.keys(panesById).length === 0) {
    return clonePaneMap(fallback.panesById);
  }

  return panesById;
};

const normalisePaneOrder = (
  raw: unknown,
  panesById: Record<string, SessionPaneState>,
  fallback: SessionState
): string[] => {
  const order: string[] = [];
  const seen = new Set<string>();

  if (Array.isArray(raw)) {
    raw.forEach((value) => {
      if (typeof value !== "string") {
        return;
      }
      if (!panesById[value] || seen.has(value)) {
        return;
      }
      seen.add(value);
      order.push(value);
    });
  }

  for (const paneId of fallback.paneOrder) {
    if (!panesById[paneId] || seen.has(paneId)) {
      continue;
    }
    seen.add(paneId);
    order.push(paneId);
  }

  for (const paneId of Object.keys(panesById)) {
    if (seen.has(paneId)) {
      continue;
    }
    seen.add(paneId);
    order.push(paneId);
  }

  if (order.length === 0) {
    const fallbackFirst = fallback.paneOrder.find((paneId) => Boolean(panesById[paneId]));
    if (fallbackFirst) {
      order.push(fallbackFirst);
    } else {
      const first = Object.keys(panesById)[0];
      if (first) {
        order.push(first);
      }
    }
  }

  return order;
};

const normaliseActivePaneId = (
  value: unknown,
  paneOrder: readonly string[],
  panesById: Record<string, SessionPaneState>,
  fallback: string
): string => {
  if (typeof value === "string" && panesById[value]) {
    return value;
  }
  for (const paneId of paneOrder) {
    if (panesById[paneId]) {
      return paneId;
    }
  }
  if (panesById[fallback]) {
    return fallback;
  }
  const first = Object.keys(panesById)[0];
  if (first) {
    return first;
  }
  return fallback;
};

const arePaneStatesEqual = (a: SessionPaneState, b: SessionPaneState): boolean => {
  if (a === b) {
    return true;
  }
  return (
    a.paneId === b.paneId
    && a.rootEdgeId === b.rootEdgeId
    && a.activeEdgeId === b.activeEdgeId
    && a.pendingFocusEdgeId === b.pendingFocusEdgeId
    && a.focusHistoryIndex === b.focusHistoryIndex
    && areFocusHistoriesEqual(a.focusHistory, b.focusHistory)
    && areOptionalEdgeArraysEqual(a.focusPathEdgeIds, b.focusPathEdgeIds)
    && isSelectionRangeEqual(a.selectionRange, b.selectionRange)
    && areEdgeArraysEqual(a.collapsedEdgeIds, b.collapsedEdgeIds)
    && areSearchStatesEqual(a.search, b.search)
  );
};

const areStringArraysEqual = (a: readonly string[], b: readonly string[]): boolean => {
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
  if (!areStringArraysEqual(a.paneOrder, b.paneOrder)) {
    return false;
  }
  const aKeys = Object.keys(a.panesById);
  const bKeys = Object.keys(b.panesById);
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  for (const key of aKeys) {
    if (!(key in b.panesById)) {
      return false;
    }
  }
  for (const paneId of a.paneOrder) {
    const paneA = a.panesById[paneId];
    const paneB = b.panesById[paneId];
    if (!paneA || !paneB) {
      return false;
    }
    if (!arePaneStatesEqual(paneA, paneB)) {
      return false;
    }
  }
  for (const paneId of aKeys) {
    if (a.paneOrder.includes(paneId)) {
      continue;
    }
    const paneA = a.panesById[paneId];
    const paneB = b.panesById[paneId];
    if (!paneA || !paneB) {
      return false;
    }
    if (!arePaneStatesEqual(paneA, paneB)) {
      return false;
    }
  }
  return true;
};

const normalisePane = (
  rawPane: unknown,
  fallback: SessionPaneState | undefined,
  legacyQuickFilter?: string
): SessionPaneState | null => {
  if (typeof rawPane !== "object" || rawPane === null) {
    if (!fallback) {
      return null;
    }
    const clone = clonePaneState(fallback);
    return {
      ...clone,
      search: normalisePaneSearch(undefined, clone.search, legacyQuickFilter)
    };
  }
  const candidate = rawPane as Record<string, unknown>;
  const paneId = candidate.paneId;
  if (typeof paneId !== "string") {
    if (!fallback) {
      return null;
    }
    const clone = clonePaneState(fallback);
    return {
      ...clone,
      search: normalisePaneSearch(undefined, clone.search, legacyQuickFilter)
    };
  }

  const rootEdgeId = toEdgeIdOrNull(candidate.rootEdgeId);
  const activeEdgeId = toEdgeIdOrNull(candidate.activeEdgeId);
  const selectionRange = toSelectionRange(candidate.selectionRange) ?? fallback?.selectionRange;
  const collapsedEdgeIds = Array.isArray(candidate.collapsedEdgeIds)
    ? candidate.collapsedEdgeIds.filter(isEdgeIdValue)
    : fallback?.collapsedEdgeIds ?? [];
  const pendingFocusEdgeId = toEdgeIdOrNullOrUndefined(candidate.pendingFocusEdgeId);
  const focusPathEdgeIds = Array.isArray(candidate.focusPathEdgeIds)
    ? candidate.focusPathEdgeIds.filter(isEdgeIdValue)
    : fallback?.focusPathEdgeIds;
  const focusHistory = normaliseFocusHistory(candidate.focusHistory, fallback?.focusHistory);
  const rawHistoryIndex =
    typeof candidate.focusHistoryIndex === "number"
      ? candidate.focusHistoryIndex
      : fallback?.focusHistoryIndex ?? focusHistory.length - 1;
  const focusHistoryIndex = clampFocusHistoryIndex(rawHistoryIndex, focusHistory.length);
  const search = normalisePaneSearch(candidate.search, fallback?.search, legacyQuickFilter);

  return {
    paneId,
    rootEdgeId,
    activeEdgeId,
    collapsedEdgeIds: [...collapsedEdgeIds],
    focusHistory,
    focusHistoryIndex,
    search,
    ...(focusPathEdgeIds && focusPathEdgeIds.length > 0
      ? { focusPathEdgeIds: [...focusPathEdgeIds] }
      : {}),
    ...(selectionRange ? { selectionRange: { ...selectionRange } } : {}),
    ...(pendingFocusEdgeId !== undefined
      ? { pendingFocusEdgeId }
      : fallback?.pendingFocusEdgeId !== undefined
        ? { pendingFocusEdgeId: fallback.pendingFocusEdgeId }
        : {})
  };
};

const normalisePaneSearch = (
  rawSearch: unknown,
  fallback: SessionPaneSearchState | undefined,
  legacyQuickFilter?: string
): SessionPaneSearchState => {
  const base = clonePaneSearchState(fallback);
  if (typeof rawSearch !== "object" || rawSearch === null) {
    if (typeof legacyQuickFilter === "string") {
      const legacyValue = legacyQuickFilter;
      const trimmed = legacyValue.trim();
      return {
        ...base,
        draft: legacyValue,
        submitted: trimmed.length > 0 ? legacyValue : null
      };
    }
    return base;
  }

  const candidate = rawSearch as Record<string, unknown>;
  let draft =
    typeof candidate.draft === "string"
      ? candidate.draft
      : typeof base.draft === "string"
        ? base.draft
        : "";
  let submitted: string | null;
  if (candidate.submitted === null) {
    submitted = null;
  } else if (typeof candidate.submitted === "string") {
    submitted = candidate.submitted;
  } else {
    submitted = base.submitted;
  }
  const isInputVisible =
    typeof candidate.isInputVisible === "boolean" ? candidate.isInputVisible : base.isInputVisible;
  const resultEdgeIds = Array.isArray(candidate.resultEdgeIds)
    ? candidate.resultEdgeIds.filter(isEdgeIdValue)
    : base.resultEdgeIds;
  const manuallyExpandedEdgeIds = Array.isArray(candidate.manuallyExpandedEdgeIds)
    ? candidate.manuallyExpandedEdgeIds.filter(isEdgeIdValue)
    : base.manuallyExpandedEdgeIds;
  const manuallyCollapsedEdgeIds = Array.isArray(candidate.manuallyCollapsedEdgeIds)
    ? candidate.manuallyCollapsedEdgeIds.filter(isEdgeIdValue)
    : base.manuallyCollapsedEdgeIds;
  const appendedEdgeIds = Array.isArray(candidate.appendedEdgeIds)
    ? candidate.appendedEdgeIds.filter(isEdgeIdValue)
    : base.appendedEdgeIds;

  if (typeof legacyQuickFilter === "string" && draft === "" && (submitted === null || submitted === "")) {
    const legacyValue = legacyQuickFilter;
    const trimmed = legacyValue.trim();
    draft = legacyValue;
    submitted = trimmed.length > 0 ? legacyValue : null;
  }

  return {
    draft,
    submitted,
    isInputVisible,
    resultEdgeIds: [...resultEdgeIds],
    manuallyExpandedEdgeIds: [...manuallyExpandedEdgeIds],
    manuallyCollapsedEdgeIds: [...manuallyCollapsedEdgeIds],
    appendedEdgeIds: [...appendedEdgeIds]
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
