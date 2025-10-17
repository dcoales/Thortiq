import type { EdgeId, NodeId } from "../ids";
import type { OutlineSnapshot } from "../types";
import {
  searchWikiLinkCandidates,
  type WikiLinkBreadcrumbSegment,
  type WikiLinkSearchOptions
} from "./search";

export interface MirrorSearchOptions {
  readonly excludeNodeId?: NodeId | null;
  readonly limit?: number;
  readonly targetEdgeId?: EdgeId | null;
}

export interface MirrorSearchCandidate {
  readonly nodeId: NodeId;
  readonly text: string;
  readonly breadcrumb: ReadonlyArray<WikiLinkBreadcrumbSegment>;
}

export const searchMirrorCandidates = (
  snapshot: OutlineSnapshot,
  query: string,
  options: MirrorSearchOptions = {}
): MirrorSearchCandidate[] => {
  const { excludeNodeId = null, limit, targetEdgeId = null } = options;
  const wikiOptions: WikiLinkSearchOptions = {
    excludeNodeId: excludeNodeId ?? undefined,
    limit
  };
  const candidates = searchWikiLinkCandidates(snapshot, query, wikiOptions);
  const ancestorSet = targetEdgeId ? collectAncestorNodeIds(snapshot, targetEdgeId) : null;
  const originalNodeIds = collectOriginalNodeIds(snapshot);
  const breadcrumbCache = new Map<NodeId, ReadonlyArray<WikiLinkBreadcrumbSegment> | null>();

  const results: MirrorSearchCandidate[] = [];
  for (const candidate of candidates) {
    if (!originalNodeIds.has(candidate.nodeId)) {
      continue;
    }
    if (ancestorSet && ancestorSet.has(candidate.nodeId)) {
      continue;
    }
    const breadcrumb = resolveCanonicalBreadcrumb(snapshot, candidate.nodeId, breadcrumbCache);
    if (!breadcrumb) {
      continue;
    }
    results.push({
      nodeId: candidate.nodeId,
      text: candidate.text,
      breadcrumb
    });
    if (typeof limit === "number" && results.length >= limit) {
      break;
    }
  }

  return results;
};

const collectOriginalNodeIds = (snapshot: OutlineSnapshot): ReadonlySet<NodeId> => {
  const originals = new Set<NodeId>();
  snapshot.edges.forEach((edge) => {
    if (!edge) {
      return;
    }
    if (edge.mirrorOfNodeId !== null) {
      return;
    }
    originals.add(edge.childNodeId);
  });
  return originals;
};

const collectAncestorNodeIds = (
  snapshot: OutlineSnapshot,
  targetEdgeId: EdgeId
): ReadonlySet<NodeId> | null => {
  const targetEdge = snapshot.edges.get(targetEdgeId);
  if (!targetEdge) {
    return null;
  }

  const visitedEdges = new Set<EdgeId>();
  interface QueueEntry {
    readonly edgeId: EdgeId;
    readonly nodeId: NodeId;
    readonly ancestors: ReadonlyArray<NodeId>;
  }
  const queue: QueueEntry[] = [];
  for (const rootEdgeId of snapshot.rootEdgeIds) {
    const rootEdge = snapshot.edges.get(rootEdgeId);
    if (!rootEdge) {
      continue;
    }
    queue.push({
      edgeId: rootEdgeId,
      nodeId: rootEdge.childNodeId,
      ancestors: []
    });
  }

  while (queue.length > 0) {
    const entry = queue.shift();
    if (!entry) {
      continue;
    }
    if (visitedEdges.has(entry.edgeId)) {
      continue;
    }
    visitedEdges.add(entry.edgeId);

    if (entry.edgeId === targetEdgeId) {
      return new Set(entry.ancestors);
    }

    const childEdgeIds = snapshot.childrenByParent.get(entry.nodeId) ?? [];
    const nextAncestors = [...entry.ancestors, entry.nodeId] as ReadonlyArray<NodeId>;
    for (const childEdgeId of childEdgeIds) {
      const childEdge = snapshot.edges.get(childEdgeId);
      if (!childEdge) {
        continue;
      }
      queue.push({
        edgeId: childEdgeId,
        nodeId: childEdge.childNodeId,
        ancestors: nextAncestors
      });
    }
  }

  return null;
};

const resolveCanonicalBreadcrumb = (
  snapshot: OutlineSnapshot,
  nodeId: NodeId,
  cache: Map<NodeId, ReadonlyArray<WikiLinkBreadcrumbSegment> | null>
): ReadonlyArray<WikiLinkBreadcrumbSegment> | null => {
  if (cache.has(nodeId)) {
    return cache.get(nodeId) ?? null;
  }

  const path = findCanonicalNodePath(snapshot, nodeId);
  if (!path) {
    cache.set(nodeId, null);
    return null;
  }

  const segments: WikiLinkBreadcrumbSegment[] = [];
  for (const id of path) {
    const node = snapshot.nodes.get(id);
    segments.push({
      nodeId: id,
      text: node?.text ?? ""
    });
  }
  const readonlySegments = Object.freeze(segments.slice()) as ReadonlyArray<WikiLinkBreadcrumbSegment>;
  cache.set(nodeId, readonlySegments);
  return readonlySegments;
};

const findCanonicalNodePath = (
  snapshot: OutlineSnapshot,
  targetNodeId: NodeId
): ReadonlyArray<NodeId> | null => {
  if (!snapshot.nodes.has(targetNodeId)) {
    return null;
  }

  interface PathEntry {
    readonly nodeId: NodeId;
    readonly path: ReadonlyArray<NodeId>;
  }

  const visited = new Set<NodeId>();
  const primaryQueue: PathEntry[] = [];
  const mirrorQueue: PathEntry[] = [];

  for (const rootEdgeId of snapshot.rootEdgeIds) {
    const rootEdge = snapshot.edges.get(rootEdgeId);
    if (!rootEdge) {
      continue;
    }
    const childNodeId = rootEdge.childNodeId;
    const initialPath = [childNodeId] as ReadonlyArray<NodeId>;
    const entry: PathEntry = {
      nodeId: childNodeId,
      path: initialPath
    };
    if (rootEdge.mirrorOfNodeId === null) {
      primaryQueue.push(entry);
    } else {
      mirrorQueue.push(entry);
    }
  }

  while (primaryQueue.length > 0 || mirrorQueue.length > 0) {
    const queue = primaryQueue.length > 0 ? primaryQueue : mirrorQueue;
    const entry = queue.shift();
    if (!entry) {
      continue;
    }
    if (visited.has(entry.nodeId)) {
      continue;
    }
    visited.add(entry.nodeId);

    if (entry.nodeId === targetNodeId) {
      return entry.path;
    }

    const childEdgeIds = snapshot.childrenByParent.get(entry.nodeId) ?? [];
    for (const childEdgeId of childEdgeIds) {
      const childEdge = snapshot.edges.get(childEdgeId);
      if (!childEdge) {
        continue;
      }
      const nextPath = [...entry.path, childEdge.childNodeId] as ReadonlyArray<NodeId>;
      const nextEntry: PathEntry = {
        nodeId: childEdge.childNodeId,
        path: nextPath
      };
      if (childEdge.mirrorOfNodeId === null) {
        primaryQueue.push(nextEntry);
      } else {
        mirrorQueue.push(nextEntry);
      }
    }
  }

  return null;
};
