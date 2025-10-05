/**
 * Public API for the search and indexing system. Provides high-level functions
 * for parsing queries, building indexes, and executing searches.
 */
export type {
  SearchIndex,
  SearchQuery,
  SearchResult,
  SearchOptions,
  IndexUpdateEvent,
  SearchField,
  SearchOperator,
  SearchFieldQuery,
  SearchBooleanQuery,
  SearchGroupQuery
} from "./types";

export {
  SearchParseError,
  SearchExecutionError
} from "./types";

export {
  parseSearchQuery
} from "./queryParser";

export {
  createSearchIndex,
  updateSearchIndex
} from "./indexBuilder";

export {
  executeSearchQuery,
  executeSearchQueryWithCount
} from "./queryExecutor";

import type { NodeId } from "../ids";
import type { OutlineSnapshot } from "../types";
import type { SearchIndex, SearchOptions } from "./types";
import { parseSearchQuery } from "./queryParser";
import { executeSearchQuery } from "./queryExecutor";

/**
 * Convenience function that combines parsing and execution in one call.
 */
export const search = (
  index: SearchIndex,
  queryString: string,
  snapshot: OutlineSnapshot,
  options: SearchOptions = {}
): NodeId[] => {
  const query = parseSearchQuery(queryString);
  return executeSearchQuery(index, query, snapshot, options);
};
