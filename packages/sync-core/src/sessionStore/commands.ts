/**
 * High-level session commands. These helpers mutate the session store via the persistence
 * contract while delegating pure calculations to state utilities.
 */
import type { EdgeId } from "@thortiq/client-core";

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
    const pane = state.panesById[paneId];
    if (!pane) {
      return state;
    }
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
    const panesById = {
      ...state.panesById,
      [paneId]: nextPane
    };
    if (state.activePaneId === paneId) {
      return {
        ...state,
        panesById
      } satisfies SessionState;
    }
    return {
      ...state,
      panesById,
      activePaneId: paneId
    } satisfies SessionState;
  });
};

export const clearPaneFocus = (store: SessionStore, paneId: string): void => {
  store.update((state) => {
    const pane = state.panesById[paneId];
    if (!pane) {
      return state;
    }
    if (
      pane.rootEdgeId === null
      && !pane.focusPathEdgeIds
      && pane.focusHistory[pane.focusHistoryIndex]?.rootEdgeId === null
    ) {
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
    return {
      ...state,
      panesById: {
        ...state.panesById,
        [paneId]: nextPane
      }
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
    const pane = state.panesById[paneId];
    if (!pane) {
      return state;
    }
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
    return {
      ...state,
      panesById: {
        ...state.panesById,
        [paneId]: nextPane
      },
      activePaneId: paneId
    } satisfies SessionState;
  });
  return selectedEntry;
};
