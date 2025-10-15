import { useCallback } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";

import { ensureNeighborPane, focusPane, openPaneRightOf, type EdgeId } from "@thortiq/client-core";
import { defaultPaneSearchState } from "@thortiq/sync-core";
import type { SessionPaneState, SessionState } from "@thortiq/sync-core";

import { useOutlineSessionStore } from "./OutlineProvider";

export interface WikiLinkActivationPayload {
  readonly event: ReactMouseEvent<HTMLButtonElement>;
  readonly targetEdgeId: EdgeId;
  readonly pathEdgeIds: readonly EdgeId[];
}

export interface BulletActivationPayload {
  readonly event: ReactMouseEvent<HTMLButtonElement>;
  readonly edgeId: EdgeId;
  readonly pathEdgeIds: readonly EdgeId[];
}

export interface UsePaneOpenerResult {
  handleWikiLinkActivate(payload: WikiLinkActivationPayload): boolean;
  handleBulletActivate(payload: BulletActivationPayload): boolean;
  openPaneForEdge(targetEdgeId: EdgeId, pathEdgeIds: readonly EdgeId[]): string | null;
  focusNeighborPane(targetEdgeId: EdgeId, pathEdgeIds: readonly EdgeId[]): string | null;
}

export const usePaneOpener = (paneId: string): UsePaneOpenerResult => {
  const sessionStore = useOutlineSessionStore();

  const clearPaneSearch = useCallback((state: SessionState): SessionState => {
    const existingPane = state.panesById[paneId];
    if (!existingPane) {
      return state;
    }
    const currentSearch = existingPane.search ?? defaultPaneSearchState();
    if (
      currentSearch.draft === ""
      && currentSearch.submitted === null
      && currentSearch.resultEdgeIds.length === 0
      && currentSearch.manuallyExpandedEdgeIds.length === 0
      && currentSearch.manuallyCollapsedEdgeIds.length === 0
      && currentSearch.appendedEdgeIds.length === 0
    ) {
      return state;
    }
    const clearedSearch = {
      ...defaultPaneSearchState(),
      isInputVisible: currentSearch.isInputVisible
    };
    const nextPane: SessionPaneState = {
      ...existingPane,
      search: clearedSearch
    };
    return {
      ...state,
      panesById: {
        ...state.panesById,
        [paneId]: nextPane
      }
    };
  }, [paneId]);

  const openPaneForEdge = useCallback(
    (targetEdgeId: EdgeId, pathEdgeIds: readonly EdgeId[]): string | null => {
      let createdPaneId: string | null = null;
      sessionStore.update((state) => {
        const originPane = state.panesById[paneId];
        if (!originPane) {
          return state;
        }
        const result = openPaneRightOf(state, paneId, {
          focusEdgeId: targetEdgeId,
          focusPathEdgeIds: pathEdgeIds
        });
        createdPaneId = result.paneId;
        return clearPaneSearch(result.state);
      });
      return createdPaneId;
    },
    [clearPaneSearch, paneId, sessionStore]
  );

  const focusNeighborPane = useCallback(
    (targetEdgeId: EdgeId, pathEdgeIds: readonly EdgeId[]): string | null => {
      let neighborPaneId: string | null = null;
      sessionStore.update((state) => {
        const ensureResult = ensureNeighborPane(state, paneId);
        neighborPaneId = ensureResult.paneId;
        const focusResult = focusPane(ensureResult.state, ensureResult.paneId, {
          edgeId: targetEdgeId,
          focusPathEdgeIds: pathEdgeIds,
          makeActive: true,
          pendingFocusEdgeId: targetEdgeId
        });
        return focusResult.state;
      });
      return neighborPaneId;
    },
    [paneId, sessionStore]
  );

  const handleWikiLinkActivate = useCallback(
    ({ event, targetEdgeId, pathEdgeIds }: WikiLinkActivationPayload): boolean => {
      if (event.metaKey || event.ctrlKey) {
        openPaneForEdge(targetEdgeId, pathEdgeIds);
        return true;
      }
      if (event.shiftKey) {
        focusNeighborPane(targetEdgeId, pathEdgeIds);
        return true;
      }
      return false;
    },
    [focusNeighborPane, openPaneForEdge]
  );

  const handleBulletActivate = useCallback(
    ({ event, edgeId, pathEdgeIds }: BulletActivationPayload): boolean => {
      if (event.metaKey || event.ctrlKey) {
        openPaneForEdge(edgeId, pathEdgeIds);
        return true;
      }
      if (event.shiftKey) {
        focusNeighborPane(edgeId, pathEdgeIds);
        return true;
      }
      return false;
    },
    [focusNeighborPane, openPaneForEdge]
  );

  return {
    handleWikiLinkActivate,
    handleBulletActivate,
    openPaneForEdge,
    focusNeighborPane
  };
};
