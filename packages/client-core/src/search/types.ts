/**
 * Core types for the search and indexing system. These types define the structure
 * of search indexes, parsed queries, and search results.
 */
import type { NodeId, EdgeId } from "../ids";

/**
 * Represents a search index that maintains efficient lookups for different field types.
 * Uses Maps for O(1) lookups and Sets for efficient set operations.
 */
export interface SearchIndex {
  /** Maps tokenized text to sets of NodeIds containing that text */
  readonly textIndex: ReadonlyMap<string, ReadonlySet<NodeId>>;
  /** Maps path segments to sets of NodeIds with that path */
  readonly pathIndex: ReadonlyMap<string, ReadonlySet<NodeId>>;
  /** Maps tag names to sets of NodeIds with that tag */
  readonly tagIndex: ReadonlyMap<string, ReadonlySet<NodeId>>;
  /** Maps node types to sets of NodeIds of that type */
  readonly typeIndex: ReadonlyMap<string, ReadonlySet<NodeId>>;
  /** Maps creation timestamps to sets of NodeIds created at that time */
  readonly createdIndex: ReadonlyMap<number, ReadonlySet<NodeId>>;
  /** Maps update timestamps to sets of NodeIds updated at that time */
  readonly updatedIndex: ReadonlyMap<number, ReadonlySet<NodeId>>;
  /** Version number for cache invalidation */
  readonly version: number;
}

/**
 * Describes what changed in the outline to trigger index updates.
 */
export interface IndexUpdateEvent {
  /** NodeIds that were added or had their text/metadata changed */
  readonly changedNodeIds: ReadonlySet<NodeId>;
  /** NodeIds that were deleted */
  readonly deletedNodeIds: ReadonlySet<NodeId>;
  /** EdgeIds that were added, moved, or deleted (affects path indexing) */
  readonly changedEdgeIds: ReadonlySet<EdgeId>;
  /** Whether structural changes occurred that require full rebuild */
  readonly structuralChange: boolean;
}

/**
 * Represents a parsed search query as an Abstract Syntax Tree.
 */
export type SearchQuery = 
  | SearchFieldQuery
  | SearchBooleanQuery
  | SearchGroupQuery;

/**
 * Field-based query (e.g., "text:hello", "tag:important", "created:>2024-01-01")
 */
export interface SearchFieldQuery {
  readonly type: "field";
  readonly field: SearchField;
  readonly operator: SearchOperator;
  readonly value: string;
}

/**
 * Boolean query combining other queries (e.g., "text:hello AND tag:important")
 */
export interface SearchBooleanQuery {
  readonly type: "boolean";
  readonly operator: "AND" | "OR" | "NOT";
  readonly left: SearchQuery;
  readonly right?: SearchQuery; // undefined for NOT queries
}

/**
 * Grouped query with parentheses (e.g., "(text:hello OR text:world) AND tag:important")
 */
export interface SearchGroupQuery {
  readonly type: "group";
  readonly query: SearchQuery;
}

/**
 * Supported search fields
 */
export type SearchField = "text" | "path" | "tag" | "type" | "created" | "updated";

/**
 * Supported search operators
 */
export type SearchOperator = ":" | "=" | "!=" | ">" | "<" | ">=" | "<=";

/**
 * Represents a search result with relevance scoring and context.
 */
export interface SearchResult {
  readonly nodeId: NodeId;
  readonly score: number;
  readonly matchedFields: ReadonlySet<SearchField>;
  readonly context?: {
    readonly matchedText?: string;
    readonly matchedPath?: string;
    readonly matchedTags?: ReadonlyArray<string>;
  };
}

/**
 * Configuration options for search operations.
 */
export interface SearchOptions {
  /** Maximum number of results to return */
  readonly limit?: number;
  /** Whether to include ancestor nodes of matches */
  readonly includeAncestors?: boolean;
  /** Whether to sort by relevance score */
  readonly sortByRelevance?: boolean;
}

/**
 * Error thrown when parsing search queries fails.
 */
export class SearchParseError extends Error {
  constructor(message: string, public readonly position?: number) {
    super(message);
    this.name = "SearchParseError";
  }
}

/**
 * Error thrown when executing search queries fails.
 */
export class SearchExecutionError extends Error {
  constructor(message: string, public readonly query?: SearchQuery) {
    super(message);
    this.name = "SearchExecutionError";
  }
}
