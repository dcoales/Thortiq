/**
 * Wiki link helpers expose shared search utilities so platform adapters can surface consistent
 * dialog results without duplicating filtering logic.
 */
export {
  searchWikiLinkCandidates,
  type WikiLinkSearchCandidate,
  type WikiLinkSearchOptions,
  type WikiLinkBreadcrumbSegment
} from "./search";
