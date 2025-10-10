import {
  type OutlineContextMenuCommandDescriptor,
  type OutlineContextMenuCommandResult,
  type OutlineContextMenuExecutionContext,
  type OutlineContextMenuNode,
  type OutlineContextMenuSelectionSnapshot
} from "@thortiq/client-core";
import type { OutlineCommandId } from "@thortiq/client-core";

export interface OutlineContextMenuEnvironment {
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
    }),
    createCommandDescriptor(env, {
      id: "outline.context.insertChild",
      label: "New child node",
      ariaLabel: "Insert child node",
      selectionMode: "single",
      shortcut: "Shift+Enter",
      runCommandId: "outline.insertChild"
    }),
    createSeparator("insert"),
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
    }),
    createSeparator("structure"),
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
