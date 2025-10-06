import type { EdgeId } from "../ids";
import type { OutlineSnapshot } from "../types";
import type { OutlineSearchIndexEntry, SearchExpression, SearchTerm, SearchValue } from "./types";

interface PathCacheEntry {
  readonly lower: string;
}

interface EvaluationContext {
  readonly snapshot: OutlineSnapshot;
  readonly pathCache: Map<EdgeId, PathCacheEntry>;
}

const ensureStringValue = (value: SearchValue): string | null => {
  if (value.type === "string") {
    return value.value;
  }
  return null;
};

const ensureNumericValue = (value: SearchValue): number | null => {
  if (value.type === "number") {
    return value.value;
  }
  return null;
};

const compareStrings = (left: string, right: string): number => left.localeCompare(right);

const evaluateString = (
  source: string,
  term: SearchTerm
): boolean => {
  const value = ensureStringValue(term.value);
  if (value === null) {
    return false;
  }
  const candidate = value.toLocaleLowerCase();
  switch (term.operator) {
    case "contains":
      return source.includes(candidate);
    case "equals":
      return source === candidate;
    case "notEquals":
      return source !== candidate;
    case "gt":
      return compareStrings(source, candidate) > 0;
    case "gte":
      return compareStrings(source, candidate) >= 0;
    case "lt":
      return compareStrings(source, candidate) < 0;
    case "lte":
      return compareStrings(source, candidate) <= 0;
    default:
      return false;
  }
};

const evaluateStringList = (
  values: readonly string[],
  term: SearchTerm
): boolean => {
  const value = ensureStringValue(term.value);
  if (value === null) {
    return false;
  }
  const candidate = value.toLocaleLowerCase();
  if (values.length === 0) {
    return term.operator === "notEquals";
  }
  switch (term.operator) {
    case "contains":
      return values.some((entry) => entry.includes(candidate));
    case "equals":
      return values.some((entry) => entry === candidate);
    case "notEquals":
      return values.every((entry) => entry !== candidate);
    case "gt":
      return values.some((entry) => compareStrings(entry, candidate) > 0);
    case "gte":
      return values.some((entry) => compareStrings(entry, candidate) >= 0);
    case "lt":
      return values.some((entry) => compareStrings(entry, candidate) < 0);
    case "lte":
      return values.some((entry) => compareStrings(entry, candidate) <= 0);
    default:
      return false;
  }
};

const evaluateNumeric = (
  source: number,
  term: SearchTerm
): boolean => {
  const value = ensureNumericValue(term.value);
  if (value === null) {
    return false;
  }
  switch (term.operator) {
    case "equals":
    case "contains":
      return source === value;
    case "notEquals":
      return source !== value;
    case "gt":
      return source > value;
    case "gte":
      return source >= value;
    case "lt":
      return source < value;
    case "lte":
      return source <= value;
    default:
      return false;
  }
};

const computePath = (
  entry: OutlineSearchIndexEntry,
  context: EvaluationContext
): PathCacheEntry => {
  const cached = context.pathCache.get(entry.edgeId);
  if (cached) {
    return cached;
  }
  const segments: string[] = [];
  entry.ancestorNodeIds.forEach((nodeId) => {
    const node = context.snapshot.nodes.get(nodeId);
    if (node) {
      segments.push(node.text ?? "");
    }
  });
  const current = context.snapshot.nodes.get(entry.nodeId);
  if (current) {
    segments.push(current.text ?? "");
  }
  const lower = segments.map((segment) => segment.toLocaleLowerCase()).join(" › ");
  const cacheEntry: PathCacheEntry = { lower };
  context.pathCache.set(entry.edgeId, cacheEntry);
  return cacheEntry;
};

const evaluateTerm = (
  entry: OutlineSearchIndexEntry,
  term: SearchTerm,
  context: EvaluationContext
): boolean => {
  switch (term.field) {
    case "text":
      return evaluateString(entry.textLower, term);
    case "tag":
      return evaluateStringList(entry.tagsLower, term);
    case "type":
      return evaluateStringList(entry.types, term);
    case "path": {
      const cache = computePath(entry, context);
      return evaluateString(cache.lower, term);
    }
    case "created":
      return evaluateNumeric(entry.createdAt, term);
    case "updated":
      return evaluateNumeric(entry.updatedAt, term);
    default:
      return false;
  }
};

export const evaluateSearchExpression = (
  entry: OutlineSearchIndexEntry,
  expression: SearchExpression,
  context: EvaluationContext
): boolean => {
  switch (expression.kind) {
    case "term":
      return evaluateTerm(entry, expression.term, context);
    case "not":
      return !evaluateSearchExpression(entry, expression.expression, context);
    case "and":
      return (
        evaluateSearchExpression(entry, expression.left, context)
        && evaluateSearchExpression(entry, expression.right, context)
      );
    case "or":
      return (
        evaluateSearchExpression(entry, expression.left, context)
        || evaluateSearchExpression(entry, expression.right, context)
      );
    default:
      return false;
  }
};

export const evaluateMatches = (
  entries: ReadonlyMap<EdgeId, OutlineSearchIndexEntry>,
  snapshot: OutlineSnapshot,
  expression: SearchExpression | null
): ReadonlySet<EdgeId> => {
  if (!expression) {
    return new Set<EdgeId>();
  }
  const context: EvaluationContext = {
    snapshot,
    pathCache: new Map()
  };
  const result = new Set<EdgeId>();
  entries.forEach((entry, edgeId) => {
    if (evaluateSearchExpression(entry, expression, context)) {
      result.add(edgeId);
    }
  });
  return result;
};

