import type { EdgeId } from "../ids";
import type { OutlineSnapshot } from "../types";
import type { OutlineSearchIndex } from "./index";
import { evaluateMatches } from "./evaluator";
import { parseSearchQuery } from "./parser";
import type { OutlineSearchExecution } from "./types";

const collectAncestors = (
  matchedEdgeIds: ReadonlySet<EdgeId>,
  index: OutlineSearchIndex
): ReadonlySet<EdgeId> => {
  const visible = new Set<EdgeId>();
  const entries = index.getEntries();
  matchedEdgeIds.forEach((edgeId) => {
    const entry = entries.get(edgeId);
    if (!entry) {
      return;
    }
    visible.add(edgeId);
    entry.ancestorEdgeIds.forEach((ancestorEdgeId) => {
      visible.add(ancestorEdgeId);
    });
  });
  return visible;
};

const computePartialVisibility = (
  visibleEdgeIds: ReadonlySet<EdgeId>,
  index: OutlineSearchIndex,
  snapshot: OutlineSnapshot
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
    childEdgeIds.forEach((childEdgeId) => {
      if (visibleEdgeIds.has(childEdgeId)) {
        visibleCount += 1;
      }
    });
    if (visibleCount !== childEdgeIds.length) {
      partial.add(edgeId);
    }
  });
  return partial;
};

export const executeOutlineSearch = (
  query: string,
  index: OutlineSearchIndex,
  snapshot: OutlineSnapshot
): OutlineSearchExecution => {
  const parseResult = parseSearchQuery(query);
  const matchedEdgeIds = evaluateMatches(index.getEntries(), snapshot, parseResult.expression);
  const visibleEdgeIds = collectAncestors(matchedEdgeIds, index);
  const partiallyVisibleEdgeIds = computePartialVisibility(visibleEdgeIds, index, snapshot);
  return {
    query,
    expression: parseResult.expression,
    errors: parseResult.errors,
    matchedEdgeIds,
    visibleEdgeIds,
    partiallyVisibleEdgeIds
  } satisfies OutlineSearchExecution;
};

