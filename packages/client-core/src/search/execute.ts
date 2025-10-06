import type { EdgeId } from "../ids";
import type { OutlineSnapshot } from "../types";
import type { OutlineSearchIndex } from "./index";
import { evaluateMatches } from "./evaluator";
import { parseSearchQuery } from "./parser";
import type { OutlineSearchExecution, OutlineSearchOptions } from "./types";

const collectAncestors = (
  matchedEdgeIds: ReadonlySet<EdgeId>,
  index: OutlineSearchIndex,
  scopedEdgeIds: ReadonlySet<EdgeId> | null
): ReadonlySet<EdgeId> => {
  const visible = new Set<EdgeId>();
  const entries = index.getEntries();
  matchedEdgeIds.forEach((edgeId) => {
    const entry = entries.get(edgeId);
    if (!entry) {
      return;
    }
    if (scopedEdgeIds && !scopedEdgeIds.has(edgeId)) {
      return;
    }
    visible.add(edgeId);
    entry.ancestorEdgeIds.forEach((ancestorEdgeId) => {
      if (scopedEdgeIds && !scopedEdgeIds.has(ancestorEdgeId)) {
        return;
      }
      visible.add(ancestorEdgeId);
    });
  });
  return visible;
};

const computePartialVisibility = (
  visibleEdgeIds: ReadonlySet<EdgeId>,
  index: OutlineSearchIndex,
  snapshot: OutlineSnapshot,
  scopedEdgeIds: ReadonlySet<EdgeId> | null
): ReadonlySet<EdgeId> => {
  const partial = new Set<EdgeId>();
  const entries = index.getEntries();
  visibleEdgeIds.forEach((edgeId) => {
    const entry = entries.get(edgeId);
    if (!entry) {
      return;
    }
    const childEdgeIds = snapshot.childrenByParent.get(entry.nodeId) ?? [];
    if (childEdgeIds.length === 0) {
      return;
    }
    let visibleCount = 0;
    let scopedChildCount = 0;
    childEdgeIds.forEach((childEdgeId) => {
      if (scopedEdgeIds && !scopedEdgeIds.has(childEdgeId)) {
        return;
      }
      scopedChildCount += 1;
      if (visibleEdgeIds.has(childEdgeId)) {
        visibleCount += 1;
      }
    });
    if (scopedChildCount > 0 && visibleCount !== scopedChildCount) {
      partial.add(edgeId);
    }
  });
  return partial;
};

const collectScopedEdgeIds = (
  scopeRootEdgeId: EdgeId | null,
  snapshot: OutlineSnapshot
): ReadonlySet<EdgeId> | null => {
  if (!scopeRootEdgeId) {
    return null;
  }
  if (!snapshot.edges.has(scopeRootEdgeId)) {
    return new Set<EdgeId>();
  }
  const scoped = new Set<EdgeId>();
  const visit = (edgeId: EdgeId) => {
    if (scoped.has(edgeId)) {
      return;
    }
    const edge = snapshot.edges.get(edgeId);
    if (!edge) {
      return;
    }
    scoped.add(edgeId);
    const childEdgeIds = snapshot.childrenByParent.get(edge.childNodeId) ?? [];
    childEdgeIds.forEach((childEdgeId) => visit(childEdgeId));
  };
  visit(scopeRootEdgeId);
  return scoped;
};

export const executeOutlineSearch = (
  query: string,
  index: OutlineSearchIndex,
  snapshot: OutlineSnapshot,
  options?: OutlineSearchOptions
): OutlineSearchExecution => {
  const parseResult = parseSearchQuery(query);
  const scopedEdgeIds = collectScopedEdgeIds(options?.scopeRootEdgeId ?? null, snapshot);
  const rawMatches = evaluateMatches(index.getEntries(), snapshot, parseResult.expression);
  const matchedEdgeIds = scopedEdgeIds === null
    ? rawMatches
    : new Set<EdgeId>(Array.from(rawMatches).filter((edgeId) => scopedEdgeIds.has(edgeId)));
  const visibleEdgeIds = collectAncestors(matchedEdgeIds, index, scopedEdgeIds);
  const partiallyVisibleEdgeIds = computePartialVisibility(visibleEdgeIds, index, snapshot, scopedEdgeIds);
  return {
    query,
    expression: parseResult.expression,
    errors: parseResult.errors,
    matchedEdgeIds,
    visibleEdgeIds,
    partiallyVisibleEdgeIds
  } satisfies OutlineSearchExecution;
};
