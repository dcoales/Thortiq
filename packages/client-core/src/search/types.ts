/**
 * Search domain model shared across adapters. It defines the query AST produced by the parser,
 * descriptors for indexable fields, and the structured filter signatures emitted by evaluators.
 * Keeping these types colocated ensures the parser (Step 3) and incremental index (Step 4)
 * evolve together without leaking implementation details into React adapters.
 */

/** Fields addressable by the advanced search language. */
export type SearchField = "text" | "path" | "tag" | "type" | "created" | "updated";

/** Comparison operators recognised by the parser. */
export type SearchComparator = ":" | "=" | "!=" | ">" | ">=" | "<" | "<=";

/** Primitive value kinds represented in query literals. */
export type SearchLiteralKind = "string" | "date";

export interface SearchStringLiteral {
  readonly kind: "string";
  readonly value: string;
}

export interface SearchDateLiteral {
  readonly kind: "date";
  /**
   * Millisecond UTC timestamp; the parser normalises ISO values so downstream systems can compare
   * without reparsing.
   */
  readonly value: number;
  /** Original token for diagnostics or UI echoing. */
  readonly raw: string;
}

export type SearchLiteral = SearchStringLiteral | SearchDateLiteral;

export interface SearchRangeLiteral {
  readonly kind: "range";
  /** Inclusive lower bound when defined. */
  readonly start?: SearchLiteral;
  /** Inclusive upper bound when defined. */
  readonly end?: SearchLiteral;
}

/** Base unit composed into expression trees. */
export interface SearchPredicateExpression {
  readonly type: "predicate";
  readonly field: SearchField;
  readonly comparator: SearchComparator;
  readonly value: SearchLiteral | SearchRangeLiteral;
}

export interface SearchNotExpression {
  readonly type: "not";
  readonly operand: SearchExpression;
}

export interface SearchBinaryExpression {
  readonly type: "binary";
  readonly operator: "AND" | "OR";
  readonly left: SearchExpression;
  readonly right: SearchExpression;
}

export interface SearchGroupExpression {
  readonly type: "group";
  readonly expression: SearchExpression;
}

export type SearchExpression =
  | SearchPredicateExpression
  | SearchNotExpression
  | SearchBinaryExpression
  | SearchGroupExpression;

/** Normalised value variants produced when compiling expressions into executable filters. */
export type SearchCompiledValue =
  | SearchCompiledStringValue
  | SearchCompiledPathValue
  | SearchCompiledTagValue
  | SearchCompiledTypeValue
  | SearchCompiledDateValue
  | SearchCompiledRangeValue;

export interface SearchCompiledStringValue {
  readonly kind: "string";
  readonly value: string;
  /** Lowercase version for case-insensitive comparisons. */
  readonly normalized: string;
}

export interface SearchCompiledPathValue {
  readonly kind: "path";
  readonly segments: readonly string[];
  readonly normalized: readonly string[];
}

export interface SearchCompiledTagValue {
  readonly kind: "tag";
  readonly value: string;
  readonly normalized: string;
}

export interface SearchCompiledTypeValue {
  readonly kind: "type";
  readonly value: string;
  readonly normalized: string;
}

export interface SearchCompiledDateValue {
  readonly kind: "date";
  /** Millisecond UTC timestamp. */
  readonly value: number;
}

export type SearchComparablePrimitive = string | number;

export interface SearchCompiledRangeValue {
  readonly kind: "range";
  readonly valueType: "string" | "date";
  readonly start?: SearchCompiledComparableBoundary;
  readonly end?: SearchCompiledComparableBoundary;
}

export interface SearchCompiledComparableBoundary {
  readonly value: SearchComparablePrimitive;
  /**
   * Lowercased form for string comparisons; omitted for numeric/date boundaries where casing is
   * irrelevant.
   */
  readonly normalized?: string;
  readonly inclusive: boolean;
}

export interface SearchFilterDescriptor {
  readonly field: SearchField;
  readonly comparator: SearchComparator | "range";
  readonly value: SearchCompiledValue;
}

export interface SearchEvaluation {
  readonly expression: SearchExpression;
  readonly filters: readonly SearchFilterDescriptor[];
}

export type SearchIndexFieldType = "text" | "path" | "tag" | "type" | "date";

export interface SearchIndexFieldDescriptor {
  readonly field: SearchField;
  readonly label: string;
  readonly description: string;
  readonly valueType: SearchIndexFieldType;
  readonly supportsPrefix: boolean;
  readonly supportsRange: boolean;
}

export const SEARCH_INDEX_FIELDS: readonly SearchIndexFieldDescriptor[] = [
  {
    field: "text",
    label: "Text",
    description: "Full-text content of the node with formatting stripped.",
    valueType: "text",
    supportsPrefix: true,
    supportsRange: false
  },
  {
    field: "path",
    label: "Path",
    description: "Slash-delimited breadcrumb of node titles.",
    valueType: "path",
    supportsPrefix: true,
    supportsRange: false
  },
  {
    field: "tag",
    label: "Tag",
    description: "Inline #tag tokens or node metadata tags.",
    valueType: "tag",
    supportsPrefix: true,
    supportsRange: false
  },
  {
    field: "type",
    label: "Type",
    description: "Node classification such as todo, heading, or paragraph.",
    valueType: "type",
    supportsPrefix: false,
    supportsRange: false
  },
  {
    field: "created",
    label: "Created",
    description: "Creation timestamp normalised to UTC milliseconds.",
    valueType: "date",
    supportsPrefix: false,
    supportsRange: true
  },
  {
    field: "updated",
    label: "Updated",
    description: "Last modified timestamp normalised to UTC milliseconds.",
    valueType: "date",
    supportsPrefix: false,
    supportsRange: true
  }
] as const;

export const SEARCH_INDEX_FIELDS_BY_ID: ReadonlyMap<SearchField, SearchIndexFieldDescriptor> =
  new Map(SEARCH_INDEX_FIELDS.map((descriptor) => [descriptor.field, descriptor]));
