/**
 * Reconciliation helpers realign persisted focus metadata with the current document. They scrub
 * stale edge references and ensure histories stay navigable even when mirrors disappear.
 */
import type { EdgeId } from "@thortiq/client-core";

import {
  areEdgeArraysEqual,
  areFocusHistoriesEqual,
  createHomeFocusEntry,
  normaliseFocusPath,
  reconcileFocusHistoryForPane,
  type SessionPaneState,
  type SessionState
} from "./state";
import type { SessionStore } from "./persistence";

export const reconcilePaneFocus = (
  store: SessionStore,
  availableEdgeIds: ReadonlySet<EdgeId>
): void => {
  store.update((state) => {
    if (availableEdgeIds.size === 0) {
      return dropAllFocus(state);
    }

    let mutated = false;
    let panesById: Record<string, SessionPaneState> | null = null;

    const ensureMutable = () => {
      if (!panesById) {
        panesById = { ...state.panesById };
      }
      return panesById;
    };

    for (const [paneId, pane] of Object.entries(state.panesById)) {
      if (!pane) {
        continue;
      }
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
        ensureMutable()[paneId] = {
          ...interimPane,
          focusHistory: history,
          focusHistoryIndex: index
        } satisfies SessionPaneState;
      }
    }

    if (!mutated) {
      return state;
    }

    return {
      ...state,
      panesById: panesById ?? state.panesById
    } satisfies SessionState;
  });
};

const dropAllFocus = (state: SessionState): SessionState => {
  let mutated = false;
  let panesById: Record<string, SessionPaneState> | null = null;

  const ensureMutable = () => {
    if (!panesById) {
      panesById = { ...state.panesById };
    }
    return panesById;
  };

  Object.entries(state.panesById).forEach(([paneId, pane]) => {
    if (!pane) {
      return;
    }
    if (
      pane.rootEdgeId === null
      && !pane.focusPathEdgeIds
      && pane.focusHistory.length === 1
      && pane.focusHistory[0]?.rootEdgeId === null
      && pane.focusHistoryIndex === 0
    ) {
      return;
    }
    mutated = true;
    ensureMutable()[paneId] = {
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
    panesById: panesById ?? state.panesById
  } satisfies SessionState;
};
