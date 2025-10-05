/**
 * Executes parsed search queries against a search index to find matching nodes.
 * Handles boolean logic, field matching, and relevance scoring.
 */
import type { NodeId } from "../ids";
import type { OutlineSnapshot, NodeSnapshot } from "../types";
import type { SearchQuery, SearchIndex, SearchResult, SearchOptions } from "./types";
import { SearchExecutionError } from "./types";

/**
 * Executes a search query against the index and returns matching node IDs.
 */
export const executeSearchQuery = (
  index: SearchIndex,
  query: SearchQuery,
  snapshot: OutlineSnapshot,
  options: SearchOptions = {}
): NodeId[] => {
  const results = executeQueryRecursive(index, query, snapshot);
  
  // Sort by relevance if requested
  if (options.sortByRelevance) {
    results.sort((a, b) => b.score - a.score);
  }
  
  // Apply limit
  const limit = options.limit ?? 1000;
  const limitedResults = results.slice(0, limit);
  
  // Include ancestors if requested
  if (options.includeAncestors) {
    return includeAncestors(limitedResults.map(r => r.nodeId), snapshot);
  }
  
  return limitedResults.map(r => r.nodeId);
};

/**
 * Executes a search query and returns both matching nodes and full result set.
 */
export const executeSearchQueryWithCount = (
  index: SearchIndex,
  query: SearchQuery,
  snapshot: OutlineSnapshot,
  options: SearchOptions = {}
): { matchingNodeIds: NodeId[]; resultNodeIds: NodeId[] } => {
  const results = executeQueryRecursive(index, query, snapshot);
  
  // Sort by relevance if requested
  if (options.sortByRelevance) {
    results.sort((a, b) => b.score - a.score);
  }
  
  // Apply limit
  const limit = options.limit ?? 1000;
  const limitedResults = results.slice(0, limit);
  
  const matchingNodeIds = limitedResults.map(r => r.nodeId);
  
  // Include ancestors if requested
  if (options.includeAncestors) {
    const resultNodeIds = includeAncestors(matchingNodeIds, snapshot);
    return { matchingNodeIds, resultNodeIds };
  }
  
  return { matchingNodeIds, resultNodeIds: matchingNodeIds };
};

/**
 * Recursively executes a query and returns results with scores.
 */
const executeQueryRecursive = (
  index: SearchIndex,
  query: SearchQuery,
  snapshot: OutlineSnapshot
): SearchResult[] => {
  switch (query.type) {
    case "field":
      return executeFieldQuery(index, query, snapshot);
    case "boolean":
      return executeBooleanQuery(index, query, snapshot);
    case "group":
      return executeQueryRecursive(index, query.query, snapshot);
    default:
      // This should never happen with proper typing, but handle it gracefully
      throw new SearchExecutionError(`Unknown query type: ${JSON.stringify(query)}`, query);
  }
};

/**
 * Executes a field-based query (e.g., "text:hello", "tag:important").
 */
const executeFieldQuery = (
  index: SearchIndex,
  query: SearchQuery & { type: "field" },
  snapshot: OutlineSnapshot
): SearchResult[] => {
  const matchingNodeIds = getMatchingNodeIds(index, query);
  
  return matchingNodeIds.map(nodeId => {
    const node = snapshot.nodes.get(nodeId);
    if (!node) {
      throw new SearchExecutionError(`Node ${nodeId} not found in snapshot`, query);
    }
    
    return {
      nodeId,
      score: calculateRelevanceScore(query, node),
      matchedFields: new Set([query.field]),
      context: buildContext(query, node)
    };
  });
};

/**
 * Executes a boolean query (AND, OR, NOT).
 */
const executeBooleanQuery = (
  index: SearchIndex,
  query: SearchQuery & { type: "boolean" },
  snapshot: OutlineSnapshot
): SearchResult[] => {
  const leftResults = executeQueryRecursive(index, query.left, snapshot);
  
  if (query.operator === "NOT") {
    // For NOT queries, we need to find all nodes and exclude the left results
    const allNodeIds = new Set(snapshot.nodes.keys());
    const excludedNodeIds = new Set(leftResults.map(r => r.nodeId));
    const notMatchingNodeIds = Array.from(allNodeIds).filter(id => !excludedNodeIds.has(id));
    
    return notMatchingNodeIds.map(nodeId => {
      return {
        nodeId,
        score: 1.0, // Base score for NOT results
        matchedFields: new Set<"text" | "path" | "tag" | "type" | "created" | "updated">(),
        context: undefined
      };
    });
  }
  
  if (!query.right) {
    throw new SearchExecutionError("Boolean query missing right operand", query);
  }
  
  const rightResults = executeQueryRecursive(index, query.right, snapshot);
  
  if (query.operator === "AND") {
    return executeAndOperation(leftResults, rightResults);
  } else if (query.operator === "OR") {
    return executeOrOperation(leftResults, rightResults);
  }
  
  throw new SearchExecutionError(`Unknown boolean operator: ${query.operator}`, query);
};

/**
 * Executes AND operation by finding intersection of results.
 */
const executeAndOperation = (left: SearchResult[], right: SearchResult[]): SearchResult[] => {
  const rightMap = new Map(right.map(r => [r.nodeId, r]));
  const results: SearchResult[] = [];
  
  left.forEach(leftResult => {
    const rightResult = rightMap.get(leftResult.nodeId);
    if (rightResult) {
      results.push({
        nodeId: leftResult.nodeId,
        score: Math.min(leftResult.score, rightResult.score), // Conservative scoring
        matchedFields: new Set([...leftResult.matchedFields, ...rightResult.matchedFields]),
        context: mergeContext(leftResult.context, rightResult.context)
      });
    }
  });
  
  return results;
};

/**
 * Executes OR operation by combining results and deduplicating.
 */
const executeOrOperation = (left: SearchResult[], right: SearchResult[]): SearchResult[] => {
  const resultMap = new Map<string, SearchResult>();
  
  // Add left results
  left.forEach(result => {
    resultMap.set(result.nodeId, result);
  });
  
  // Add right results, merging with existing if found
  right.forEach(rightResult => {
    const existing = resultMap.get(rightResult.nodeId);
    if (existing) {
      resultMap.set(rightResult.nodeId, {
        nodeId: rightResult.nodeId,
        score: Math.max(existing.score, rightResult.score), // Higher score wins
        matchedFields: new Set([...existing.matchedFields, ...rightResult.matchedFields]),
        context: mergeContext(existing.context, rightResult.context)
      });
    } else {
      resultMap.set(rightResult.nodeId, rightResult);
    }
  });
  
  return Array.from(resultMap.values());
};

/**
 * Gets matching node IDs for a field query.
 */
const getMatchingNodeIds = (
  index: SearchIndex,
  query: SearchQuery & { type: "field" }
): NodeId[] => {
  const { field, operator, value } = query;
  
  switch (field) {
    case "text":
      return getTextMatches(index.textIndex, operator, value);
    case "path":
      return getTextMatches(index.pathIndex, operator, value);
    case "tag":
      return getTextMatches(index.tagIndex, operator, value);
    case "type":
      return getTextMatches(index.typeIndex, operator, value);
    case "created":
      return getTimestampMatches(index.createdIndex, operator, value);
    case "updated":
      return getTimestampMatches(index.updatedIndex, operator, value);
    default:
      throw new SearchExecutionError(`Unknown field: ${field}`, query);
  }
};

/**
 * Gets text-based matches from an index.
 */
const getTextMatches = (
  index: ReadonlyMap<string, ReadonlySet<NodeId>>,
  operator: string,
  value: string
): NodeId[] => {
  const searchValue = value.toLowerCase();
  const results: NodeId[] = [];
  
  if (operator === ":") {
    // Contains search - find all tokens that contain the search value
    index.forEach((nodeIds, token) => {
      if (token.includes(searchValue)) {
        results.push(...nodeIds);
      }
    });
  } else if (operator === "=") {
    // Exact match
    const exactMatch = index.get(searchValue);
    if (exactMatch) {
      results.push(...exactMatch);
    }
  } else if (operator === "!=") {
    // Not equal - find all nodes that don't have this exact value
    const exactMatch = index.get(searchValue);
    const allNodeIds = new Set<string>();
    index.forEach(nodeIds => {
      nodeIds.forEach(id => allNodeIds.add(id));
    });
    if (exactMatch) {
      exactMatch.forEach(id => allNodeIds.delete(id));
    }
    results.push(...allNodeIds);
  }
  
  return results;
};

/**
 * Gets timestamp-based matches from an index.
 */
const getTimestampMatches = (
  index: ReadonlyMap<number, ReadonlySet<NodeId>>,
  operator: string,
  value: string
): NodeId[] => {
  const timestamp = parseTimestamp(value);
  if (isNaN(timestamp)) {
    throw new SearchExecutionError(`Invalid timestamp: ${value}`);
  }
  
  const results: NodeId[] = [];
  
  index.forEach((nodeIds, indexTimestamp) => {
    let matches = false;
    
    switch (operator) {
      case "=":
        matches = indexTimestamp === timestamp;
        break;
      case "!=":
        matches = indexTimestamp !== timestamp;
        break;
      case ">":
        matches = indexTimestamp > timestamp;
        break;
      case "<":
        matches = indexTimestamp < timestamp;
        break;
      case ">=":
        matches = indexTimestamp >= timestamp;
        break;
      case "<=":
        matches = indexTimestamp <= timestamp;
        break;
    }
    
    if (matches) {
      results.push(...nodeIds);
    }
  });
  
  return results;
};

/**
 * Parses a timestamp string into a number.
 */
const parseTimestamp = (value: string): number => {
  // Try parsing as ISO date string
  const date = new Date(value);
  if (!isNaN(date.getTime())) {
    return date.getTime();
  }
  
  // Try parsing as Unix timestamp
  const timestamp = parseInt(value, 10);
  if (!isNaN(timestamp)) {
    return timestamp;
  }
  
  return NaN;
};

/**
 * Calculates relevance score for a field query match.
 */
const calculateRelevanceScore = (
  query: SearchQuery & { type: "field" },
  node: NodeSnapshot
): number => {
  // Base score
  let score = 1.0;
  
  // Boost score for exact matches
  if (query.operator === "=") {
    score += 0.5;
  }
  
  // Boost score for text matches in title/beginning
  if (query.field === "text") {
    const text = node.text.toLowerCase();
    const searchValue = query.value.toLowerCase();
    if (text.startsWith(searchValue)) {
      score += 0.3;
    }
  }
  
  return score;
};

/**
 * Builds context information for a search result.
 */
const buildContext = (
  query: SearchQuery & { type: "field" },
  node: NodeSnapshot
): SearchResult["context"] => {
  if (query.field === "text") {
    return {
      matchedText: node.text
    };
  } else if (query.field === "tag") {
    return {
      matchedTags: node.metadata.tags
    };
  }
  
  return undefined;
};

/**
 * Merges context from two search results.
 */
const mergeContext = (
  left?: SearchResult["context"],
  right?: SearchResult["context"]
): SearchResult["context"] => {
  if (!left) return right;
  if (!right) return left;
  
  return {
    matchedText: left.matchedText || right.matchedText,
    matchedPath: left.matchedPath || right.matchedPath,
    matchedTags: left.matchedTags || right.matchedTags
  };
};

/**
 * Includes ancestor nodes of the given node IDs.
 */
const includeAncestors = (nodeIds: NodeId[], snapshot: OutlineSnapshot): NodeId[] => {
  const resultSet = new Set(nodeIds);
  
  nodeIds.forEach(nodeId => {
    const ancestors = getAncestors(nodeId, snapshot);
    ancestors.forEach(ancestorId => resultSet.add(ancestorId));
  });
  
  return Array.from(resultSet);
};

/**
 * Gets all ancestor node IDs for a given node.
 */
const getAncestors = (nodeId: NodeId, snapshot: OutlineSnapshot): NodeId[] => {
  const ancestors: NodeId[] = [];
  let currentEdgeId: string | undefined;
  
  // Find the edge for this node
  snapshot.edges.forEach((edge, edgeId) => {
    if (edge.childNodeId === nodeId) {
      currentEdgeId = edgeId;
    }
  });
  
  // Walk up the tree
  while (currentEdgeId) {
    const edge = snapshot.edges.get(currentEdgeId);
    if (!edge) break;
    
    if (edge.parentNodeId) {
      ancestors.push(edge.parentNodeId);
      
      // Find parent edge
      let parentEdgeId: string | undefined;
      snapshot.edges.forEach((parentEdge, parentId) => {
        if (parentEdge.childNodeId === edge.parentNodeId) {
          parentEdgeId = parentId;
        }
      });
      currentEdgeId = parentEdgeId;
    } else {
      break;
    }
  }
  
  return ancestors;
};
