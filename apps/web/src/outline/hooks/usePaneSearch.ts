import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
  readonly focusRootEdgeId: EdgeId | null;
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

export const usePaneSearch = ({
  pane,
  controller,
  outlineStore,
  focusRootEdgeId
}: UsePaneSearchParams): PaneSearchState => {
  const searchState = pane.search;
  const [errors, setErrors] = useState<readonly SearchParseError[]>([]);
  const lastExecutionRef = useRef<{ readonly query: string; readonly scope: EdgeId | null } | null>(null);

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
      lastExecutionRef.current = null;
      return;
    }
    const scope = focusRootEdgeId ?? null;
    const execution = outlineStore.runSearch(query, { scopeRootEdgeId: scope });
    setErrors(execution.errors);
    if (execution.errors.length > 0 || execution.expression === null) {
      lastExecutionRef.current = { query, scope };
      return;
    }
    controller.applySearchResults(toPayloadArrays(execution));
    lastExecutionRef.current = { query, scope };
  }, [controller, focusRootEdgeId, outlineStore, searchState?.draft]);

  const clearResults = useCallback(() => {
    controller.clearSearchResults();
    controller.setSearchDraft("");
    setErrors([]);
    lastExecutionRef.current = null;
  }, [controller]);

  const addStickyEdge = useCallback(
    (edgeId: EdgeId, ancestorEdgeIds: ReadonlyArray<EdgeId>) => {
      controller.addSearchStickyEdge(edgeId, ancestorEdgeIds);
    },
    [controller]
  );

  const hasVisibleResults = visibleEdgeIds.size > 0
    || matchedEdgeIds.size > 0
    || stickyEdgeIds.size > 0;

  useEffect(() => {
    const appliedQuery = searchState?.appliedQuery?.trim();
    if (!appliedQuery) {
      lastExecutionRef.current = null;
      return;
    }
    const scope = focusRootEdgeId ?? null;
    const previous = lastExecutionRef.current;
    if (previous && previous.query === appliedQuery && previous.scope === scope) {
      return;
    }
    const execution = outlineStore.runSearch(appliedQuery, { scopeRootEdgeId: scope });
    setErrors(execution.errors);
    lastExecutionRef.current = { query: appliedQuery, scope };
    if (execution.errors.length > 0 || execution.expression === null) {
      return;
    }
    controller.applySearchResults(toPayloadArrays(execution));
  }, [controller, focusRootEdgeId, outlineStore, searchState?.appliedQuery]);

  return {
    isOpen: searchState?.isOpen ?? false,
    draft: searchState?.draft ?? "",
    appliedQuery: searchState?.appliedQuery,
    matchedEdgeIds,
    visibleEdgeIds,
    partialEdgeIds,
    stickyEdgeIds,
    errors,
    hasActiveResults: hasVisibleResults,
    setOpen,
    setDraft,
    submit,
    clearResults,
    addStickyEdge
  } satisfies PaneSearchState;
};
