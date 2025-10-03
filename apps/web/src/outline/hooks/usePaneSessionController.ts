/**
 * Exposes memoised helpers for mutating a single pane's session state while keeping React
 * components focused on rendering. Every mutation keeps the originating pane active and avoids
 * redundant writes so shared undo history remains stable, aligning with AGENTS.md guidance.
 */
import { useCallback } from "react";

import type { EdgeId } from "@thortiq/client-core";
import type { SessionPaneState, SessionState, SessionStore } from "@thortiq/sync-core";

import type { SelectionRange } from "../types";

export interface SetActiveEdgeOptions {
  readonly preserveRange?: boolean;
}

export interface PaneSessionController {
  readonly setSelectionRange: (range: SelectionRange | null) => void;
  readonly setActiveEdge: (edgeId: EdgeId | null, options?: SetActiveEdgeOptions) => void;
  readonly setCollapsed: (edgeId: EdgeId, collapsed: boolean) => void;
  readonly setPendingFocusEdgeId: (edgeId: EdgeId | null) => void;
}

interface ControllerParams {
  readonly sessionStore: SessionStore;
  readonly paneId: string;
}

const findPaneIndex = (state: SessionState, paneId: string): number =>
  state.panes.findIndex((paneState) => paneState.paneId === paneId);

export const usePaneSessionController = ({ sessionStore, paneId }: ControllerParams): PaneSessionController => {
  const setSelectionRange = useCallback(
    (range: SelectionRange | null) => {
      sessionStore.update((state) => {
        const index = findPaneIndex(state, paneId);
        if (index === -1) {
          return state;
        }
        const paneState = state.panes[index];
        const nextPane: SessionPaneState =
          range === null
            ? paneState.selectionRange === undefined
              ? paneState
              : { ...paneState, selectionRange: undefined }
            : {
                ...paneState,
                selectionRange: {
                  anchorEdgeId: range.anchorEdgeId,
                  headEdgeId: range.focusEdgeId
                }
              };
        if (nextPane === paneState && state.activePaneId === paneId) {
          return state;
        }
        const panes = nextPane === paneState
          ? state.panes
          : state.panes.map((candidate, candidateIndex) => (candidateIndex === index ? nextPane : candidate));
        if (state.activePaneId === paneId && panes === state.panes) {
          return state;
        }
        return {
          ...state,
          panes,
          activePaneId: paneId
        } satisfies SessionState;
      });
    },
    [paneId, sessionStore]
  );

  const setActiveEdge = useCallback(
    (edgeId: EdgeId | null, options: SetActiveEdgeOptions = {}) => {
      const { preserveRange = false } = options;
      sessionStore.update((state) => {
        const index = findPaneIndex(state, paneId);
        if (index === -1) {
          return state;
        }
        const paneState = state.panes[index];
        let nextPane: SessionPaneState;
        if (preserveRange) {
          nextPane = paneState.activeEdgeId === edgeId ? paneState : { ...paneState, activeEdgeId: edgeId };
        } else if (paneState.activeEdgeId === edgeId && paneState.selectionRange === undefined) {
          nextPane = paneState;
        } else {
          nextPane = { ...paneState, activeEdgeId: edgeId, selectionRange: undefined };
        }
        const nextSelectedEdgeId = edgeId ?? null;
        if (
          nextPane === paneState
          && state.activePaneId === paneId
          && state.selectedEdgeId === nextSelectedEdgeId
        ) {
          return state;
        }
        const panes = nextPane === paneState
          ? state.panes
          : state.panes.map((candidate, candidateIndex) => (candidateIndex === index ? nextPane : candidate));
        return {
          ...state,
          panes,
          activePaneId: paneId,
          selectedEdgeId: nextSelectedEdgeId
        } satisfies SessionState;
      });
    },
    [paneId, sessionStore]
  );

  const setCollapsed = useCallback(
    (edgeId: EdgeId, collapsed: boolean) => {
      sessionStore.update((state) => {
        const index = findPaneIndex(state, paneId);
        if (index === -1) {
          return state;
        }
        const paneState = state.panes[index];
        const hasEdge = paneState.collapsedEdgeIds.includes(edgeId);
        if ((collapsed && hasEdge) || (!collapsed && !hasEdge)) {
          if (state.activePaneId === paneId) {
            return state;
          }
          return {
            ...state,
            activePaneId: paneId
          } satisfies SessionState;
        }
        const collapsedEdgeIds = collapsed
          ? [...paneState.collapsedEdgeIds, edgeId]
          : paneState.collapsedEdgeIds.filter((candidate) => candidate !== edgeId);
        const nextPane: SessionPaneState = {
          ...paneState,
          collapsedEdgeIds
        };
        const panes = state.panes.map((candidate, candidateIndex) =>
          candidateIndex === index ? nextPane : candidate
        );
        return {
          ...state,
          panes,
          activePaneId: paneId
        } satisfies SessionState;
      });
    },
    [paneId, sessionStore]
  );

  const setPendingFocusEdgeId = useCallback(
    (edgeId: EdgeId | null) => {
      sessionStore.update((state) => {
        const index = findPaneIndex(state, paneId);
        if (index === -1) {
          return state;
        }
        const paneState = state.panes[index];
        if (paneState.pendingFocusEdgeId === edgeId && state.activePaneId === paneId) {
          return state;
        }
        const nextPane: SessionPaneState =
          paneState.pendingFocusEdgeId === edgeId ? paneState : { ...paneState, pendingFocusEdgeId: edgeId };
        if (nextPane === paneState && state.activePaneId === paneId) {
          return state;
        }
        const panes = nextPane === paneState
          ? state.panes
          : state.panes.map((candidate, candidateIndex) => (candidateIndex === index ? nextPane : candidate));
        return {
          ...state,
          panes,
          activePaneId: paneId
        } satisfies SessionState;
      });
    },
    [paneId, sessionStore]
  );

  return {
    setSelectionRange,
    setActiveEdge,
    setCollapsed,
    setPendingFocusEdgeId
  };
};
