/**
 * Session state shapes and pure helpers. This module owns cloning, default state generation, and
 * shared utilities for normalising focus history without touching persistence adapters or
 * command side-effects.
 */
import type { EdgeId } from "@thortiq/client-core";

export const SESSION_VERSION = 4;

export interface SessionPaneSelectionRange {
  readonly anchorEdgeId: EdgeId;
  readonly headEdgeId: EdgeId;
}

export interface SessionPaneFocusHistoryEntry {
  readonly rootEdgeId: EdgeId | null;
  readonly focusPathEdgeIds?: readonly EdgeId[];
}

export interface SessionPaneSearchState {
  readonly draft: string;
  readonly submitted: string | null;
  readonly isInputVisible: boolean;
  readonly resultEdgeIds: readonly EdgeId[];
  readonly manuallyExpandedEdgeIds: readonly EdgeId[];
  readonly manuallyCollapsedEdgeIds: readonly EdgeId[];
  readonly appendedEdgeIds: readonly EdgeId[];
}

export interface SessionPaneState {
  readonly paneId: string;
  readonly rootEdgeId: EdgeId | null;
  readonly activeEdgeId: EdgeId | null;
  readonly selectionRange?: SessionPaneSelectionRange;
  readonly collapsedEdgeIds: readonly EdgeId[];
  readonly pendingFocusEdgeId?: EdgeId | null;
  readonly search: SessionPaneSearchState;
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

export const createHomeFocusEntry = (): SessionPaneFocusHistoryEntry => ({
  rootEdgeId: null
});

export const defaultPaneSearchState = (): SessionPaneSearchState => ({
  draft: "",
  submitted: null,
  isInputVisible: false,
  resultEdgeIds: [],
  manuallyExpandedEdgeIds: [],
  manuallyCollapsedEdgeIds: [],
  appendedEdgeIds: []
});

export const clonePaneSearchState = (
  search: SessionPaneSearchState | undefined
): SessionPaneSearchState => {
  const source = search ?? defaultPaneSearchState();
  return {
    draft: typeof source.draft === "string" ? source.draft : "",
    submitted: typeof source.submitted === "string" ? source.submitted : null,
    isInputVisible: Boolean(source.isInputVisible),
    resultEdgeIds: [...source.resultEdgeIds],
    manuallyExpandedEdgeIds: [...source.manuallyExpandedEdgeIds],
    manuallyCollapsedEdgeIds: [...source.manuallyCollapsedEdgeIds],
    appendedEdgeIds: [...source.appendedEdgeIds]
  };
};

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
      search: defaultPaneSearchState(),
      focusPathEdgeIds: undefined,
      focusHistory: [createHomeFocusEntry()],
      focusHistoryIndex: 0
    }
  ]
};

export const defaultSessionState = (): SessionState => cloneState(DEFAULT_STATE);

export const cloneState = (state: SessionState): SessionState => ({
  version: state.version,
  selectedEdgeId: state.selectedEdgeId,
  activePaneId: state.activePaneId,
  panes: state.panes.map(clonePaneState)
});

export const clonePaneState = (pane: SessionPaneState): SessionPaneState => {
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
    search: clonePaneSearchState(pane.search)
  } satisfies SessionPaneState;
};

export const cloneFocusHistoryEntry = (
  entry: SessionPaneFocusHistoryEntry
): SessionPaneFocusHistoryEntry => ({
  rootEdgeId: entry.rootEdgeId,
  ...(entry.focusPathEdgeIds && entry.focusPathEdgeIds.length > 0
    ? { focusPathEdgeIds: [...entry.focusPathEdgeIds] }
    : {})
});

export const cloneFocusHistory = (
  history: readonly SessionPaneFocusHistoryEntry[] | undefined
): SessionPaneFocusHistoryEntry[] => {
  if (!history || history.length === 0) {
    return [createHomeFocusEntry()];
  }
  return history.map(cloneFocusHistoryEntry);
};

export const clampFocusHistoryIndex = (index: number, length: number): number => {
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

export const normaliseFocusPath = (edgeId: EdgeId, pathEdgeIds: ReadonlyArray<EdgeId>): EdgeId[] => {
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

export const appendFocusHistoryEntry = (
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

export const reconcileFocusHistoryForPane = (
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

export const areEdgeArraysEqual = (a: readonly EdgeId[], b: readonly EdgeId[]): boolean => {
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

export const areOptionalEdgeArraysEqual = (
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

export const areFocusHistoryEntriesEqual = (
  a: SessionPaneFocusHistoryEntry,
  b: SessionPaneFocusHistoryEntry
): boolean => {
  if (a.rootEdgeId !== b.rootEdgeId) {
    return false;
  }
  return areOptionalEdgeArraysEqual(a.focusPathEdgeIds, b.focusPathEdgeIds);
};

export const areFocusHistoriesEqual = (
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

export const isSelectionRangeEqual = (
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

export const areSearchStatesEqual = (
  a: SessionPaneSearchState,
  b: SessionPaneSearchState
): boolean => {
  if (a === b) {
    return true;
  }
  if (a.draft !== b.draft) {
    return false;
  }
  if (a.submitted !== b.submitted) {
    return false;
  }
  if (a.isInputVisible !== b.isInputVisible) {
    return false;
  }
  if (!areEdgeArraysEqual(a.resultEdgeIds, b.resultEdgeIds)) {
    return false;
  }
  if (!areEdgeArraysEqual(a.manuallyExpandedEdgeIds, b.manuallyExpandedEdgeIds)) {
    return false;
  }
  if (!areEdgeArraysEqual(a.manuallyCollapsedEdgeIds, b.manuallyCollapsedEdgeIds)) {
    return false;
  }
  if (!areEdgeArraysEqual(a.appendedEdgeIds, b.appendedEdgeIds)) {
    return false;
  }
  return true;
};

export const isEdgeIdValue = (value: unknown): value is EdgeId => typeof value === "string";

export const toEdgeIdOrNull = (value: unknown): EdgeId | null => {
  if (value === null) {
    return null;
  }
  if (isEdgeIdValue(value)) {
    return value;
  }
  return null;
};

export const toEdgeIdOrNullOrUndefined = (value: unknown): EdgeId | null | undefined => {
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

export const toSelectionRange = (value: unknown): SessionPaneSelectionRange | undefined => {
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
