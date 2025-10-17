/**
 * Incremental search index that mirrors the collaborative outline document in memory.
 * It maintains per-node documents keyed by canonical edge id and evaluates structured
 * search expressions against normalised fields (text, path, tags, type, timestamps).
 *
 * All reads are derived from Yjs snapshots; mutations never occur here. Structural
 * operations schedule full rebuilds while text/metadata edits trigger targeted subtree
 * refreshes so path caches remain consistent (AGENTS §7).
 */
import type { YEvent } from "yjs";
import type { AbstractType } from "yjs/dist/src/internals";

import { getEdgeSnapshot, getNodeSnapshot } from "../doc/index";
import { NODE_METADATA_KEY, NODE_TEXT_XML_KEY } from "../doc/constants";
import type { EdgeId, NodeId } from "../ids";
import type {
  EdgeSnapshot,
  NodeMetadata,
  NodeSnapshot,
  OutlineDoc
} from "../types";
import type {
  SearchCompiledComparableBoundary,
  SearchCompiledDateValue,
  SearchCompiledPathValue,
  SearchCompiledRangeValue,
  SearchCompiledStringValue,
  SearchCompiledTagValue,
  SearchCompiledTypeValue,
  SearchCompiledValue,
  SearchComparator,
  SearchEvaluation,
  SearchExpression,
  SearchField,
  SearchFilterDescriptor,
  SearchLiteral,
  SearchPredicateExpression,
  SearchRangeLiteral
} from "./types";

type UpdateScope = "self" | "subtree";

interface SearchIndexDocument {
  readonly edgeId: EdgeId;
  readonly nodeId: NodeId;
  readonly text: string;
  readonly normalizedText: string;
  readonly pathSegments: readonly string[];
  readonly normalizedPathSegments: readonly string[];
  readonly normalizedPath: string;
  readonly tags: readonly string[];
  readonly normalizedTags: readonly string[];
  readonly type: string;
  readonly normalizedType: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly createdAtIso: string;
  readonly updatedAtIso: string;
}

interface CompiledEvaluation {
  readonly evaluation: SearchEvaluation;
  readonly descriptors: Map<SearchPredicateExpression, SearchFilterDescriptor>;
}

export interface SearchIndexQueryResult {
  readonly matches: readonly EdgeId[];
  readonly evaluation: SearchEvaluation;
}

export interface SearchIndex {
  rebuildFromSnapshot(): void;
  applyTransactionalUpdates(event: YEvent<AbstractType<unknown>>): void;
  runQuery(expression: SearchExpression): SearchIndexQueryResult;
}

const TAG_TEXT_PATTERN = /(^|\s)#([^\s#]+)/gu;

const enqueueMicrotask: (callback: () => void) => void =
  typeof queueMicrotask === "function"
    ? queueMicrotask.bind(globalThis)
    : (callback) => {
        Promise.resolve().then(callback).catch((error) => {
          if (typeof console !== "undefined" && typeof console.error === "function") {
            console.error("[search-index] microtask error", error);
          }
        });
      };

export const createSearchIndex = (outline: OutlineDoc): SearchIndex => {
  /** Canonical documents keyed by edge id (mirrors excluded). */
  const documents = new Map<EdgeId, SearchIndexDocument>();
  /** Snapshot cache for canonical node state. */
  const nodeSnapshots = new Map<NodeId, NodeSnapshot>();
  /** Snapshot cache for all edges (canonical + mirrors). */
  const edgeSnapshots = new Map<EdgeId, EdgeSnapshot>();
  /** Canonical edge id lookup by node id. */
  const canonicalEdgeByNodeId = new Map<NodeId, EdgeId>();
  /** Node id lookup by canonical edge id. */
  const nodeIdByCanonicalEdgeId = new Map<EdgeId, NodeId>();
  /** Cached breadcrumb segments by canonical edge id. */
  const pathSegmentsByEdgeId = new Map<EdgeId, readonly string[]>();
  const normalizedPathSegmentsByEdgeId = new Map<EdgeId, readonly string[]>();

  const pendingNodeUpdates = new Map<NodeId, UpdateScope>();
  let structuralRebuildPending = false;
  let flushScheduled = false;

  const ensureNodeSnapshot = (nodeId: NodeId): NodeSnapshot | null => {
    if (!outline.nodes.has(nodeId)) {
      nodeSnapshots.delete(nodeId);
      return null;
    }
    const snapshot = getNodeSnapshot(outline, nodeId);
    nodeSnapshots.set(nodeId, snapshot);
    return snapshot;
  };

  const ensureEdgeSnapshot = (edgeId: EdgeId): EdgeSnapshot | null => {
    const snapshot = outline.edges.has(edgeId) ? getEdgeSnapshot(outline, edgeId) : null;
    if (snapshot) {
      edgeSnapshots.set(edgeId, snapshot);
    } else {
      edgeSnapshots.delete(edgeId);
    }
    return snapshot;
  };

  const normaliseWhitespace = (value: string): string => value.replace(/\s+/gu, " ").trim();

  const normaliseSegment = (text: string): { original: string; normalized: string } => {
    const trimmed = normaliseWhitespace(text);
    return {
      original: trimmed,
      normalized: trimmed.toLowerCase()
    };
  };

  const toIsoString = (timestamp: number): string => {
    if (!Number.isFinite(timestamp) || timestamp <= 0) {
      return "";
    }
    try {
      return new Date(timestamp).toISOString().toLowerCase();
    } catch {
      return "";
    }
  };

  const deriveNodeType = (metadata: NodeMetadata): { value: string; normalized: string } => {
    if (metadata.todo) {
      const type = metadata.todo.done ? "todo:done" : "todo";
      return { value: type, normalized: type };
    }
    const fallback = "node";
    return { value: fallback, normalized: fallback };
  };

  const extractTagTokens = (
    snapshot: NodeSnapshot
  ): { values: readonly string[]; normalized: readonly string[] } => {
    const values: string[] = [];
    const normalizedSet = new Set<string>();

    const append = (raw: string) => {
      const trimmed = raw.trim();
      if (trimmed.length === 0) {
        return;
      }
      const normalized = trimmed.toLowerCase();
      if (normalizedSet.has(normalized)) {
        return;
      }
      normalizedSet.add(normalized);
      values.push(trimmed);
    };

    snapshot.metadata.tags.forEach((tag) => append(tag));

    snapshot.inlineContent.forEach((span) => {
      const explicitTag = span.marks.find((mark) => mark.type === "tag");
      if (explicitTag) {
        const attrs = explicitTag.attrs as Record<string, unknown>;
        const labelAttr = attrs.label;
        if (typeof labelAttr === "string") {
          append(labelAttr);
        } else {
          const legacyValue = attrs.tag ?? attrs.value;
          if (typeof legacyValue === "string") {
            append(legacyValue);
          }
        }
      }
      for (const match of span.text.matchAll(TAG_TEXT_PATTERN)) {
        const captured = match[2] ?? "";
        if (captured.length > 0) {
          append(captured);
        }
      }
    });

    return {
      values,
      normalized: Array.from(normalizedSet)
    };
  };

  const buildDocument = (
    edge: EdgeSnapshot,
    node: NodeSnapshot,
    pathSegments: readonly string[],
    normalizedPathSegments: readonly string[]
  ): SearchIndexDocument => {
    const normalizedPath = normalizedPathSegments.join("/");
    const tagTokens = extractTagTokens(node);
    const { value: nodeType, normalized: normalizedType } = deriveNodeType(node.metadata);

    const text = normaliseWhitespace(node.text);
    const normalizedText = text.toLowerCase();

    const createdAtIso = toIsoString(node.metadata.createdAt);
    const updatedAtIso = toIsoString(node.metadata.updatedAt);

    return {
      edgeId: edge.id,
      nodeId: node.id,
      text,
      normalizedText,
      pathSegments,
      normalizedPathSegments,
      normalizedPath,
      tags: tagTokens.values,
      normalizedTags: tagTokens.normalized,
      type: nodeType,
      normalizedType,
      createdAt: node.metadata.createdAt,
      updatedAt: node.metadata.updatedAt,
      createdAtIso,
      updatedAtIso
    };
  };

  const computeCanonicalParentEdgeId = (edge: EdgeSnapshot): EdgeId | null => {
    if (edge.parentNodeId === null) {
      return null;
    }
    return canonicalEdgeByNodeId.get(edge.parentNodeId) ?? null;
  };

  const computePathForEdge = (
    edgeId: EdgeId,
    visited: Set<EdgeId> = new Set()
  ): { segments: readonly string[]; normalized: readonly string[] } => {
    if (visited.has(edgeId)) {
      return { segments: [], normalized: [] };
    }
    visited.add(edgeId);

    const cachedSegments = pathSegmentsByEdgeId.get(edgeId);
    const cachedNormalized = normalizedPathSegmentsByEdgeId.get(edgeId);
    if (cachedSegments && cachedNormalized) {
      return { segments: cachedSegments, normalized: cachedNormalized };
    }

    const edge = edgeSnapshots.get(edgeId) ?? ensureEdgeSnapshot(edgeId);
    if (!edge) {
      return { segments: [], normalized: [] };
    }

    const node = nodeSnapshots.get(edge.childNodeId) ?? ensureNodeSnapshot(edge.childNodeId);
    if (!node) {
      return { segments: [], normalized: [] };
    }

    const parentEdgeId = computeCanonicalParentEdgeId(edge);
    const parentPath = parentEdgeId
      ? computePathForEdge(parentEdgeId, visited)
      : { segments: [] as string[], normalized: [] as string[] };

    const segment = normaliseSegment(node.text);
    const segments = [...parentPath.segments, segment.original];
    const normalized = [...parentPath.normalized, segment.normalized];

    pathSegmentsByEdgeId.set(edge.id, segments);
    normalizedPathSegmentsByEdgeId.set(edge.id, normalized);

    return { segments, normalized };
  };

  const updateCanonicalDocument = (
    edgeId: EdgeId,
    parentSegments: readonly string[],
    parentNormalizedSegments: readonly string[],
    visitednodes: Set<NodeId>
  ) => {
    const edge = edgeSnapshots.get(edgeId) ?? ensureEdgeSnapshot(edgeId);
    if (!edge) {
      documents.delete(edgeId);
      pathSegmentsByEdgeId.delete(edgeId);
      normalizedPathSegmentsByEdgeId.delete(edgeId);
      const nodeId = nodeIdByCanonicalEdgeId.get(edgeId);
      if (nodeId) {
        nodeSnapshots.delete(nodeId);
        nodeIdByCanonicalEdgeId.delete(edgeId);
        canonicalEdgeByNodeId.delete(nodeId);
      }
      return;
    }

    const node = ensureNodeSnapshot(edge.childNodeId);
    if (!node) {
      documents.delete(edgeId);
      pathSegmentsByEdgeId.delete(edgeId);
      normalizedPathSegmentsByEdgeId.delete(edgeId);
      nodeSnapshots.delete(edge.childNodeId);
      nodeIdByCanonicalEdgeId.delete(edgeId);
      canonicalEdgeByNodeId.delete(edge.childNodeId);
      return;
    }

    if (visitednodes.has(node.id)) {
      return;
    }
    visitednodes.add(node.id);

    const segment = normaliseSegment(node.text);
    const pathSegments = [...parentSegments, segment.original];
    const normalizedPathSegments = [...parentNormalizedSegments, segment.normalized];
    const document = buildDocument(edge, node, pathSegments, normalizedPathSegments);

    documents.set(edgeId, document);
    pathSegmentsByEdgeId.set(edgeId, pathSegments);
    normalizedPathSegmentsByEdgeId.set(edgeId, normalizedPathSegments);
    nodeIdByCanonicalEdgeId.set(edgeId, node.id);
    canonicalEdgeByNodeId.set(node.id, edgeId);

    const childEdges = outline.childEdgeMap.get(node.id);
    if (!childEdges) {
      return;
    }

    childEdges.toArray().forEach((childEdgeId) => {
      const snapshot = edgeSnapshots.get(childEdgeId as EdgeId) ?? ensureEdgeSnapshot(childEdgeId as EdgeId);
      if (!snapshot) {
        return;
      }
      const canonicalChildEdgeId = canonicalEdgeByNodeId.get(snapshot.childNodeId);
      if (!canonicalChildEdgeId) {
        return;
      }
      const canonicalChild = edgeSnapshots.get(canonicalChildEdgeId) ?? ensureEdgeSnapshot(canonicalChildEdgeId);
      if (!canonicalChild) {
        return;
      }
      if (canonicalChild.parentNodeId !== node.id) {
        return;
      }
      updateCanonicalDocument(
        canonicalChildEdgeId,
        pathSegments,
        normalizedPathSegments,
        visitednodes
      );
    });
  };

  const rebuildAll = () => {
    documents.clear();
    nodeSnapshots.clear();
    edgeSnapshots.clear();
    canonicalEdgeByNodeId.clear();
    nodeIdByCanonicalEdgeId.clear();
    pathSegmentsByEdgeId.clear();
    normalizedPathSegmentsByEdgeId.clear();

    outline.nodes.forEach((_record, key) => {
      const id = key as NodeId;
      const snapshot = getNodeSnapshot(outline, id);
      nodeSnapshots.set(id, snapshot);
    });
    outline.edges.forEach((_record, key) => {
      const id = key as EdgeId;
      const snapshot = getEdgeSnapshot(outline, id);
      edgeSnapshots.set(id, snapshot);
      if (snapshot.mirrorOfNodeId === null) {
        canonicalEdgeByNodeId.set(snapshot.childNodeId, snapshot.id);
        nodeIdByCanonicalEdgeId.set(snapshot.id, snapshot.childNodeId);
      }
    });

    const visitedNodes = new Set<NodeId>();
    const roots: EdgeId[] = [];
    canonicalEdgeByNodeId.forEach((edgeId) => {
      const snapshot = edgeSnapshots.get(edgeId);
      if (snapshot && snapshot.parentNodeId === null) {
        roots.push(edgeId);
      }
    });

    const queue: Array<{
      edgeId: EdgeId;
      parentSegments: readonly string[];
      parentNormalized: readonly string[];
    }> = roots.map((edgeId) => ({
      edgeId,
      parentSegments: [],
      parentNormalized: []
    }));

    const processed = new Set<EdgeId>();

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) {
        break;
      }
      const { edgeId, parentSegments, parentNormalized } = current;
      if (processed.has(edgeId)) {
        continue;
      }
      processed.add(edgeId);

      const edge = edgeSnapshots.get(edgeId);
      if (!edge) {
        continue;
      }

      const node = nodeSnapshots.get(edge.childNodeId);
      if (!node) {
        continue;
      }
      if (visitedNodes.has(node.id)) {
        continue;
      }

      const segment = normaliseSegment(node.text);
      const pathSegments = [...parentSegments, segment.original];
      const normalizedPathSegments = [...parentNormalized, segment.normalized];
      const document = buildDocument(edge, node, pathSegments, normalizedPathSegments);

      documents.set(edgeId, document);
      pathSegmentsByEdgeId.set(edgeId, pathSegments);
      normalizedPathSegmentsByEdgeId.set(edgeId, normalizedPathSegments);
      visitedNodes.add(node.id);

      const childEdges = outline.childEdgeMap.get(node.id);
      if (!childEdges) {
        continue;
      }
      childEdges.toArray().forEach((childEdgeId) => {
        const snapshot = edgeSnapshots.get(childEdgeId as EdgeId);
        if (!snapshot) {
          return;
        }
        const canonicalChildEdgeId = canonicalEdgeByNodeId.get(snapshot.childNodeId);
        if (!canonicalChildEdgeId) {
          return;
        }
        const canonicalChild = edgeSnapshots.get(canonicalChildEdgeId);
        if (!canonicalChild) {
          return;
        }
        if (canonicalChild.parentNodeId !== node.id) {
          return;
        }
        queue.push({
          edgeId: canonicalChildEdgeId,
          parentSegments: pathSegments,
          parentNormalized: normalizedPathSegments
        });
      });
    }

    // Handle detached canonical edges (should be rare, defensive guard).
    canonicalEdgeByNodeId.forEach((edgeId) => {
      if (documents.has(edgeId)) {
        return;
      }
      const edge = edgeSnapshots.get(edgeId);
      if (!edge) {
        return;
      }
      const path = computePathForEdge(edgeId);
      const node = nodeSnapshots.get(edge.childNodeId);
      if (!node) {
        return;
      }
      const document = buildDocument(edge, node, path.segments, path.normalized);
      documents.set(edgeId, document);
    });
  };

  const scheduleFlush = () => {
    if (flushScheduled) {
      return;
    }
    flushScheduled = true;
    enqueueMicrotask(flushPendingUpdates);
  };

  const flushPendingUpdates = () => {
    flushScheduled = false;
    if (structuralRebuildPending) {
      structuralRebuildPending = false;
      pendingNodeUpdates.clear();
      rebuildAll();
      return;
    }
    if (pendingNodeUpdates.size === 0) {
      return;
    }

    const updates = Array.from(pendingNodeUpdates.entries());
    pendingNodeUpdates.clear();

    const processedNodes = new Set<NodeId>();
    updates.forEach(([nodeId, scope]) => {
      if (processedNodes.has(nodeId)) {
        return;
      }
      processedNodes.add(nodeId);
      if (scope === "subtree") {
        const edgeId = canonicalEdgeByNodeId.get(nodeId);
        if (!edgeId) {
          return;
        }
        const parentEdgeId = computeCanonicalParentEdgeId(edgeSnapshots.get(edgeId) ?? ensureEdgeSnapshot(edgeId) ?? {
          id: edgeId,
          parentNodeId: null,
          childNodeId: nodeId,
          collapsed: false,
          mirrorOfNodeId: null,
          canonicalEdgeId: edgeId,
          position: 0
        });
        const parentPath = parentEdgeId
          ? {
              segments: pathSegmentsByEdgeId.get(parentEdgeId) ?? computePathForEdge(parentEdgeId).segments,
              normalized:
                normalizedPathSegmentsByEdgeId.get(parentEdgeId)
                ?? computePathForEdge(parentEdgeId).normalized
            }
          : { segments: [] as string[], normalized: [] as string[] };
        updateCanonicalDocument(edgeId, parentPath.segments, parentPath.normalized, new Set());
        return;
      }

      const edgeId = canonicalEdgeByNodeId.get(nodeId);
      if (!edgeId) {
        return;
      }

      const edge = edgeSnapshots.get(edgeId) ?? ensureEdgeSnapshot(edgeId);
      const node = ensureNodeSnapshot(nodeId);
      if (!edge || !node) {
        return;
      }
      const path = computePathForEdge(edgeId);
      const document = buildDocument(edge, node, path.segments, path.normalized);
      documents.set(edgeId, document);
      pathSegmentsByEdgeId.set(edgeId, path.segments);
      normalizedPathSegmentsByEdgeId.set(edgeId, path.normalized);
    });
  };

  const markStructuralChange = () => {
    structuralRebuildPending = true;
    scheduleFlush();
  };

  const markNodeUpdate = (nodeId: NodeId, scope: UpdateScope) => {
    const existing = pendingNodeUpdates.get(nodeId);
    if (existing === "subtree" || scope === "subtree") {
      pendingNodeUpdates.set(nodeId, "subtree");
    } else {
      pendingNodeUpdates.set(nodeId, scope);
    }
    scheduleFlush();
  };

  const determineScopeForEvent = (event: YEvent<AbstractType<unknown>>): UpdateScope => {
    if (event.path.length > 1) {
      const key = event.path[1];
      if (key === NODE_TEXT_XML_KEY) {
        return "subtree";
      }
      if (key === NODE_METADATA_KEY) {
        return "self";
      }
    }
    return "self";
  };

  const compiledComparator = (expression: SearchExpression): CompiledEvaluation => {
    const descriptors = new Map<SearchPredicateExpression, SearchFilterDescriptor>();
    const filters: SearchFilterDescriptor[] = [];

    const visit = (candidate: SearchExpression) => {
      switch (candidate.type) {
        case "predicate": {
          const descriptor = compilePredicate(candidate);
          descriptors.set(candidate, descriptor);
          filters.push(descriptor);
          break;
        }
        case "not":
          visit(candidate.operand);
          break;
        case "binary":
          visit(candidate.left);
          visit(candidate.right);
          break;
        case "group":
          visit(candidate.expression);
          break;
        default:
          break;
      }
    };

    visit(expression);

    return {
      evaluation: {
        expression,
        filters
      },
      descriptors
    };
  };

  const compilePredicate = (predicate: SearchPredicateExpression): SearchFilterDescriptor => {
    const { field, comparator, value } = predicate;
    if (isRangeLiteral(value)) {
      return {
        field,
        comparator: "range",
        value: compileRangeValue(field, value)
      };
    }
    return {
      field,
      comparator,
      value: compileLiteral(field, value)
    };
  };

  const isRangeLiteral = (literal: SearchLiteral | SearchRangeLiteral): literal is SearchRangeLiteral => {
    return (literal as SearchRangeLiteral).kind === "range";
  };

  const compileLiteral = (field: SearchField, literal: SearchLiteral): SearchCompiledValue => {
    if (literal.kind === "date") {
      return {
        kind: "date",
        value: literal.value
      } satisfies SearchCompiledDateValue;
    }

    const normalized = literal.value.toLowerCase();
    switch (field) {
      case "path": {
        const segments =
          literal.value
            .split("/")
            .map((segment) => segment.trim())
            .filter((segment) => segment.length > 0);
        const normalizedSegments = segments.map((segment) => segment.toLowerCase());
        return {
          kind: "path",
          segments,
          normalized: normalizedSegments
        } satisfies SearchCompiledPathValue;
      }
      case "tag":
        return {
          kind: "tag",
          value: literal.value,
          normalized
        } satisfies SearchCompiledTagValue;
      case "type":
        return {
          kind: "type",
          value: literal.value,
          normalized
        } satisfies SearchCompiledTypeValue;
      default:
        return {
          kind: "string",
          value: literal.value,
          normalized
        } satisfies SearchCompiledStringValue;
    }
  };

  const compileBoundary = (
    literal: SearchLiteral
  ): SearchCompiledComparableBoundary => {
    if (literal.kind === "date") {
      return {
        value: literal.value,
        inclusive: true
      };
    }
    const normalized = literal.value.toLowerCase();
    return {
      value: literal.value,
      normalized,
      inclusive: true
    };
  };

  const compileRangeValue = (
    field: SearchField,
    literal: SearchRangeLiteral
  ): SearchCompiledRangeValue => {
    const start = literal.start ? compileBoundary(literal.start) : undefined;
    const end = literal.end ? compileBoundary(literal.end) : undefined;
    const valueType: SearchCompiledRangeValue["valueType"] =
      field === "created" || field === "updated" || (start && typeof start.value === "number")
        ? "date"
        : "string";
    return {
      kind: "range",
      valueType,
      ...(start ? { start } : {}),
      ...(end ? { end } : {})
    };
  };

  const evaluateExpression = (
    expression: SearchExpression,
    document: SearchIndexDocument,
    descriptors: Map<SearchPredicateExpression, SearchFilterDescriptor>
  ): boolean => {
    switch (expression.type) {
      case "predicate":
        return evaluatePredicate(descriptors.get(expression), document);
      case "not":
        return !evaluateExpression(expression.operand, document, descriptors);
      case "binary":
        if (expression.operator === "AND") {
          return (
            evaluateExpression(expression.left, document, descriptors)
            && evaluateExpression(expression.right, document, descriptors)
          );
        }
        return (
          evaluateExpression(expression.left, document, descriptors)
          || evaluateExpression(expression.right, document, descriptors)
        );
      case "group":
        return evaluateExpression(expression.expression, document, descriptors);
      default:
        return false;
    }
  };

  const evaluatePredicate = (
    descriptor: SearchFilterDescriptor | undefined,
    document: SearchIndexDocument
  ): boolean => {
    if (!descriptor) {
      return false;
    }
    const { field, comparator, value } = descriptor;

    if (comparator === "range") {
      if (value.kind === "range") {
        return evaluateRangePredicate(field, value, document);
      }
      return false;
    }

    switch (field) {
      case "text":
        return evaluateStringComparator(document.normalizedText, value, comparator);
      case "path":
        return evaluatePathComparator(document, value, comparator);
      case "tag":
        return evaluateTagComparator(document, value, comparator);
      case "type":
        return evaluateStringComparator(document.normalizedType, value, comparator);
      case "created":
        return evaluateDateComparator(document.createdAt, document.createdAtIso, value, comparator);
      case "updated":
        return evaluateDateComparator(document.updatedAt, document.updatedAtIso, value, comparator);
      default:
        return false;
    }
  };

  const evaluateStringComparator = (
    haystack: string,
    value: SearchCompiledValue,
    comparator: SearchComparator
  ): boolean => {
    if (value.kind !== "string" && value.kind !== "tag" && value.kind !== "type") {
      return false;
    }
    const needle = value.normalized;
    switch (comparator) {
      case ":":
        return needle.length === 0 ? true : haystack.includes(needle);
      case "=":
        return haystack === needle;
      case "!=":
        return haystack !== needle;
      case ">":
        return haystack > needle;
      case ">=":
        return haystack >= needle;
      case "<":
        return haystack < needle;
      case "<=":
        return haystack <= needle;
      default:
        return false;
    }
  };

  const evaluatePathComparator = (
    document: SearchIndexDocument,
    value: SearchCompiledValue,
    comparator: SearchComparator
  ): boolean => {
    if (value.kind === "path") {
      const query = value.normalized.join("/");
      switch (comparator) {
        case ":":
          return query.length === 0 ? true : document.normalizedPath.includes(query);
        case "=":
          return document.normalizedPath === query;
        case "!=":
          return document.normalizedPath !== query;
        default:
          return false;
      }
    }
    if (value.kind === "string") {
      return evaluateStringComparator(document.normalizedPath, value, comparator);
    }
    return false;
  };

  const evaluateTagComparator = (
    document: SearchIndexDocument,
    value: SearchCompiledValue,
    comparator: SearchComparator
  ): boolean => {
    if (value.kind !== "tag" && value.kind !== "string") {
      return false;
    }
    const normalized = value.normalized;
    switch (comparator) {
      case ":":
        return document.normalizedTags.some((tag) => tag === normalized);
      case "=":
        return document.normalizedTags.some((tag) => tag === normalized);
      case "!=":
        return document.normalizedTags.every((tag) => tag !== normalized);
      default:
        return false;
    }
  };

  const evaluateDateComparator = (
    timestamp: number,
    iso: string,
    value: SearchCompiledValue,
    comparator: SearchComparator
  ): boolean => {
    if (value.kind === "date") {
      return compareNumeric(timestamp, value.value, comparator);
    }
    if (value.kind === "string") {
      return evaluateStringComparator(iso, value, comparator);
    }
    return false;
  };

  const compareNumeric = (candidate: number, target: number, comparator: SearchComparator): boolean => {
    switch (comparator) {
      case ":":
      case "=":
        return candidate === target;
      case "!=":
        return candidate !== target;
      case ">":
        return candidate > target;
      case ">=":
        return candidate >= target;
      case "<":
        return candidate < target;
      case "<=":
        return candidate <= target;
      default:
        return false;
    }
  };

  const evaluateRangePredicate = (
    field: SearchField,
    value: SearchCompiledRangeValue,
    document: SearchIndexDocument
  ): boolean => {
    const candidate = getComparableValue(field, value.valueType, document);
    if (candidate === null) {
      return false;
    }
    if (value.start) {
      if (!evaluateBoundary(candidate, value.start, "start")) {
        return false;
      }
    }
    if (value.end) {
      if (!evaluateBoundary(candidate, value.end, "end")) {
        return false;
      }
    }
    return true;
  };

  const getComparableValue = (
    field: SearchField,
    valueType: SearchCompiledRangeValue["valueType"],
    document: SearchIndexDocument
  ): string | number | null => {
    switch (field) {
      case "created":
        return valueType === "date" ? document.createdAt : document.createdAtIso;
      case "updated":
        return valueType === "date" ? document.updatedAt : document.updatedAtIso;
      case "text":
        return valueType === "date" ? null : document.normalizedText;
      case "path":
        return valueType === "date" ? null : document.normalizedPath;
      case "tag":
        return valueType === "date" ? null : document.normalizedTags.join(" ");
      case "type":
        return valueType === "date" ? null : document.normalizedType;
      default:
        return null;
    }
  };

  const evaluateBoundary = (
    candidate: string | number,
    boundary: SearchCompiledComparableBoundary,
    position: "start" | "end"
  ): boolean => {
    if (typeof candidate === "number" && typeof boundary.value === "number") {
      if (position === "start") {
        return boundary.inclusive ? candidate >= boundary.value : candidate > boundary.value;
      }
      return boundary.inclusive ? candidate <= boundary.value : candidate < boundary.value;
    }

    const comparableCandidate =
      typeof candidate === "string"
        ? candidate
        : new Date(candidate).toISOString().toLowerCase();
    const boundaryValue =
      typeof boundary.value === "string"
        ? (boundary.normalized ?? boundary.value.toLowerCase())
        : new Date(boundary.value).toISOString().toLowerCase();

    if (position === "start") {
      return boundary.inclusive
        ? comparableCandidate >= boundaryValue
        : comparableCandidate > boundaryValue;
    }
    return boundary.inclusive
      ? comparableCandidate <= boundaryValue
      : comparableCandidate < boundaryValue;
  };

  const rebuildFromSnapshot = () => {
    structuralRebuildPending = false;
    pendingNodeUpdates.clear();
    flushScheduled = false;
    rebuildAll();
  };

  const applyTransactionalUpdates = (event: YEvent<AbstractType<unknown>>) => {
    if (event.target === outline.nodes) {
      markStructuralChange();
      return;
    }
    if (event.target === outline.edges) {
      markStructuralChange();
      return;
    }
    if (event.target === outline.rootEdges || event.target === outline.childEdgeMap) {
      markStructuralChange();
      return;
    }

    if (event.path.length === 0) {
      return;
    }
    const candidate = event.path[0];
    if (typeof candidate !== "string") {
      return;
    }
    const nodeId = candidate as NodeId;
    const scope = determineScopeForEvent(event);
    markNodeUpdate(nodeId, scope);
  };

  const runQuery = (expression: SearchExpression): SearchIndexQueryResult => {
    flushPendingUpdates();
    const compiled = compiledComparator(expression);
    const matches: EdgeId[] = [];
    documents.forEach((document, edgeId) => {
      if (evaluateExpression(compiled.evaluation.expression, document, compiled.descriptors)) {
        matches.push(edgeId);
      }
    });
    return {
      matches,
      evaluation: compiled.evaluation
    };
  };

  return {
    rebuildFromSnapshot,
    applyTransactionalUpdates,
    runQuery
  };
};
