import { useCallback, useMemo, useState } from "react";

import type {
  EdgeId,
  OutlineStore,
  OutlineSearchExecution,
  SearchParseError
} from "@thortiq/client-core";
import type { SessionPaneState } from "@thortiq/sync-core";

import type { PaneSearchResultPayload, PaneSessionController } from "./usePaneSessionController";

interface UsePaneSearchParams {
  readonly pane: SessionPaneState;
  readonly controller: PaneSessionController;
  readonly outlineStore: OutlineStore;
}

export interface PaneSearchState {
  readonly isOpen: boolean;
  readonly draft: string;
  readonly appliedQuery?: string;
  readonly matchedEdgeIds: ReadonlySet<EdgeId>;
  readonly visibleEdgeIds: ReadonlySet<EdgeId>;
  readonly partialEdgeIds: ReadonlySet<EdgeId>;
  readonly stickyEdgeIds: ReadonlySet<EdgeId>;
  readonly errors: readonly SearchParseError[];
  readonly hasActiveResults: boolean;
  setOpen(open: boolean): void;
  setDraft(value: string): void;
  submit(): void;
  clearResults(): void;
  addStickyEdge(edgeId: EdgeId, ancestorEdgeIds: ReadonlyArray<EdgeId>): void;
}

const toReadonlySet = (values: readonly EdgeId[] | undefined): ReadonlySet<EdgeId> =>
  new Set(values ?? []);

const toPayloadArrays = (execution: OutlineSearchExecution): PaneSearchResultPayload => ({
  query: execution.query,
  matchedEdgeIds: Array.from(execution.matchedEdgeIds),
  visibleEdgeIds: Array.from(execution.visibleEdgeIds),
  partialEdgeIds: Array.from(execution.partiallyVisibleEdgeIds)
});

export const usePaneSearch = ({ pane, controller, outlineStore }: UsePaneSearchParams): PaneSearchState => {
  const searchState = pane.search;
  const [errors, setErrors] = useState<readonly SearchParseError[]>([]);

  const matchedEdgeIds = useMemo(() => toReadonlySet(searchState?.matchedEdgeIds), [searchState?.matchedEdgeIds]);
  const visibleEdgeIds = useMemo(() => toReadonlySet(searchState?.visibleEdgeIds), [searchState?.visibleEdgeIds]);
  const partialEdgeIds = useMemo(() => toReadonlySet(searchState?.partialEdgeIds), [searchState?.partialEdgeIds]);
  const stickyEdgeIds = useMemo(() => toReadonlySet(searchState?.stickyEdgeIds), [searchState?.stickyEdgeIds]);

  const setOpen = useCallback(
    (open: boolean) => {
      controller.setSearchOpen(open);
      if (!open) {
        setErrors([]);
      }
    },
    [controller]
  );

  const setDraft = useCallback(
    (value: string) => {
      controller.setSearchDraft(value);
      setErrors([]);
    },
    [controller]
  );

  const submit = useCallback(() => {
    const draft = searchState?.draft ?? "";
    const query = draft.trim();
    if (query.length === 0) {
      controller.clearSearchResults();
      setErrors([]);
      return;
    }
    const execution = outlineStore.runSearch(query);
    setErrors(execution.errors);
    if (execution.errors.length > 0 || execution.expression === null) {
      return;
    }
    controller.applySearchResults(toPayloadArrays(execution));
  }, [controller, outlineStore, searchState?.draft]);

  const clearResults = useCallback(() => {
    controller.clearSearchResults();
    controller.setSearchDraft("");
    setErrors([]);
  }, [controller]);

  const addStickyEdge = useCallback(
    (edgeId: EdgeId, ancestorEdgeIds: ReadonlyArray<EdgeId>) => {
      controller.addSearchStickyEdge(edgeId, ancestorEdgeIds);
    },
    [controller]
  );

  return {
    isOpen: searchState?.isOpen ?? false,
    draft: searchState?.draft ?? "",
    appliedQuery: searchState?.appliedQuery,
    matchedEdgeIds,
    visibleEdgeIds,
    partialEdgeIds,
    stickyEdgeIds,
    errors,
    hasActiveResults: Boolean(searchState?.appliedQuery),
    setOpen,
    setDraft,
    submit,
    clearResults,
    addStickyEdge
  } satisfies PaneSearchState;
};
