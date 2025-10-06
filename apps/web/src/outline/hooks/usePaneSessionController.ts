/**
 * Exposes memoised helpers for mutating a single pane's session state while keeping React
 * components focused on rendering. Every mutation keeps the originating pane active and avoids
 * redundant writes so shared undo history remains stable, aligning with AGENTS.md guidance.
 */
import { useCallback } from "react";

import type { EdgeId } from "@thortiq/client-core";
import type {
  SessionPaneSearchState,
  SessionPaneState,
  SessionState,
  SessionStore
} from "@thortiq/sync-core";

import type { SelectionRange } from "../types";

export interface SetActiveEdgeOptions {
  readonly preserveRange?: boolean;
}

export interface PaneSessionController {
  readonly setSelectionRange: (range: SelectionRange | null) => void;
  readonly setActiveEdge: (edgeId: EdgeId | null, options?: SetActiveEdgeOptions) => void;
  readonly setCollapsed: (edgeId: EdgeId, collapsed: boolean) => void;
  readonly setPendingFocusEdgeId: (edgeId: EdgeId | null) => void;
  readonly clearSearchPartialEdge: (edgeId: EdgeId) => void;
  readonly setSearchOpen: (isOpen: boolean) => void;
  readonly setSearchDraft: (draft: string) => void;
  readonly applySearchResults: (payload: PaneSearchResultPayload) => void;
  readonly clearSearchResults: () => void;
  readonly addSearchStickyEdge: (edgeId: EdgeId, ancestorEdgeIds?: ReadonlyArray<EdgeId>) => void;
}

interface ControllerParams {
  readonly sessionStore: SessionStore;
  readonly paneId: string;
}

export interface PaneSearchResultPayload {
  readonly query: string;
  readonly matchedEdgeIds: readonly EdgeId[];
  readonly visibleEdgeIds: readonly EdgeId[];
  readonly partialEdgeIds: readonly EdgeId[];
}

const findPaneIndex = (state: SessionState, paneId: string): number =>
  state.panes.findIndex((paneState) => paneState.paneId === paneId);

const createEmptySearchState = (): SessionPaneSearchState => ({
  isOpen: false,
  draft: "",
  matchedEdgeIds: [],
  visibleEdgeIds: [],
  partialEdgeIds: [],
  stickyEdgeIds: []
});

const normaliseSearchState = (
  search: SessionPaneSearchState
): SessionPaneSearchState | undefined => {
  if (
    !search.isOpen
    && search.draft.length === 0
    && search.appliedQuery === undefined
    && search.matchedEdgeIds.length === 0
    && search.visibleEdgeIds.length === 0
    && search.partialEdgeIds.length === 0
    && search.stickyEdgeIds.length === 0
  ) {
    return undefined;
  }
  return search;
};

const areEdgeArraysShallowEqual = (a: readonly EdgeId[], b: readonly EdgeId[]): boolean => {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((value, index) => value === b[index]);
};

const areSearchStatesIdentical = (
  a: SessionPaneSearchState | undefined,
  b: SessionPaneSearchState | undefined
): boolean => {
  if (a === b) {
    return true;
  }
  if (!a || !b) {
    return !a && !b;
  }
  return (
    a.isOpen === b.isOpen
    && a.draft === b.draft
    && a.appliedQuery === b.appliedQuery
    && areEdgeArraysShallowEqual(a.matchedEdgeIds, b.matchedEdgeIds)
    && areEdgeArraysShallowEqual(a.visibleEdgeIds, b.visibleEdgeIds)
    && areEdgeArraysShallowEqual(a.partialEdgeIds, b.partialEdgeIds)
    && areEdgeArraysShallowEqual(a.stickyEdgeIds, b.stickyEdgeIds)
  );
};

const pruneSearchPartialEdges = (
  search: SessionPaneSearchState | undefined,
  edgeIds: ReadonlyArray<EdgeId>
): { search: SessionPaneSearchState | undefined; changed: boolean } => {
  if (!search || search.partialEdgeIds.length === 0 || edgeIds.length === 0) {
    return { search, changed: false };
  }
  const toRemove = new Set(edgeIds);
  let changed = false;
  const nextPartialEdgeIds = search.partialEdgeIds.filter((edgeId) => {
    if (toRemove.has(edgeId)) {
      changed = true;
      return false;
    }
    return true;
  });
  if (!changed) {
    return { search, changed: false };
  }
  const nextSearch = normaliseSearchState({
    ...search,
    partialEdgeIds: nextPartialEdgeIds
  });
  return {
    search: nextSearch,
    changed: true
  };
};

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
        const collapseChanged = collapsed ? !hasEdge : hasEdge;
        const existingSearch = paneState.search;
        const wasPartial = existingSearch?.partialEdgeIds.includes(edgeId) ?? false;
        const { search: prunedSearch, changed: partialChanged } = pruneSearchPartialEdges(
          existingSearch,
          [edgeId]
        );

        let stickyChanged = false;
        let nextSearch = partialChanged ? prunedSearch : existingSearch;

        if (nextSearch) {
          // Promote manually expanded partial nodes to sticky so their descendants remain visible
          // even while a search filter is active. The flag persists until the search query changes
          // or is cleared, ensuring the subtree stays expanded across manual toggles.
          if (!collapsed && wasPartial) {
            if (!nextSearch.stickyEdgeIds.includes(edgeId)) {
              const stickyEdgeIds = [...nextSearch.stickyEdgeIds, edgeId];
              nextSearch = normaliseSearchState({
                ...nextSearch,
                stickyEdgeIds
              });
              stickyChanged = true;
            }
          }
        }

        if (!collapseChanged && !partialChanged && !stickyChanged) {
          if (state.activePaneId === paneId) {
            return state;
          }
          return {
            ...state,
            activePaneId: paneId
          } satisfies SessionState;
        }
        const collapsedEdgeIds = collapseChanged
          ? collapsed
            ? [...paneState.collapsedEdgeIds, edgeId]
            : paneState.collapsedEdgeIds.filter((candidate) => candidate !== edgeId)
          : paneState.collapsedEdgeIds;
        const nextPane: SessionPaneState = {
          ...paneState,
          collapsedEdgeIds,
          ...(nextSearch ? { search: nextSearch } : { search: undefined })
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

  const clearSearchPartialEdge = useCallback(
    (edgeId: EdgeId) => {
      sessionStore.update((state) => {
        const index = findPaneIndex(state, paneId);
        if (index === -1) {
          return state;
        }
        const paneState = state.panes[index];
        const existingSearch = paneState.search;
        const { search: nextSearch, changed: partialChanged } = pruneSearchPartialEdges(
          existingSearch,
          [edgeId]
        );

        if (!partialChanged) {
          if (state.activePaneId === paneId) {
            return state;
          }
          return {
            ...state,
            activePaneId: paneId
          } satisfies SessionState;
        }
        const nextPane: SessionPaneState = {
          ...paneState,
          ...(nextSearch ? { search: nextSearch } : { search: undefined })
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

  const setSearchOpen = useCallback(
    (isOpen: boolean) => {
      sessionStore.update((state) => {
        const index = findPaneIndex(state, paneId);
        if (index === -1) {
          return state;
        }
        const paneState = state.panes[index];
        const baseSearch = paneState.search ?? createEmptySearchState();
        if (paneState.search && baseSearch.isOpen === isOpen) {
          return state;
        }
        const nextSearch = normaliseSearchState({
          ...baseSearch,
          isOpen
        });
        if (areSearchStatesIdentical(paneState.search, nextSearch)) {
          return state;
        }
        const nextPane: SessionPaneState = {
          ...paneState,
          ...(nextSearch ? { search: nextSearch } : { search: undefined })
        };
        const panes = state.panes.map((candidate, candidateIndex) => (candidateIndex === index ? nextPane : candidate));
        return {
          ...state,
          panes,
          activePaneId: paneId
        } satisfies SessionState;
      });
    },
    [paneId, sessionStore]
  );

  const setSearchDraft = useCallback(
    (draft: string) => {
      sessionStore.update((state) => {
        const index = findPaneIndex(state, paneId);
        if (index === -1) {
          return state;
        }
        const paneState = state.panes[index];
        const baseSearch = paneState.search ?? createEmptySearchState();
        if (paneState.search && paneState.search.draft === draft) {
          return state;
        }
        const nextSearch = normaliseSearchState({
          ...baseSearch,
          draft
        });
        if (areSearchStatesIdentical(paneState.search, nextSearch)) {
          return state;
        }
        const nextPane: SessionPaneState = {
          ...paneState,
          ...(nextSearch ? { search: nextSearch } : { search: undefined })
        };
        const panes = state.panes.map((candidate, candidateIndex) => (candidateIndex === index ? nextPane : candidate));
        return {
          ...state,
          panes,
          activePaneId: paneId
        } satisfies SessionState;
      });
    },
    [paneId, sessionStore]
  );

  const applySearchResults = useCallback(
    (payload: PaneSearchResultPayload) => {
      sessionStore.update((state) => {
        const index = findPaneIndex(state, paneId);
        if (index === -1) {
          return state;
        }
        const paneState = state.panes[index];
        const baseSearch = paneState.search ?? createEmptySearchState();
        const nextSearch = normaliseSearchState({
          ...baseSearch,
          draft: payload.query,
          appliedQuery: payload.query,
          matchedEdgeIds: [...payload.matchedEdgeIds],
          visibleEdgeIds: [...payload.visibleEdgeIds],
          partialEdgeIds: [...payload.partialEdgeIds],
          stickyEdgeIds: []
        });
        if (areSearchStatesIdentical(paneState.search, nextSearch)) {
          return state;
        }
        const nextPane: SessionPaneState = {
          ...paneState,
          ...(nextSearch ? { search: nextSearch } : { search: undefined })
        };
        const panes = state.panes.map((candidate, candidateIndex) => (candidateIndex === index ? nextPane : candidate));
        return {
          ...state,
          panes,
          activePaneId: paneId
        } satisfies SessionState;
      });
    },
    [paneId, sessionStore]
  );

  const clearSearchResults = useCallback(() => {
    sessionStore.update((state) => {
      const index = findPaneIndex(state, paneId);
      if (index === -1) {
        return state;
      }
      const paneState = state.panes[index];
      if (!paneState.search) {
        return state;
      }
      const nextSearch = normaliseSearchState({
        ...paneState.search,
        appliedQuery: undefined,
        matchedEdgeIds: [],
        visibleEdgeIds: [],
        partialEdgeIds: [],
        stickyEdgeIds: []
      });
      if (areSearchStatesIdentical(paneState.search, nextSearch)) {
        return state;
      }
      const nextPane: SessionPaneState = {
        ...paneState,
        ...(nextSearch ? { search: nextSearch } : { search: undefined })
      };
      const panes = state.panes.map((candidate, candidateIndex) => (candidateIndex === index ? nextPane : candidate));
      return {
        ...state,
        panes,
        activePaneId: paneId
      } satisfies SessionState;
    });
  }, [paneId, sessionStore]);

  const addSearchStickyEdge = useCallback(
    (edgeId: EdgeId, ancestorEdgeIds: ReadonlyArray<EdgeId> = []) => {
      sessionStore.update((state) => {
        const index = findPaneIndex(state, paneId);
        if (index === -1) {
          return state;
        }
        const paneState = state.panes[index];
        const existing = paneState.search;
        if (!existing) {
          return state;
        }
        const candidates = [edgeId, ...ancestorEdgeIds];
        let changed = false;
        const nextSticky = [...existing.stickyEdgeIds];
        candidates.forEach((candidateEdgeId) => {
          if (!nextSticky.includes(candidateEdgeId)) {
            nextSticky.push(candidateEdgeId);
            changed = true;
          }
        });
        if (!changed) {
          return state;
        }
        const nextSearch = normaliseSearchState({
          ...existing,
          stickyEdgeIds: nextSticky
        });
        if (areSearchStatesIdentical(paneState.search, nextSearch)) {
          return state;
        }
        const nextPane: SessionPaneState = {
          ...paneState,
          ...(nextSearch ? { search: nextSearch } : { search: undefined })
        };
        const panes = state.panes.map((candidate, candidateIndex) => (candidateIndex === index ? nextPane : candidate));
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
    setPendingFocusEdgeId,
    clearSearchPartialEdge,
    setSearchOpen,
    setSearchDraft,
    applySearchResults,
    clearSearchResults,
    addSearchStickyEdge
  };
};
