import type { TagSuggestion } from "../hooks/useTagSuggestionDialog";

import { InlineTriggerDialog } from "./InlineTriggerDialog";

interface TagSuggestionDialogProps {
  readonly anchor: {
    readonly left: number;
    readonly bottom: number;
  };
  readonly query: string;
  readonly results: ReadonlyArray<TagSuggestion>;
  readonly selectedIndex: number;
  readonly onSelect: (suggestion: TagSuggestion) => void;
  readonly onHoverIndexChange?: (index: number) => void;
  readonly onRequestClose?: () => void;
}

const triggerLabel = (trigger: TagSuggestion["trigger"]): string => {
  switch (trigger) {
    case "#":
      return "Tag";
    case "@":
      return "Mention";
    default:
      return "Tag";
  }
};

export const TagSuggestionDialog = ({
  anchor,
  query,
  results,
  selectedIndex,
  onSelect,
  onHoverIndexChange,
  onRequestClose
}: TagSuggestionDialogProps): JSX.Element => {
  return (
    <InlineTriggerDialog<TagSuggestion>
      anchor={anchor}
      query={query}
      results={results}
      selectedIndex={selectedIndex}
      getPrimaryText={(suggestion) => `${suggestion.trigger}${suggestion.label}`}
      getSecondaryText={(suggestion) => triggerLabel(suggestion.trigger)}
      onSelect={onSelect}
      onHoverIndexChange={onHoverIndexChange}
      onRequestClose={onRequestClose}
      ariaLabel="Tag suggestions"
      emptyState={({ query: emptyQuery }) => (
        <div style={{ padding: "12px 16px", color: "#6b7280", fontSize: "0.85rem" }}>
          No matching tags{emptyQuery ? ` for "${emptyQuery}"` : ""}
        </div>
      )}
      getItemKey={(suggestion, index) => `${suggestion.trigger}-${suggestion.id}-${index}`}
    />
  );
};
