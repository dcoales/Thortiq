import type { NodeId } from "../ids";
import type { OutlineSnapshot } from "../types";
import {
  searchWikiLinkCandidates,
  type WikiLinkBreadcrumbSegment,
  type WikiLinkSearchOptions
} from "./search";

export interface MirrorSearchOptions {
  readonly excludeNodeId?: NodeId | null;
  readonly limit?: number;
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
  const { excludeNodeId = null, limit } = options;
  const wikiOptions: WikiLinkSearchOptions = {
    excludeNodeId: excludeNodeId ?? undefined,
    limit
  };
  const candidates = searchWikiLinkCandidates(snapshot, query, wikiOptions);
  return candidates.map((candidate) => ({
    nodeId: candidate.nodeId,
    text: candidate.text,
    breadcrumb: candidate.breadcrumb
  }));
};
