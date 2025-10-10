import {
  clearNodeFormatting,
  getNodeMetadata,
  setNodeHeadingLevel,
  type OutlineContextMenuCommandDescriptor,
  type OutlineContextMenuCommandResult,
  type OutlineContextMenuExecutionContext,
  type OutlineContextMenuNode,
  type OutlineContextMenuSelectionSnapshot,
  type OutlineDoc,
  type NodeHeadingLevel
} from "@thortiq/client-core";
import type { OutlineCommandId, NodeId } from "@thortiq/client-core";
import { getFormattingActionDefinitions } from "../formatting/formattingDefinitions";

export interface OutlineContextMenuEnvironment {
  readonly outline: OutlineDoc;
  readonly origin: unknown;
  readonly selection: OutlineContextMenuSelectionSnapshot;
  readonly handleCommand: (commandId: OutlineCommandId) => boolean;
  readonly handleDeleteSelection: () => boolean;
}

const selectionMatchesMode = (
  mode: OutlineContextMenuCommandDescriptor["selectionMode"],
  count: number
): boolean => {
  if (mode === "any") {
    return count > 0;
  }
  if (mode === "single") {
    return count === 1;
  }
  return count > 1;
};

const createCommandRunner = (
  env: OutlineContextMenuEnvironment,
  commandId: OutlineCommandId
) => {
  return (): OutlineContextMenuCommandResult => ({
    handled: env.handleCommand(commandId)
  });
};

const createCommandDescriptor = (
  env: OutlineContextMenuEnvironment,
  options: Omit<OutlineContextMenuCommandDescriptor, "type" | "run" | "isEnabled"> & {
    readonly runCommandId?: OutlineCommandId;
    readonly customRun?: () => OutlineContextMenuCommandResult;
    readonly customIsEnabled?: (context: OutlineContextMenuExecutionContext) => boolean;
  }
): OutlineContextMenuCommandDescriptor => {
  const { runCommandId, customRun, customIsEnabled, ...rest } = options;
  const selectionCount = env.selection.orderedEdgeIds.length;
  const selectionSatisfied = selectionMatchesMode(options.selectionMode, selectionCount);
  const run = runCommandId ? createCommandRunner(env, runCommandId) : customRun;
  if (!run) {
    throw new Error(`Context menu command ${options.id} is missing a run handler`);
  }

  return {
    ...rest,
    type: "command",
    run: () => run(),
    isEnabled: (context) => {
      if (!selectionSatisfied) {
        return false;
      }
      if (customIsEnabled) {
        return customIsEnabled(context);
      }
      return true;
    }
  };
};

const createSeparator = (id: string): OutlineContextMenuNode => ({
  type: "separator",
  id: `outline.context.separator.${id}`
});

const buildHeadingCommand = (
  env: OutlineContextMenuEnvironment,
  level: NodeHeadingLevel,
  label: string,
  definitionId: string,
  shortcutHint?: string
): OutlineContextMenuCommandDescriptor => {
  return createCommandDescriptor(env, {
    id: `outline.context.format.${definitionId}`,
    label,
    ariaLabel: label,
    selectionMode: "any",
    shortcut: shortcutHint,
    customRun: () => {
      const nodeIds = env.selection.nodeIds as readonly NodeId[];
      if (nodeIds.length === 0) {
        return { handled: false } satisfies OutlineContextMenuCommandResult;
      }
      const metadata = nodeIds.map((nodeId) => getNodeMetadata(env.outline, nodeId));
      const desiredLevel = level as NodeHeadingLevel;
      const allMatch = metadata.every((entry) => (entry.headingLevel ?? null) === desiredLevel);
      const targetLevel: NodeHeadingLevel | null = allMatch ? null : desiredLevel;
      setNodeHeadingLevel(env.outline, nodeIds, targetLevel, env.origin);
      return { handled: true } satisfies OutlineContextMenuCommandResult;
    }
  });
};

const buildClearFormattingCommand = (
  env: OutlineContextMenuEnvironment,
  label: string
): OutlineContextMenuCommandDescriptor => {
  return createCommandDescriptor(env, {
    id: "outline.context.format.clear",
    label,
    ariaLabel: label,
    selectionMode: "any",
    customRun: () => {
      const nodeIds = env.selection.nodeIds as readonly NodeId[];
      if (nodeIds.length === 0) {
        return { handled: false } satisfies OutlineContextMenuCommandResult;
      }
      clearNodeFormatting(env.outline, nodeIds, env.origin);
      return { handled: true } satisfies OutlineContextMenuCommandResult;
    }
  });
};

const createFormatSubmenu = (
  env: OutlineContextMenuEnvironment
): OutlineContextMenuNode | null => {
  const definitions = getFormattingActionDefinitions().filter((definition) =>
    definition.contexts.includes("outline")
  );
  if (definitions.length === 0) {
    return null;
  }

  const items: OutlineContextMenuNode[] = [];
  let injectedSeparator = false;

  definitions.forEach((definition) => {
    if (definition.type === "heading" && definition.headingLevel) {
      items.push(
        buildHeadingCommand(
          env,
          definition.headingLevel,
          definition.menuLabel,
          definition.id,
          definition.shortcutHint
        )
      );
      return;
    }
    if (definition.type === "clear") {
      if (items.length > 0 && !injectedSeparator) {
        items.push(createSeparator("format-divider"));
        injectedSeparator = true;
      }
      items.push(buildClearFormattingCommand(env, definition.menuLabel));
    }
  });

  if (items.length === 0) {
    return null;
  }

  return {
    type: "submenu",
    id: "outline.context.submenu.format",
    label: "Format",
    items
  } satisfies OutlineContextMenuNode;
};

export const createOutlineContextMenuDescriptors = (
  env: OutlineContextMenuEnvironment
): readonly OutlineContextMenuNode[] => {
  const nodes: OutlineContextMenuNode[] = [];

  nodes.push(
    createCommandDescriptor(env, {
      id: "outline.context.insertSiblingBelow",
      label: "New sibling below",
      ariaLabel: "Insert sibling below",
      selectionMode: "single",
      shortcut: "Enter",
      runCommandId: "outline.insertSiblingBelow"
    })
  );

  nodes.push(
    createCommandDescriptor(env, {
      id: "outline.context.insertChild",
      label: "New child node",
      ariaLabel: "Insert child node",
      selectionMode: "single",
      shortcut: "Shift+Enter",
      runCommandId: "outline.insertChild"
    })
  );

  const formatSubmenu = createFormatSubmenu(env);
  if (formatSubmenu) {
    nodes.push(formatSubmenu);
  }

  nodes.push(createSeparator("context-primary"));

  nodes.push(
    createCommandDescriptor(env, {
      id: "outline.context.toggleTodo",
      label: "Toggle todo",
      ariaLabel: "Toggle todo state",
      selectionMode: "any",
      shortcut: "Ctrl+Enter",
      runCommandId: "outline.toggleTodoDone"
    }),
    createCommandDescriptor(env, {
      id: "outline.context.indent",
      label: "Indent",
      ariaLabel: "Indent selection",
      selectionMode: "any",
      shortcut: "Tab",
      runCommandId: "outline.indentSelection"
    }),
    createCommandDescriptor(env, {
      id: "outline.context.outdent",
      label: "Outdent",
      ariaLabel: "Outdent selection",
      selectionMode: "any",
      shortcut: "Shift+Tab",
      runCommandId: "outline.outdentSelection"
    })
  );

  nodes.push(createSeparator("context-destructive"));

  nodes.push(
    createCommandDescriptor(env, {
      id: "outline.context.delete",
      label: "Delete…",
      ariaLabel: "Delete selection",
      selectionMode: "any",
      destructive: true,
      customRun: () => ({ handled: env.handleDeleteSelection() })
    })
  );

  return nodes;
};
