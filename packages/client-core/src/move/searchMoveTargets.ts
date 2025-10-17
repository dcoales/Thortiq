import type { OutlineSnapshot } from "../types";
import type { NodeId } from "../ids";
import {
  searchWikiLinkCandidates,
  type WikiLinkBreadcrumbSegment,
  type WikiLinkSearchCandidate,
  type WikiLinkSearchOptions
} from "../wiki/search";

export interface MoveTargetCandidate {
  readonly parentNodeId: NodeId | null;
  readonly text: string;
  readonly breadcrumb: ReadonlyArray<WikiLinkBreadcrumbSegment>;
  readonly isRoot: boolean;
}

export interface MoveTargetSearchOptions {
  readonly forbiddenNodeIds?: ReadonlySet<NodeId> | readonly NodeId[];
  readonly limit?: number;
}

const ROOT_LABEL = "Root";

const normaliseQuery = (query: string): string => query.trim().toLowerCase();

const extractTokens = (query: string): readonly string[] => {
  const normalised = normaliseQuery(query);
  if (normalised.length === 0) {
    return [];
  }
  return normalised.split(/\s+/u).filter(Boolean);
};

const matchesTokens = (text: string, tokens: readonly string[]): boolean => {
  if (tokens.length === 0) {
    return true;
  }
  const lower = text.toLowerCase();
  return tokens.every((token) => lower.includes(token));
};

const toReadonlySet = (values: MoveTargetSearchOptions["forbiddenNodeIds"]): ReadonlySet<NodeId> => {
  if (!values) {
    return new Set<NodeId>();
  }
  if (values instanceof Set) {
    return values;
  }
  return new Set<NodeId>(values);
};

const mapCandidate = (candidate: WikiLinkSearchCandidate): MoveTargetCandidate => ({
  parentNodeId: candidate.nodeId,
  text: candidate.text,
  breadcrumb: candidate.breadcrumb,
  isRoot: false
});

const createRootCandidate = (): MoveTargetCandidate => ({
  parentNodeId: null,
  text: ROOT_LABEL,
  breadcrumb: Object.freeze([]) as ReadonlyArray<WikiLinkBreadcrumbSegment>,
  isRoot: true
});

export const searchMoveTargets = (
  snapshot: OutlineSnapshot,
  query: string,
  options: MoveTargetSearchOptions = {}
): MoveTargetCandidate[] => {
  const tokens = extractTokens(query);
  const forbidden = toReadonlySet(options.forbiddenNodeIds);
  const limit = options.limit ?? 50;

  const wikiOptions: WikiLinkSearchOptions = {
    limit: Math.max(limit * 2, limit + 10)
  };
  const wikiCandidates = searchWikiLinkCandidates(snapshot, query, wikiOptions);

  const results: MoveTargetCandidate[] = [];

  if (matchesTokens(ROOT_LABEL, tokens)) {
    results.push(createRootCandidate());
  }

  for (const candidate of wikiCandidates) {
    if (forbidden.has(candidate.nodeId)) {
      continue;
    }
    results.push(mapCandidate(candidate));
    if (results.length >= limit) {
      break;
    }
  }

  if (results.length > limit) {
    return results.slice(0, limit);
  }
  return results;
};
