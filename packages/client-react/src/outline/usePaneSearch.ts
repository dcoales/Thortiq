import { useCallback } from "react";

import {
  parseSearchQuery,
  type EdgeId,
  type OutlinePaneSearchRuntime,
  type SearchEvaluation
} from "@thortiq/client-core";
import type { SessionPaneState, SessionPaneSearchState } from "@thortiq/sync-core";
import { defaultPaneSearchState } from "@thortiq/sync-core";

import { useOutlinePaneState, useOutlineSessionStore, useOutlineStore } from "./OutlineProvider";

const edgeArraysEqual = (a: readonly EdgeId[], b: readonly EdgeId[]): boolean => {
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

const isSearchStateEqual = (a: SessionPaneSearchState, b: SessionPaneSearchState): boolean => {
  return (
    a === b
    || (
      a.draft === b.draft
      && a.submitted === b.submitted
      && a.isInputVisible === b.isInputVisible
      && edgeArraysEqual(a.resultEdgeIds, b.resultEdgeIds)
      && edgeArraysEqual(a.manuallyExpandedEdgeIds, b.manuallyExpandedEdgeIds)
      && edgeArraysEqual(a.manuallyCollapsedEdgeIds, b.manuallyCollapsedEdgeIds)
      && edgeArraysEqual(a.appendedEdgeIds, b.appendedEdgeIds)
    )
  );
};

const uniquePush = (source: ReadonlyArray<EdgeId>, edgeId: EdgeId): ReadonlyArray<EdgeId> => {
  if (source.includes(edgeId)) {
    return source;
  }
  return [...source, edgeId];
};

export interface PaneSearchSubmitSuccess {
  readonly ok: true;
  readonly evaluation: SearchEvaluation | null;
}

export interface PaneSearchSubmitError {
  readonly ok: false;
  readonly error: {
    readonly message: string;
    readonly start: number;
    readonly end?: number;
  };
}

export type PaneSearchSubmitResult = PaneSearchSubmitSuccess | PaneSearchSubmitError;

export interface PaneSearchController {
  readonly draft: string;
  readonly submitted: string | null;
  readonly isInputVisible: boolean;
  readonly resultEdgeIds: ReadonlyArray<EdgeId>;
  readonly runtime: OutlinePaneSearchRuntime | null;
  readonly isActive: boolean;
  setDraft(value: string): void;
  setInputVisible(visible: boolean): void;
  submit(): PaneSearchSubmitResult;
  clearResults(): void;
  hideInput(): void;
  toggleExpansion(edgeId: EdgeId): void;
  registerAppendedEdge(edgeId: EdgeId): void;
}

export const usePaneSearch = (paneId: string, pane?: SessionPaneState): PaneSearchController => {
  const sessionStore = useOutlineSessionStore();
  const outlineStore = useOutlineStore();
  const contextPane = useOutlinePaneState(paneId);
  const resolvedPane = pane ?? contextPane;
  if (!resolvedPane) {
    throw new Error(`Pane ${paneId} not found in session state`);
  }

  const updateSearchState = useCallback(
    (mutator: (previous: SessionPaneSearchState) => SessionPaneSearchState | null): void => {
      sessionStore.update((sessionState) => {
        const paneIndex = sessionState.panes.findIndex((candidate) => candidate.paneId === paneId);
        if (paneIndex === -1) {
          return sessionState;
        }
        const currentPane = sessionState.panes[paneIndex];
        const previousSearch = currentPane.search ?? defaultPaneSearchState();
        const nextSearch = mutator(previousSearch);
        if (!nextSearch || isSearchStateEqual(previousSearch, nextSearch)) {
          return sessionState;
        }
        const nextPane: SessionPaneState = {
          ...currentPane,
          search: nextSearch
        };
        const nextPanes = sessionState.panes.slice();
        nextPanes[paneIndex] = nextPane;
        return {
          ...sessionState,
          panes: nextPanes
        };
      });
    },
    [paneId, sessionStore]
  );

  const setDraft = useCallback(
    (value: string) => {
      updateSearchState((previous) => {
        if (previous.draft === value && previous.isInputVisible) {
          return previous;
        }
        return {
          ...previous,
          draft: value,
          isInputVisible: true
        };
      });
    },
    [updateSearchState]
  );

  const setInputVisible = useCallback(
    (visible: boolean) => {
      updateSearchState((previous) => {
        if (previous.isInputVisible === visible) {
          return previous;
        }
        if (visible) {
          return {
            ...previous,
            isInputVisible: true
          };
        }
        return {
          ...defaultPaneSearchState(),
          isInputVisible: false
        };
      });
    },
    [updateSearchState]
  );

  const clearResults = useCallback(() => {
    outlineStore.clearPaneSearch(paneId);
  }, [outlineStore, paneId]);

  const hideInput = useCallback(() => {
    updateSearchState(() => ({
      ...defaultPaneSearchState(),
      isInputVisible: false
    }));
  }, [updateSearchState]);

  const toggleExpansion = useCallback(
    (edgeId: EdgeId) => {
      outlineStore.toggleSearchExpansion(paneId, edgeId);
    },
    [outlineStore, paneId]
  );

  const registerAppendedEdge = useCallback(
    (edgeId: EdgeId) => {
      updateSearchState((previous) => {
        if (!previous.submitted) {
          return previous;
        }
        const nextAppended = uniquePush(previous.appendedEdgeIds, edgeId);
        const nextResults = uniquePush(previous.resultEdgeIds, edgeId);
        if (
          edgeArraysEqual(previous.appendedEdgeIds, nextAppended)
          && edgeArraysEqual(previous.resultEdgeIds, nextResults)
        ) {
          return previous;
        }
        return {
          ...previous,
          appendedEdgeIds: nextAppended,
          resultEdgeIds: nextResults
        };
      });
    },
    [updateSearchState]
  );

  const submit = useCallback((): PaneSearchSubmitResult => {
    const currentDraft = (resolvedPane.search?.draft ?? "").trim();
    if (currentDraft.length === 0) {
      outlineStore.clearPaneSearch(paneId);
      updateSearchState(() => ({
        ...defaultPaneSearchState(),
        isInputVisible: true
      }));
      return { ok: true, evaluation: null };
    }

    const parsed = parseSearchQuery(currentDraft);
    if (parsed.type === "error") {
      return { ok: false, error: parsed.error };
    }

    updateSearchState((previous) => ({
      ...previous,
      draft: currentDraft,
      isInputVisible: true
    }));
    outlineStore.runPaneSearch(paneId, {
      query: currentDraft,
      expression: parsed.expression
    });

    const runtime = outlineStore.getPaneSearchRuntime(paneId);
    return {
      ok: true,
      evaluation: runtime?.evaluation ?? null
    };
  }, [outlineStore, paneId, resolvedPane.search?.draft, updateSearchState]);

  const runtime = outlineStore.getPaneSearchRuntime(paneId);

  const searchState = resolvedPane.search ?? defaultPaneSearchState();
  const isActive = Boolean(searchState.submitted && searchState.resultEdgeIds.length > 0);

  return {
    draft: searchState.draft,
    submitted: searchState.submitted,
    isInputVisible: searchState.isInputVisible,
    resultEdgeIds: searchState.resultEdgeIds,
    runtime,
    isActive,
    setDraft,
    setInputVisible,
    submit,
    clearResults,
    hideInput,
    toggleExpansion,
    registerAppendedEdge
  };
};
