import { ulid } from "ulidx";

import {
  appendFocusHistoryEntry,
  createHomeFocusEntry,
  defaultPaneSearchState,
  normaliseFocusPath,
  type SessionPaneFocusHistoryEntry,
  type SessionPaneState,
  type SessionState
} from "@thortiq/sync-core";
import type { EdgeId } from "../ids";

export interface OpenPaneRightOfOptions {
  readonly focusEdgeId?: EdgeId | null;
  readonly focusPathEdgeIds?: readonly EdgeId[];
  readonly rootEdgeId?: EdgeId | null;
  readonly pendingFocusEdgeId?: EdgeId | null;
}

export interface OpenPaneRightOfResult {
  readonly state: SessionState;
  readonly paneId: string;
}

export const openPaneRightOf = (
  state: SessionState,
  referencePaneId: string,
  options: OpenPaneRightOfOptions = {}
): OpenPaneRightOfResult => {
  const referenceIndex = state.paneOrder.indexOf(referencePaneId);
  const insertIndex = referenceIndex === -1 ? state.paneOrder.length : referenceIndex + 1;
  const paneId = ulid();

  const referencePane = state.panesById[referencePaneId] ?? null;
  const focusEdgeId = options.focusEdgeId ?? null;
  const focusPathEdgeIds =
    options.focusPathEdgeIds && options.focusPathEdgeIds.length > 0
      ? [...options.focusPathEdgeIds]
      : undefined;
  const rootEdgeId = options.rootEdgeId ?? referencePane?.rootEdgeId ?? null;
  const pendingFocusEdgeId = options.pendingFocusEdgeId ?? focusEdgeId ?? null;

  const basePane: SessionPaneState = {
    paneId,
    rootEdgeId,
    activeEdgeId: focusEdgeId,
    collapsedEdgeIds: [],
    pendingFocusEdgeId,
    ...(focusPathEdgeIds ? { focusPathEdgeIds } : {}),
    focusHistory: [createHomeFocusEntry()],
    focusHistoryIndex: 0,
    search: defaultPaneSearchState(),
    widthRatio: null
  };

  let pane = basePane;
  if (rootEdgeId) {
    const historyEntry: SessionPaneFocusHistoryEntry = {
      rootEdgeId,
      ...(focusPathEdgeIds ? { focusPathEdgeIds } : {})
    };
    const { history, index } = appendFocusHistoryEntry(basePane, historyEntry);
    pane = {
      ...basePane,
      focusHistory: history,
      focusHistoryIndex: index
    };
  }

  const paneOrder = state.paneOrder.slice();
  paneOrder.splice(insertIndex, 0, paneId);

  const nextState: SessionState = {
    ...state,
    paneOrder,
    panesById: {
      ...state.panesById,
      [paneId]: pane
    },
    activePaneId: paneId,
    selectedEdgeId: focusEdgeId ?? state.selectedEdgeId
  };

  return {
    state: nextState,
    paneId
  };
};

export interface FocusPaneOptions {
  readonly edgeId: EdgeId;
  readonly focusPathEdgeIds?: readonly EdgeId[];
  readonly makeActive?: boolean;
  readonly pendingFocusEdgeId?: EdgeId | null;
}

export interface FocusPaneResult {
  readonly state: SessionState;
  readonly paneId: string;
  readonly didChange: boolean;
}

export const focusPane = (
  state: SessionState,
  paneId: string,
  options: FocusPaneOptions
): FocusPaneResult => {
  const pane = state.panesById[paneId];
  if (!pane) {
    return { state, paneId, didChange: false };
  }

  const path = normaliseFocusPath(options.edgeId, options.focusPathEdgeIds ?? []);
  const historyEntry: SessionPaneFocusHistoryEntry = {
    rootEdgeId: options.edgeId,
    ...(path.length > 0 ? { focusPathEdgeIds: path } : {})
  };
  const { history, index } = appendFocusHistoryEntry(pane, historyEntry);

  const nextPane: SessionPaneState = {
    ...pane,
    rootEdgeId: options.edgeId,
    focusPathEdgeIds: path.length > 0 ? path : undefined,
    activeEdgeId: options.edgeId,
    pendingFocusEdgeId:
      options.pendingFocusEdgeId !== undefined
        ? options.pendingFocusEdgeId
        : options.edgeId ?? pane.pendingFocusEdgeId ?? null,
    focusHistory: history,
    focusHistoryIndex: index
  };

  if (
    nextPane === pane
    && state.activePaneId === paneId
    && state.selectedEdgeId === (options.makeActive ? options.edgeId : state.selectedEdgeId)
  ) {
    return { state, paneId, didChange: false };
  }

  const nextState: SessionState = {
    ...state,
    panesById: {
      ...state.panesById,
      [paneId]: nextPane
    },
    ...(options.makeActive
      ? {
          activePaneId: paneId,
          selectedEdgeId: options.edgeId
        }
      : {})
  };

  return {
    state: nextState,
    paneId,
    didChange: true
  };
};

export interface EnsureNeighborPaneResult {
  readonly state: SessionState;
  readonly paneId: string;
  readonly created: boolean;
}

export const ensureNeighborPane = (
  state: SessionState,
  referencePaneId: string,
  options: OpenPaneRightOfOptions = {}
): EnsureNeighborPaneResult => {
  const referenceIndex = state.paneOrder.indexOf(referencePaneId);
  if (referenceIndex !== -1) {
    const neighborId = state.paneOrder[referenceIndex + 1];
    if (neighborId && state.panesById[neighborId]) {
      return { state, paneId: neighborId, created: false };
    }
  }
  const { state: nextState, paneId } = openPaneRightOf(state, referencePaneId, options);
  return {
    state: nextState,
    paneId,
    created: true
  };
};

export interface ClosePaneResult {
  readonly state: SessionState;
  readonly paneId: string;
  readonly didClose: boolean;
  readonly nextActivePaneId: string;
}

export const closePane = (state: SessionState, paneId: string): ClosePaneResult => {
  if (state.paneOrder.length <= 1) {
    return {
      state,
      paneId,
      didClose: false,
      nextActivePaneId: state.activePaneId
    };
  }
  const currentIndex = state.paneOrder.indexOf(paneId);
  if (currentIndex === -1) {
    return {
      state,
      paneId,
      didClose: false,
      nextActivePaneId: state.activePaneId
    };
  }

  const nextOrder = state.paneOrder.filter((candidate) => candidate !== paneId);
  if (nextOrder.length === 0) {
    return {
      state,
      paneId,
      didClose: false,
      nextActivePaneId: state.activePaneId
    };
  }

  const panesById = { ...state.panesById };
  const removedPane = panesById[paneId] ?? null;
  delete panesById[paneId];

  const leftNeighborId = currentIndex > 0 ? state.paneOrder[currentIndex - 1] ?? null : null;
  const rightNeighborId =
    currentIndex < state.paneOrder.length - 1 ? state.paneOrder[currentIndex + 1] ?? null : null;
  // Prefer the immediate left neighbour so focus naturally steps back across the row; fall back to
  // the right neighbour (or first remaining pane) when closing the first pane.
  const preferredNeighborId = leftNeighborId ?? rightNeighborId ?? nextOrder[0];

  let nextActivePaneId = state.activePaneId;
  if (nextActivePaneId === paneId || !nextOrder.includes(nextActivePaneId)) {
    nextActivePaneId = preferredNeighborId ?? nextOrder[0];
  }
  if (!nextOrder.includes(nextActivePaneId)) {
    nextActivePaneId = nextOrder[0];
  }

  let nextSelectedEdgeId = state.selectedEdgeId;
  // The global selection tracks the active pane's focused edge; update it whenever we switch panes
  // or when the removed pane owned the tracked edge.
  if (
    state.activePaneId === paneId
    || nextActivePaneId !== state.activePaneId
    || (removedPane && removedPane.activeEdgeId && removedPane.activeEdgeId === state.selectedEdgeId)
  ) {
    nextSelectedEdgeId = panesById[nextActivePaneId]?.activeEdgeId ?? null;
  }

  const nextState: SessionState = {
    ...state,
    paneOrder: nextOrder,
    panesById,
    activePaneId: nextActivePaneId,
    selectedEdgeId: nextSelectedEdgeId
  };

  return {
    state: nextState,
    paneId,
    didClose: true,
    nextActivePaneId
  };
};
