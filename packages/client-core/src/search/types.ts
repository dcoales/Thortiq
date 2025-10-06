import type { EdgeId, NodeId } from "../ids";

export type SearchField = "text" | "path" | "tag" | "type" | "created" | "updated";

export type SearchOperator = "contains" | "equals" | "notEquals" | "gt" | "lt" | "gte" | "lte";

export interface SearchStringValue {
  readonly type: "string";
  readonly value: string;
}

export interface SearchNumericValue {
  readonly type: "number";
  readonly value: number;
}

export type SearchValue = SearchStringValue | SearchNumericValue;

export interface SearchTerm {
  readonly field: SearchField;
  readonly operator: SearchOperator;
  readonly value: SearchValue;
}

export interface SearchTermExpression {
  readonly kind: "term";
  readonly term: SearchTerm;
}

export interface SearchNotExpression {
  readonly kind: "not";
  readonly expression: SearchExpression;
}

export interface SearchAndExpression {
  readonly kind: "and";
  readonly left: SearchExpression;
  readonly right: SearchExpression;
}

export interface SearchOrExpression {
  readonly kind: "or";
  readonly left: SearchExpression;
  readonly right: SearchExpression;
}

export type SearchExpression =
  | SearchTermExpression
  | SearchNotExpression
  | SearchAndExpression
  | SearchOrExpression;

export interface SearchParseError {
  readonly message: string;
  readonly position: number;
}

export interface SearchParseResult {
  readonly expression: SearchExpression | null;
  readonly errors: readonly SearchParseError[];
}

export interface OutlineSearchIndexEntry {
  readonly edgeId: EdgeId;
  readonly nodeId: NodeId;
  readonly ancestorEdgeIds: readonly EdgeId[];
  readonly ancestorNodeIds: readonly NodeId[];
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly text: string;
  readonly textLower: string;
  readonly tags: readonly string[];
  readonly tagsLower: readonly string[];
  readonly types: readonly string[];
}

export interface OutlineSearchIndexSnapshot {
  readonly entries: ReadonlyMap<EdgeId, OutlineSearchIndexEntry>;
  readonly nodeToEdgeIds: ReadonlyMap<NodeId, readonly EdgeId[]>;
}

export interface OutlineSearchExecution {
  readonly query: string;
  readonly expression: SearchExpression | null;
  readonly errors: readonly SearchParseError[];
  readonly matchedEdgeIds: ReadonlySet<EdgeId>;
  readonly visibleEdgeIds: ReadonlySet<EdgeId>;
  readonly partiallyVisibleEdgeIds: ReadonlySet<EdgeId>;
}

