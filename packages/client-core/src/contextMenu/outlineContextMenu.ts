/**
 * Shared context menu descriptor schema. Context menu trees are described in terms of commands,
 * submenus, and separators so platform adapters (web, desktop, mobile) can render consistent UI
 * while delegating execution to shared command handlers. Keeping the schema in client-core avoids
 * duplicating menu metadata outside the domain layer (AGENTS rules 8, 10, 13).
 */
import type { EdgeId, NodeId } from "../ids";
import type { OutlineDoc } from "../types";

export type OutlineContextMenuNode =
  | OutlineContextMenuCommandDescriptor
  | OutlineContextMenuSubmenuDescriptor
  | OutlineContextMenuSeparatorDescriptor;

export type OutlineContextMenuNodeType = OutlineContextMenuNode["type"];

export type OutlineContextMenuSelectionMode = "single" | "multiple" | "any";

export interface OutlineContextMenuSelectionSnapshot {
  readonly primaryEdgeId: EdgeId;
  readonly orderedEdgeIds: readonly EdgeId[];
  readonly canonicalEdgeIds: readonly EdgeId[];
  readonly nodeIds: readonly NodeId[];
  readonly anchorEdgeId: EdgeId | null;
  readonly focusEdgeId: EdgeId | null;
}

export interface OutlineContextMenuExecutionContext {
  readonly outline: OutlineDoc;
  readonly origin: unknown;
  readonly selection: OutlineContextMenuSelectionSnapshot;
  readonly source: OutlineContextMenuInvocationSource;
}

export interface OutlineContextMenuInvocationSource {
  readonly paneId: string;
  readonly triggerEdgeId: EdgeId;
}

export interface OutlineContextMenuCommandResult {
  readonly handled: boolean;
  readonly nextPrimaryEdgeId?: EdgeId | null;
}

export type OutlineContextMenuCommandRunner = (
  context: OutlineContextMenuExecutionContext
) => OutlineContextMenuCommandResult | Promise<OutlineContextMenuCommandResult>;

export interface OutlineContextMenuCommandDescriptor {
  readonly type: "command";
  readonly id: OutlineContextMenuCommandId;
  readonly label: string;
  readonly ariaLabel?: string;
  readonly shortcut?: string;
  readonly selectionMode: OutlineContextMenuSelectionMode;
  readonly destructive?: boolean;
  readonly allowWhenEmpty?: boolean;
  readonly iconId?: string;
  readonly isEnabled?: OutlineContextMenuEnablePredicate;
  readonly run: OutlineContextMenuCommandRunner;
}

export interface OutlineContextMenuSubmenuDescriptor {
  readonly type: "submenu";
  readonly id: OutlineContextMenuSubmenuId;
  readonly label: string;
  readonly ariaLabel?: string;
  readonly iconId?: string;
  readonly items: readonly OutlineContextMenuNode[];
  readonly isEnabled?: OutlineContextMenuEnablePredicate;
}

export interface OutlineContextMenuSeparatorDescriptor {
  readonly type: "separator";
  readonly id: OutlineContextMenuSeparatorId;
}

export type OutlineContextMenuCommandId = `outline.context.${string}`;
export type OutlineContextMenuSubmenuId = `outline.context.submenu.${string}`;
export type OutlineContextMenuSeparatorId = `outline.context.separator.${string}`;

export type OutlineContextMenuEnablePredicate = (
  context: OutlineContextMenuExecutionContext
) => boolean;

export const isOutlineContextMenuCommand = (
  node: OutlineContextMenuNode
): node is OutlineContextMenuCommandDescriptor => node.type === "command";

export const isOutlineContextMenuSubmenu = (
  node: OutlineContextMenuNode
): node is OutlineContextMenuSubmenuDescriptor => node.type === "submenu";

export const isOutlineContextMenuSeparator = (
  node: OutlineContextMenuNode
): node is OutlineContextMenuSeparatorDescriptor => node.type === "separator";

export const flattenOutlineContextMenuTree = (
  nodes: readonly OutlineContextMenuNode[]
): OutlineContextMenuNode[] => {
  const result: OutlineContextMenuNode[] = [];
  const stack: Array<readonly OutlineContextMenuNode[]> = [nodes];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    for (const node of current) {
      result.push(node);
      if (node.type === "submenu") {
        stack.push(node.items);
      }
    }
  }

  return result;
};
