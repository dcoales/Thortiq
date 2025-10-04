/**
 * Provides pure snapshot-level search helpers for wiki link triggers. The functions here never
 * touch Yjs structures directly, keeping UI layers free to memoise results while maintaining
 * consistent filtering and sorting semantics across platforms.
 */
import type { NodeId } from "../ids";
import type { NodeSnapshot, OutlineSnapshot } from "../types";

export interface WikiLinkBreadcrumbSegment {
  readonly nodeId: NodeId;
  readonly text: string;
}

export interface WikiLinkSearchCandidate {
  readonly nodeId: NodeId;
  readonly text: string;
  readonly breadcrumb: ReadonlyArray<WikiLinkBreadcrumbSegment>;
}

export interface WikiLinkSearchOptions {
  readonly excludeNodeId?: NodeId | null;
  readonly limit?: number;
}

interface CandidateAccumulator extends WikiLinkSearchCandidate {
  readonly textLength: number;
}

const DEFAULT_LIMIT = 50;

export const searchWikiLinkCandidates = (
  snapshot: OutlineSnapshot,
  query: string,
  options: WikiLinkSearchOptions = {}
): WikiLinkSearchCandidate[] => {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const excludeNodeId = options.excludeNodeId ?? null;
  const normalisedQuery = typeof query === "string" ? query.trim().toLowerCase() : "";
  const tokens = normalisedQuery.length > 0 ? normalisedQuery.split(/\s+/u).filter(Boolean) : [];

  const pathMap = computePrimaryPaths(snapshot);
  const matches: CandidateAccumulator[] = [];

  snapshot.nodes.forEach((node, nodeId) => {
    if (excludeNodeId && nodeId === excludeNodeId) {
      return;
    }
    if (!matchesQuery(tokens, node.text)) {
      return;
    }
    const breadcrumb = buildBreadcrumb(pathMap, snapshot, nodeId) ?? buildFallbackBreadcrumb(node);
    matches.push({
      nodeId,
      text: node.text,
      breadcrumb,
      textLength: node.text.trim().length
    });
  });

  matches.sort((left, right) => {
    if (left.textLength !== right.textLength) {
      return left.textLength - right.textLength;
    }
    const leftText = left.text.toLowerCase();
    const rightText = right.text.toLowerCase();
    if (leftText !== rightText) {
      return leftText < rightText ? -1 : 1;
    }
    if (left.nodeId === right.nodeId) {
      return 0;
    }
    return left.nodeId < right.nodeId ? -1 : 1;
  });

  const bounded = matches.length > limit ? matches.slice(0, limit) : matches;
  return bounded.map(({ nodeId, text, breadcrumb }) => ({ nodeId, text, breadcrumb }));
};

const matchesQuery = (tokens: readonly string[], text: string): boolean => {
  if (tokens.length === 0) {
    return true;
  }
  const haystack = text.toLowerCase();
  return tokens.every((token) => haystack.includes(token));
};

const buildBreadcrumb = (
  pathMap: ReadonlyMap<NodeId, ReadonlyArray<NodeId>>,
  snapshot: OutlineSnapshot,
  nodeId: NodeId
): ReadonlyArray<WikiLinkBreadcrumbSegment> | null => {
  const nodePath = pathMap.get(nodeId);
  if (!nodePath) {
    return null;
  }
  const breadcrumb: WikiLinkBreadcrumbSegment[] = [];
  for (const id of nodePath) {
    const node = snapshot.nodes.get(id as NodeId);
    if (!node) {
      continue;
    }
    breadcrumb.push({ nodeId: id, text: node.text });
  }
  return breadcrumb;
};

const buildFallbackBreadcrumb = (node: NodeSnapshot): ReadonlyArray<WikiLinkBreadcrumbSegment> => {
  return [
    {
      nodeId: node.id,
      text: node.text
    }
  ];
};

const computePrimaryPaths = (
  snapshot: OutlineSnapshot
): ReadonlyMap<NodeId, ReadonlyArray<NodeId>> => {
  const paths = new Map<NodeId, ReadonlyArray<NodeId>>();
  const queue: Array<{ readonly nodeId: NodeId; readonly path: ReadonlyArray<NodeId> }> = [];

  for (const rootEdgeId of snapshot.rootEdgeIds) {
    const rootEdge = snapshot.edges.get(rootEdgeId);
    if (!rootEdge) {
      continue;
    }
    const rootNode = snapshot.nodes.get(rootEdge.childNodeId);
    if (!rootNode) {
      continue;
    }
    if (!paths.has(rootNode.id)) {
      const path = Object.freeze([rootNode.id]);
      paths.set(rootNode.id, path);
      queue.push({ nodeId: rootNode.id, path });
    }
  }

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      break;
    }
    const childEdgeIds = snapshot.childrenByParent.get(current.nodeId) ?? [];
    for (const childEdgeId of childEdgeIds) {
      const childEdge = snapshot.edges.get(childEdgeId);
      if (!childEdge) {
        continue;
      }
      const childNode = snapshot.nodes.get(childEdge.childNodeId);
      if (!childNode) {
        continue;
      }
      if (paths.has(childNode.id)) {
        continue;
      }
      const path = Object.freeze([...current.path, childNode.id]) as ReadonlyArray<NodeId>;
      paths.set(childNode.id, path);
      queue.push({ nodeId: childNode.id, path });
    }
  }

  return paths;
};
