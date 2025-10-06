/**
 * Pure selectors that convert the collaborative outline snapshot into immutable tree
 * structures suitable for rendering. These helpers never leak live Yjs references and can
 * therefore be safely memoised inside UI layers.
 */
import type { EdgeId, NodeId } from "./ids";
import { OutlineError } from "./doc/index";
import type { OutlineSnapshot, OutlineTreeNode, EdgeSnapshot, NodeSnapshot } from "./types";

interface FocusPathCandidate {
  readonly edgeIds: readonly EdgeId[];
  readonly nodeIds: readonly NodeId[];
}

export interface PaneStateLike {
  readonly rootEdgeId: EdgeId | null;
  readonly collapsedEdgeIds: ReadonlyArray<EdgeId>;
  readonly quickFilter?: string;
  readonly activeEdgeId?: EdgeId | null;
  /**
   * Optional hint describing the edge path from the document root to the focused edge. When
   * present we validate it against the snapshot before using it to avoid corrupt history due
   * to concurrent edits.
   */
  readonly focusPathEdgeIds?: ReadonlyArray<EdgeId>;
  readonly search?: PaneSearchOverlayLike;
}

export interface PaneSearchOverlayLike {
  readonly appliedQuery?: string;
  readonly matchedEdgeIds?: ReadonlyArray<EdgeId>;
  readonly visibleEdgeIds?: ReadonlyArray<EdgeId>;
  readonly partialEdgeIds?: ReadonlyArray<EdgeId>;
  readonly stickyEdgeIds?: ReadonlyArray<EdgeId>;
}

export interface PaneOutlineRow {
  readonly edge: EdgeSnapshot;
  readonly node: NodeSnapshot;
  /** Depth relative to the current display context (focus children render at depth 0). */
  readonly depth: number;
  /** Depth within the full outline irrespective of focus. */
  readonly treeDepth: number;
  readonly parentNodeId: NodeId | null;
  readonly hasChildren: boolean;
  readonly collapsed: boolean;
  /** Edge ancestry excluding the current row, ordered from root to immediate parent. */
  readonly ancestorEdgeIds: ReadonlyArray<EdgeId>;
  /**
   * Node ancestry aligned with {@link ancestorEdgeIds}; each entry is the node referenced by
   * the edge at the same index.
   */
  readonly ancestorNodeIds: ReadonlyArray<NodeId>;
  readonly search?: {
    readonly isMatch: boolean;
    readonly isPartial: boolean;
  };
}

export interface PaneFocusPathSegment {
  readonly edge: EdgeSnapshot;
  readonly node: NodeSnapshot;
}

export interface PaneFocusContext {
  readonly edge: EdgeSnapshot;
  readonly node: NodeSnapshot;
  /** Ordered from root-most edge to the focused edge (inclusive). */
  readonly path: ReadonlyArray<PaneFocusPathSegment>;
  /** Ordered from root-most edge to the immediate parent (excludes focused edge). */
  readonly ancestorPath: ReadonlyArray<PaneFocusPathSegment>;
  /** Depth within the full outline (root edges have depth 0). */
  readonly treeDepth: number;
}

export interface PaneRowsResult {
  readonly rows: ReadonlyArray<PaneOutlineRow>;
  readonly appliedFilter?: string;
  readonly focus?: PaneFocusContext | null;
}

export interface BreadcrumbMeasurement {
  readonly width: number;
}

export interface BreadcrumbDisplayPlan {
  /** Indices of breadcrumb segments that should be rendered, sorted ascending. */
  readonly visibleIndices: ReadonlyArray<number>;
  /** Inclusive index ranges that should be collapsed behind an ellipsis. */
  readonly collapsedRanges: ReadonlyArray<readonly [number, number]>;
  /** True when the visible segments and ellipses fit within {@link availableWidth}. */
  readonly fitsWithinWidth: boolean;
  /** Actual width required by the chosen plan (segments + ellipses). */
  readonly requiredWidth: number;
}

export const getSnapshotChildEdgeIds = (
  snapshot: OutlineSnapshot,
  parentNodeId: NodeId
): ReadonlyArray<EdgeId> => {
  return snapshot.childrenByParent.get(parentNodeId) ?? [];
};

export const buildOutlineForest = (snapshot: OutlineSnapshot): ReadonlyArray<OutlineTreeNode> => {
  const buildTree = (edgeId: EdgeId, visited: Set<EdgeId>): OutlineTreeNode => {
    if (visited.has(edgeId)) {
      throw new OutlineError(`Snapshot already visited edge ${edgeId}; cycle suspected`);
    }

    const edge = snapshot.edges.get(edgeId);
    if (!edge) {
      throw new OutlineError(`Edge ${edgeId} missing from snapshot`);
    }

    const node = snapshot.nodes.get(edge.childNodeId);
    if (!node) {
      throw new OutlineError(`Node ${edge.childNodeId} missing from snapshot`);
    }

    visited.add(edgeId);
    const childEdgeIds = getSnapshotChildEdgeIds(snapshot, edge.childNodeId);
    const children = childEdgeIds.map((childId) => buildTree(childId, visited));
    visited.delete(edgeId);

    return {
      edge,
      node,
      children
    };
  };

  return snapshot.rootEdgeIds.map((edgeId) => buildTree(edgeId, new Set<EdgeId>()));
};

export const buildPaneRows = (
  snapshot: OutlineSnapshot,
  paneState: PaneStateLike
): PaneRowsResult => {
  const collapsedOverride = new Set(paneState.collapsedEdgeIds ?? []);
  const appliedFilter = normaliseQuickFilter(paneState.quickFilter);
  const rows: PaneOutlineRow[] = [];
  const searchOverlay = paneState.search;
  const searchActive = Boolean(searchOverlay?.appliedQuery);
  const searchMatched = searchActive ? new Set(searchOverlay?.matchedEdgeIds ?? []) : null;
  const searchVisible = searchActive ? new Set(searchOverlay?.visibleEdgeIds ?? []) : null;
  const searchPartial = searchActive ? new Set(searchOverlay?.partialEdgeIds ?? []) : null;
  const searchSticky = searchActive ? new Set(searchOverlay?.stickyEdgeIds ?? []) : null;
  const hasSearchRenderableEdges = searchActive
    && ((searchVisible?.size ?? 0) > 0 || (searchMatched?.size ?? 0) > 0 || (searchSticky?.size ?? 0) > 0);

  const focus = resolveFocusContext(snapshot, paneState);
  const focusDepth = focus ? focus.path.length : 0;

  const buildRowsFromEdge = (
    edgeId: EdgeId,
    ancestorEdges: EdgeId[],
    ancestorNodes: NodeId[]
  ): boolean => {
    if (ancestorEdges.includes(edgeId)) {
      return false;
    }

    const edge = snapshot.edges.get(edgeId);
    if (!edge) {
      return false;
    }
    const node = snapshot.nodes.get(edge.childNodeId);
    if (!node) {
      return false;
    }

    const treeDepth = ancestorEdges.length;
    const displayDepth = focus ? Math.max(0, treeDepth - focusDepth) : treeDepth;
    const childEdgeIds = snapshot.childrenByParent.get(node.id) ?? [];
    const effectiveCollapsed = collapsedOverride.has(edgeId) || edge.collapsed;
    if (!searchActive) {
      const row: PaneOutlineRow = {
        edge,
        node,
        depth: displayDepth,
        treeDepth,
        parentNodeId: edge.parentNodeId,
        hasChildren: childEdgeIds.length > 0,
        collapsed: effectiveCollapsed,
        ancestorEdgeIds: ancestorEdges.slice(),
        ancestorNodeIds: ancestorNodes.slice()
      } satisfies PaneOutlineRow;
      rows.push(row);
      if (!effectiveCollapsed && childEdgeIds.length > 0) {
        ancestorEdges.push(edgeId);
        ancestorNodes.push(node.id);
        childEdgeIds.forEach((childEdgeId) => {
          buildRowsFromEdge(childEdgeId, ancestorEdges, ancestorNodes);
        });
        ancestorEdges.pop();
        ancestorNodes.pop();
      }
      return true;
    }

    const rowAncestorEdges = ancestorEdges.slice();
    const rowAncestorNodes = ancestorNodes.slice();
    const isStickyEdge = searchSticky?.has(edgeId) ?? false;
    const isVisibleBySearch = searchVisible?.has(edgeId) ?? false;
    const isPartialEdge = searchPartial?.has(edgeId) ?? false;
    const collapsedForSearch = isPartialEdge ? false : effectiveCollapsed;

    const childRowStartIndex = rows.length;
    let childVisible = false;

    const shouldRecurseIntoChildren = childEdgeIds.length > 0 && (!collapsedForSearch || isPartialEdge);

    if (shouldRecurseIntoChildren) {
      ancestorEdges.push(edgeId);
      ancestorNodes.push(node.id);
      childEdgeIds.forEach((childEdgeId) => {
        const childIncluded = buildRowsFromEdge(childEdgeId, ancestorEdges, ancestorNodes);
        if (childIncluded) {
          childVisible = true;
        }
      });
      ancestorEdges.pop();
      ancestorNodes.pop();
    }

    if (!isVisibleBySearch && !isStickyEdge && !childVisible) {
      return false;
    }

    const row: PaneOutlineRow = {
      edge,
      node,
      depth: displayDepth,
      treeDepth,
      parentNodeId: edge.parentNodeId,
      hasChildren: childEdgeIds.length > 0,
      collapsed: collapsedForSearch,
      ancestorEdgeIds: rowAncestorEdges,
      ancestorNodeIds: rowAncestorNodes,
      search: {
        isMatch: searchMatched?.has(edgeId) ?? false,
        isPartial: isPartialEdge
      }
    } satisfies PaneOutlineRow;

    rows.splice(childRowStartIndex, 0, row);

    return true;
  };

  if (focus) {
    const focusEdgeChildren = snapshot.childrenByParent.get(focus.node.id) ?? [];
    const ancestorEdges = focus.path.map((segment) => segment.edge.id);
    const ancestorNodes = focus.path.map((segment) => segment.node.id);
    if (!searchActive || hasSearchRenderableEdges) {
      focusEdgeChildren.forEach((edgeId) => {
        buildRowsFromEdge(edgeId, [...ancestorEdges], [...ancestorNodes]);
      });
    }
  } else if (paneState.rootEdgeId) {
    if (!searchActive || hasSearchRenderableEdges) {
      buildRowsFromEdge(paneState.rootEdgeId, [], []);
    }
  } else {
    if (!searchActive || hasSearchRenderableEdges) {
      snapshot.rootEdgeIds.forEach((edgeId) => {
        buildRowsFromEdge(edgeId, [], []);
      });
    }
  }

  return {
    rows,
    appliedFilter,
    focus
  };
};

const normaliseQuickFilter = (value: string | undefined): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const resolveFocusContext = (
  snapshot: OutlineSnapshot,
  paneState: PaneStateLike
): PaneFocusContext | null => {
  const focusEdgeId = paneState.rootEdgeId;
  if (!focusEdgeId) {
    return null;
  }

  const edge = snapshot.edges.get(focusEdgeId);
  if (!edge) {
    return null;
  }
  const node = snapshot.nodes.get(edge.childNodeId);
  if (!node) {
    return null;
  }

  const candidatePath = normaliseFocusHint(snapshot, paneState, focusEdgeId);
  const segments = candidatePath
    ? buildPathSegments(snapshot, candidatePath)
    : findFocusPath(snapshot, focusEdgeId);

  if (!segments) {
    return null;
  }

  const treeDepth = segments.length - 1;
  const ancestorPath = segments.slice(0, -1);
  return {
    edge,
    node,
    path: segments,
    ancestorPath,
    treeDepth
  } satisfies PaneFocusContext;
};

const normaliseFocusHint = (
  snapshot: OutlineSnapshot,
  paneState: PaneStateLike,
  focusEdgeId: EdgeId
): FocusPathCandidate | null => {
  const hint = paneState.focusPathEdgeIds;
  if (!hint || hint.length === 0) {
    return null;
  }
  if (hint[hint.length - 1] !== focusEdgeId) {
    return null;
  }

  const edgeIds: EdgeId[] = [];
  const nodeIds: NodeId[] = [];
  for (let index = 0; index < hint.length; index += 1) {
    const edgeId = hint[index];
    const edge = snapshot.edges.get(edgeId);
    if (!edge) {
      return null;
    }
    const node = snapshot.nodes.get(edge.childNodeId);
    if (!node) {
      return null;
    }
    if (index > 0) {
      const previousNodeId = nodeIds[nodeIds.length - 1];
      if (edge.parentNodeId !== previousNodeId) {
        return null;
      }
    } else if (edge.parentNodeId !== null) {
      // First edge must be a root edge.
      return null;
    }
    edgeIds.push(edgeId);
    nodeIds.push(node.id);
  }

  return { edgeIds, nodeIds } satisfies FocusPathCandidate;
};

const buildPathSegments = (
  snapshot: OutlineSnapshot,
  candidate: FocusPathCandidate
): ReadonlyArray<PaneFocusPathSegment> | null => {
  if (candidate.edgeIds.length !== candidate.nodeIds.length) {
    return null;
  }
  const segments: PaneFocusPathSegment[] = [];
  for (let index = 0; index < candidate.edgeIds.length; index += 1) {
    const edgeId = candidate.edgeIds[index];
    const nodeId = candidate.nodeIds[index];
    const edge = snapshot.edges.get(edgeId);
    const node = snapshot.nodes.get(nodeId);
    if (!edge || !node || edge.childNodeId !== node.id) {
      return null;
    }
    // Re-validate the hierarchical link.
    if (index > 0) {
      const parentNodeId = candidate.nodeIds[index - 1];
      if (edge.parentNodeId !== parentNodeId) {
        return null;
      }
    }
    segments.push({ edge, node });
  }
  return segments;
};

const findFocusPath = (
  snapshot: OutlineSnapshot,
  focusEdgeId: EdgeId
): ReadonlyArray<PaneFocusPathSegment> | null => {
  const edgeStack: EdgeId[] = [];
  const nodeStack: NodeId[] = [];
  const visited = new Set<EdgeId>();
  let path: FocusPathCandidate | null = null;

  const traverse = (edgeId: EdgeId): boolean => {
    if (visited.has(edgeId)) {
      return false;
    }
    visited.add(edgeId);

    const edge = snapshot.edges.get(edgeId);
    if (!edge) {
      return false;
    }
    const node = snapshot.nodes.get(edge.childNodeId);
    if (!node) {
      return false;
    }

    edgeStack.push(edgeId);
    nodeStack.push(node.id);

    if (edgeId === focusEdgeId) {
      path = {
        edgeIds: edgeStack.slice(),
        nodeIds: nodeStack.slice()
      } satisfies FocusPathCandidate;
      return true;
    }

    const childEdgeIds = snapshot.childrenByParent.get(node.id) ?? [];
    for (const childEdgeId of childEdgeIds) {
      if (traverse(childEdgeId)) {
        return true;
      }
    }

    edgeStack.pop();
    nodeStack.pop();
    return false;
  };

  for (const rootEdgeId of snapshot.rootEdgeIds) {
    if (traverse(rootEdgeId)) {
      break;
    }
    edgeStack.length = 0;
    nodeStack.length = 0;
  }

  if (!path) {
    return null;
  }

  return buildPathSegments(snapshot, path);
};

// Chooses leading/trailing breadcrumb segments so a single ellipsis can hide any middle gap.
export const planBreadcrumbVisibility = (
  measurements: ReadonlyArray<BreadcrumbMeasurement>,
  availableWidth: number,
  ellipsisWidth: number
): BreadcrumbDisplayPlan => {
  if (measurements.length === 0) {
    return {
      visibleIndices: [],
      collapsedRanges: [],
      fitsWithinWidth: true,
      requiredWidth: 0
    } satisfies BreadcrumbDisplayPlan;
  }

  const count = measurements.length;
  const prefixWidths = new Array<number>(count + 1).fill(0);
  for (let index = 0; index < count; index += 1) {
    const measurement = measurements[index];
    prefixWidths[index + 1] = prefixWidths[index] + (measurement?.width ?? 0);
  }

  const suffixWidths = new Array<number>(count + 1).fill(0);
  for (let offset = 0; offset < count; offset += 1) {
    const measurement = measurements[count - 1 - offset];
    suffixWidths[offset + 1] = suffixWidths[offset] + (measurement?.width ?? 0);
  }

  interface CandidatePlan {
    readonly prefixCount: number;
    readonly suffixCount: number;
    readonly visibleIndices: ReadonlyArray<number>;
    readonly hiddenRange: readonly [number, number] | null;
    readonly totalWidth: number;
    readonly visibleCount: number;
    readonly includesFirst: boolean;
  }

  const buildCandidate = (prefixCount: number, suffixCount: number): CandidatePlan => {
    const hiddenCount = count - prefixCount - suffixCount;
    const totalWidthBase = prefixWidths[prefixCount] + suffixWidths[suffixCount];
    const totalWidth = hiddenCount > 0 ? totalWidthBase + ellipsisWidth : totalWidthBase;

    const visibleIndices: number[] = [];
    for (let index = 0; index < prefixCount; index += 1) {
      visibleIndices.push(index);
    }
    for (let index = count - suffixCount; index < count; index += 1) {
      if (index >= prefixCount) {
        visibleIndices.push(index);
      }
    }

    return {
      prefixCount,
      suffixCount,
      visibleIndices,
      hiddenRange:
        hiddenCount > 0 ? ([prefixCount, count - suffixCount - 1] as const) : null,
      totalWidth,
      visibleCount: count - hiddenCount,
      includesFirst: prefixCount > 0
    } satisfies CandidatePlan;
  };

  const compareCandidates = (left: CandidatePlan, right: CandidatePlan): number => {
    if (left.visibleCount !== right.visibleCount) {
      return left.visibleCount - right.visibleCount;
    }
    if (left.includesFirst !== right.includesFirst) {
      return Number(left.includesFirst) - Number(right.includesFirst);
    }
    if (left.suffixCount !== right.suffixCount) {
      return left.suffixCount - right.suffixCount;
    }
    if (left.prefixCount !== right.prefixCount) {
      return left.prefixCount - right.prefixCount;
    }
    return right.totalWidth - left.totalWidth;
  };

  let bestFit: CandidatePlan | null = null;
  let bestOverflow: CandidatePlan | null = null;

  for (let suffixCount = 1; suffixCount <= count; suffixCount += 1) {
    const maxPrefix = count - suffixCount;
    for (let prefixCount = 0; prefixCount <= maxPrefix; prefixCount += 1) {
      const candidate = buildCandidate(prefixCount, suffixCount);
      if (candidate.totalWidth <= availableWidth) {
        if (!bestFit || compareCandidates(candidate, bestFit) > 0) {
          bestFit = candidate;
        }
        continue;
      }
      if (!bestOverflow) {
        bestOverflow = candidate;
        continue;
      }
      if (
        candidate.totalWidth < bestOverflow.totalWidth
        || (
          candidate.totalWidth === bestOverflow.totalWidth
          && compareCandidates(candidate, bestOverflow) > 0
        )
      ) {
        bestOverflow = candidate;
      }
    }
  }

  const selected = bestFit ?? bestOverflow ?? buildCandidate(0, count);
  return {
    visibleIndices: selected.visibleIndices,
    collapsedRanges: selected.hiddenRange ? [selected.hiddenRange] : [],
    fitsWithinWidth: selected.totalWidth <= availableWidth,
    requiredWidth: selected.totalWidth
  } satisfies BreadcrumbDisplayPlan;
};
