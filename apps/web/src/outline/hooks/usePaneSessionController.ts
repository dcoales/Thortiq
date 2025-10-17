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

export const usePaneSessionController = ({ sessionStore, paneId }: ControllerParams): PaneSessionController => {
  const setSelectionRange = useCallback(
    (range: SelectionRange | null) => {
      sessionStore.update((state) => {
        const paneState = state.panesById[paneId];
        if (!paneState) {
          return state;
        }
        const nextPane =
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
        return {
          ...state,
          panesById:
            nextPane === paneState
              ? state.panesById
              : {
                  ...state.panesById,
                  [paneId]: nextPane
                },
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
        const paneState = state.panesById[paneId];
        if (!paneState) {
          return state;
        }
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
        return {
          ...state,
          panesById:
            nextPane === paneState
              ? state.panesById
              : {
                  ...state.panesById,
                  [paneId]: nextPane
                },
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
        const paneState = state.panesById[paneId];
        if (!paneState) {
          return state;
        }
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
        return {
          ...state,
          panesById:
            nextPane === paneState
              ? state.panesById
              : {
                  ...state.panesById,
                  [paneId]: nextPane
                },
          activePaneId: paneId
        } satisfies SessionState;
      });
    },
    [paneId, sessionStore]
  );

  const setPendingFocusEdgeId = useCallback(
    (edgeId: EdgeId | null) => {
      sessionStore.update((state) => {
        const paneState = state.panesById[paneId];
        if (!paneState) {
          return state;
        }
        if (paneState.pendingFocusEdgeId === edgeId && state.activePaneId === paneId) {
          return state;
        }
        const nextPane: SessionPaneState =
          paneState.pendingFocusEdgeId === edgeId ? paneState : { ...paneState, pendingFocusEdgeId: edgeId };
        if (nextPane === paneState && state.activePaneId === paneId) {
          return state;
        }
        return {
          ...state,
          panesById:
            nextPane === paneState
              ? state.panesById
              : {
                  ...state.panesById,
                  [paneId]: nextPane
                },
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
