import type { ReactNode } from "react";
import { InlineTriggerDialog } from "./InlineTriggerDialog";

export interface SlashCommandCandidate {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
}

interface SlashCommandDialogProps {
  readonly anchor: { readonly left: number; readonly bottom: number };
  readonly query: string;
  readonly results: ReadonlyArray<SlashCommandCandidate>;
  readonly selectedIndex: number;
  readonly onSelect: (candidate: SlashCommandCandidate) => void;
  readonly onHoverIndexChange?: (index: number) => void;
  readonly onRequestClose?: () => void;
  readonly header?: ReactNode;
}

export const SlashCommandDialog = ({
  anchor,
  query,
  results,
  selectedIndex,
  onSelect,
  onHoverIndexChange,
  onRequestClose,
  header
}: SlashCommandDialogProps): JSX.Element => {
  return (
    <InlineTriggerDialog<SlashCommandCandidate>
      anchor={anchor}
      query={query}
      results={results}
      selectedIndex={selectedIndex}
      getPrimaryText={(c) => c.label}
      getSecondaryText={(c) => c.hint ?? ""}
      onSelect={onSelect}
      onHoverIndexChange={onHoverIndexChange}
      onRequestClose={onRequestClose}
      ariaLabel="Slash commands"
      getItemKey={(c) => c.id}
      header={header}
    />
  );
};


