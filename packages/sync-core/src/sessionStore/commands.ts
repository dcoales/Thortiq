/**
 * High-level session commands. These helpers mutate the session store via the persistence
 * contract while delegating pure calculations to state utilities.
 */
import type { EdgeId, NodeId } from "@thortiq/client-core";

import {
  appendFocusHistoryEntry,
  areFocusHistoriesEqual,
  areOptionalEdgeArraysEqual,
  cloneFocusHistoryEntry,
  createHomeFocusEntry,
  normaliseFocusPath,
  type SessionPaneFocusHistoryEntry,
  type SessionPaneState,
  type SessionState
} from "./state";
import type { SessionStore } from "./persistence";

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
    const paneIndex = findPaneIndex(state, paneId);
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
    const panes = state.panes.map((current, idx) => (idx === paneIndex ? nextPane : current));
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
    const paneIndex = findPaneIndex(state, paneId);
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
    const panes = state.panes.map((current, idx) => (idx === paneIndex ? nextPane : current));
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
    const paneIndex = findPaneIndex(state, paneId);
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
    const panes = state.panes.map((current, idx) => (idx === paneIndex ? nextPane : current));
    return {
      ...state,
      panes,
      activePaneId: paneId
    } satisfies SessionState;
  });
  return selectedEntry;
};

const findPaneIndex = (state: SessionState, paneId: string): number => state.panes.findIndex((pane) => pane.paneId === paneId);

// Search commands

export const setSearchQuery = (
  store: SessionStore,
  paneId: string,
  query: string,
  matchingNodeIds: readonly NodeId[],
  resultNodeIds: readonly NodeId[]
): void => {
  store.update((state) => {
    const paneIndex = findPaneIndex(state, paneId);
    if (paneIndex === -1) {
      return state;
    }
    const pane = state.panes[paneIndex];
    if (pane.searchQuery === query && 
        JSON.stringify(pane.searchMatchingNodeIds) === JSON.stringify(matchingNodeIds) &&
        JSON.stringify(pane.searchResultNodeIds) === JSON.stringify(resultNodeIds)) {
      return state;
    }
    const nextPane: SessionPaneState = {
      ...pane,
      searchQuery: query,
      searchMatchingNodeIds: [...matchingNodeIds],
      searchResultNodeIds: [...resultNodeIds],
      searchActive: true,
      searchFrozen: false
    };
    const panes = state.panes.map((current, idx) => (idx === paneIndex ? nextPane : current));
    return {
      ...state,
      panes
    } satisfies SessionState;
  });
};

export const toggleSearchActive = (store: SessionStore, paneId: string): void => {
  store.update((state) => {
    const paneIndex = findPaneIndex(state, paneId);
    if (paneIndex === -1) {
      return state;
    }
    const pane = state.panes[paneIndex];
    const nextPane: SessionPaneState = {
      ...pane,
      searchActive: !pane.searchActive,
      searchFrozen: false
    };
    const panes = state.panes.map((current, idx) => (idx === paneIndex ? nextPane : current));
    return {
      ...state,
      panes
    } satisfies SessionState;
  });
};

export const freezeSearchResults = (store: SessionStore, paneId: string): void => {
  store.update((state) => {
    const paneIndex = findPaneIndex(state, paneId);
    if (paneIndex === -1) {
      return state;
    }
    const pane = state.panes[paneIndex];
    if (pane.searchFrozen) {
      return state;
    }
    const nextPane: SessionPaneState = {
      ...pane,
      searchFrozen: true
    };
    const panes = state.panes.map((current, idx) => (idx === paneIndex ? nextPane : current));
    return {
      ...state,
      panes
    } satisfies SessionState;
  });
};

export const clearSearch = (store: SessionStore, paneId: string): void => {
  store.update((state) => {
    const paneIndex = findPaneIndex(state, paneId);
    if (paneIndex === -1) {
      return state;
    }
    const pane = state.panes[paneIndex];
    if (!pane.searchQuery && !pane.searchMatchingNodeIds && !pane.searchResultNodeIds && !pane.searchActive) {
      return state;
    }
    const nextPane: SessionPaneState = {
      ...pane,
      searchQuery: undefined,
      searchMatchingNodeIds: undefined,
      searchResultNodeIds: undefined,
      searchActive: false,
      searchFrozen: false
    };
    const panes = state.panes.map((current, idx) => (idx === paneIndex ? nextPane : current));
    return {
      ...state,
      panes
    } satisfies SessionState;
  });
};
