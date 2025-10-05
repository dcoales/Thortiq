/**
 * React hooks for search functionality. Provides search index management,
 * query execution, and search state management.
 */
import { useCallback, useMemo, useState, useEffect } from "react";
import { useSyncExternalStore } from "react";
import type { NodeId, NodeSnapshot } from "@thortiq/client-core";
import type { SearchIndex, SearchOptions } from "@thortiq/client-core/search";
import { createSearchIndex, executeSearchQueryWithCount, parseSearchQuery } from "@thortiq/client-core/search";
import { setSearchQuery, toggleSearchActive, freezeSearchResults, clearSearch } from "@thortiq/sync-core";
import { useOutlineStore } from "../OutlineProvider";

/**
 * Hook that provides a memoized search index that updates when the outline changes.
 * Uses debouncing to avoid rebuilding the index on every change.
 */
export const useSearchIndex = (): SearchIndex => {
  const store = useOutlineStore();
  const snapshot = store.getSnapshot();
  const [searchIndex, setSearchIndex] = useState<SearchIndex>(() => createSearchIndex(snapshot));
  
  useEffect(() => {
    // Debounce index updates (250ms per AGENTS.md rule 30)
    const timeout = setTimeout(() => {
      setSearchIndex(createSearchIndex(snapshot));
    }, 250);
    
    return () => clearTimeout(timeout);
  }, [snapshot]);
  
  return searchIndex;
};

/**
 * Hook for managing search queries for a specific pane.
 */
export const useSearchQuery = (paneId: string) => {
  const store = useOutlineStore();
  const sessionStore = store.session;
  
  const paneState = useSyncExternalStore(
    sessionStore.subscribe,
    () => {
      const state = sessionStore.getState();
      return state.panes.find(pane => pane.paneId === paneId) ?? null;
    },
    () => {
      // Server-side rendering fallback
      const state = sessionStore.getState();
      return state.panes.find(pane => pane.paneId === paneId) ?? null;
    }
  );
  
  const executeSearch = useCallback((query: string, options: SearchOptions = {}) => {
    try {
      // Always use the latest snapshot and rebuild index to ensure freshness
      const latestSnapshot = store.getSnapshot();
      const latestIndex = createSearchIndex(latestSnapshot);
      
      const parsedQuery = parseSearchQuery(query);
      const { matchingNodeIds, resultNodeIds } = executeSearchQueryWithCount(latestIndex, parsedQuery, latestSnapshot, {
        includeAncestors: true,
        sortByRelevance: true,
        ...options
      });
      
      setSearchQuery(sessionStore, paneId, query, matchingNodeIds, resultNodeIds);
    } catch (error) {
      console.error("Search execution failed:", error);
      // Still set the query even if execution failed, so user can see the error
      setSearchQuery(sessionStore, paneId, query, [], []);
    }
  }, [store, sessionStore, paneId]);
  
  const clearSearchQuery = useCallback(() => {
    clearSearch(sessionStore, paneId);
  }, [sessionStore, paneId]);
  
  const toggleSearch = useCallback(() => {
    toggleSearchActive(sessionStore, paneId);
  }, [sessionStore, paneId]);
  
  const freezeResults = useCallback(() => {
    freezeSearchResults(sessionStore, paneId);
  }, [sessionStore, paneId]);
  
  return {
    query: paneState?.searchQuery ?? "",
    isActive: paneState?.searchActive ?? false,
    matchingNodeIds: paneState?.searchMatchingNodeIds ?? [],
    resultNodeIds: paneState?.searchResultNodeIds ?? [],
    isFrozen: paneState?.searchFrozen ?? false,
    executeSearch,
    clearSearchQuery,
    toggleSearch,
    freezeResults
  };
};

/**
 * Composable hook that provides all search commands for a pane.
 */
export const useSearchCommands = (paneId: string) => {
  const searchQuery = useSearchQuery(paneId);
  
  return {
    ...searchQuery,
    // Additional convenience methods
    searchAndFreeze: (query: string, options?: SearchOptions) => {
      searchQuery.executeSearch(query, options);
      searchQuery.freezeResults();
    },
    clearAndClose: () => {
      searchQuery.clearSearchQuery();
      searchQuery.toggleSearch();
    }
  };
};

/**
 * Hook for getting search results with additional metadata.
 */
export const useSearchResults = (paneId: string) => {
  const searchQuery = useSearchQuery(paneId);
  const store = useOutlineStore();
  const snapshot = store.getSnapshot();
  
  const results = useMemo(() => {
    if (!searchQuery.resultNodeIds.length) {
      return [];
    }
    
    return searchQuery.resultNodeIds.map(nodeId => {
      const node = snapshot.nodes.get(nodeId);
      return node ? { nodeId, node } : null;
    }).filter((result): result is { nodeId: NodeId; node: NodeSnapshot } => result !== null);
  }, [searchQuery.resultNodeIds, snapshot]);
  
  return {
    results,
    count: results.length,
    isEmpty: results.length === 0,
    isActive: searchQuery.isActive,
    isFrozen: searchQuery.isFrozen
  };
};
