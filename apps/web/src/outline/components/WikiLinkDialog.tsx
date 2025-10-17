import type { WikiLinkSearchCandidate } from "@thortiq/client-core";

import { InlineTriggerDialog, formatBreadcrumb } from "./InlineTriggerDialog";

interface WikiLinkDialogProps {
  readonly anchor: {
    readonly left: number;
    readonly bottom: number;
  };
  readonly query: string;
  readonly results: ReadonlyArray<WikiLinkSearchCandidate>;
  readonly selectedIndex: number;
  readonly onSelect: (candidate: WikiLinkSearchCandidate) => void;
  readonly onHoverIndexChange?: (index: number) => void;
  readonly onRequestClose?: () => void;
}

export const WikiLinkDialog = ({
  anchor,
  query,
  results,
  selectedIndex,
  onSelect,
  onHoverIndexChange,
  onRequestClose
}: WikiLinkDialogProps): JSX.Element => {
  return (
    <InlineTriggerDialog<WikiLinkSearchCandidate>
      anchor={anchor}
      query={query}
      results={results}
      selectedIndex={selectedIndex}
      getPrimaryText={(candidate) => (candidate.text.length > 0 ? candidate.text : "Untitled node")}
      getSecondaryText={(candidate) => formatBreadcrumb(candidate.breadcrumb)}
      onSelect={onSelect}
      onHoverIndexChange={onHoverIndexChange}
      onRequestClose={onRequestClose}
      ariaLabel="Wiki link suggestions"
      emptyState={({ query: emptyQuery }) => (
        <div style={{ padding: "12px 16px", color: "#6b7280", fontSize: "0.85rem" }}>
          No matching nodes{emptyQuery ? ` for "${emptyQuery}"` : ""}
        </div>
      )}
      getItemKey={(candidate, index) => `${candidate.nodeId}-${index}`}
    />
  );
};
