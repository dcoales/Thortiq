import type { NodeId } from "@thortiq/client-core";

import { InlineTriggerDialog, formatBreadcrumb } from "./InlineTriggerDialog";

export interface MirrorDialogBreadcrumbSegment {
  readonly nodeId: NodeId;
  readonly text: string;
}

export interface MirrorDialogCandidate {
  readonly nodeId: NodeId;
  readonly text: string;
  readonly breadcrumb: ReadonlyArray<MirrorDialogBreadcrumbSegment>;
}

interface MirrorDialogProps {
  readonly anchor: {
    readonly left: number;
    readonly bottom: number;
  };
  readonly query: string;
  readonly results: ReadonlyArray<MirrorDialogCandidate>;
  readonly selectedIndex: number;
  readonly onSelect: (candidate: MirrorDialogCandidate) => void;
  readonly onHoverIndexChange?: (index: number) => void;
  readonly onRequestClose?: () => void;
}

export const MirrorDialog = ({
  anchor,
  query,
  results,
  selectedIndex,
  onSelect,
  onHoverIndexChange,
  onRequestClose
}: MirrorDialogProps): JSX.Element => {
  return (
    <InlineTriggerDialog<MirrorDialogCandidate>
      anchor={anchor}
      query={query}
      results={results}
      selectedIndex={selectedIndex}
      getPrimaryText={(candidate) => (candidate.text.length > 0 ? candidate.text : "Untitled node")}
      getSecondaryText={(candidate) => formatBreadcrumb(candidate.breadcrumb)}
      onSelect={onSelect}
      onHoverIndexChange={onHoverIndexChange}
      onRequestClose={onRequestClose}
      ariaLabel="Mirror target suggestions"
      emptyState={({ query: emptyQuery }) => (
        <div style={{ padding: "12px 16px", color: "#6b7280", fontSize: "0.85rem" }}>
          No mirror targets found{emptyQuery ? ` for "${emptyQuery}"` : ""}
        </div>
      )}
      getItemKey={(candidate, index) => `${candidate.nodeId}-${index}`}
    />
  );
};
