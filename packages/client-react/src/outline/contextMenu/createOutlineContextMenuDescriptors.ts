import {
  clearNodeFormatting,
  getInboxNodeId,
  getJournalNodeId,
  getNodeMetadata,
  setInboxNodeId,
  setJournalNodeId,
  setNodeHeadingLevel,
  updateTodoDoneStates,
  type OutlineContextMenuCommandDescriptor,
  type OutlineContextMenuCommandResult,
  type OutlineContextMenuExecutionContext,
  type OutlineContextMenuNode,
  type OutlineContextMenuSelectionSnapshot,
  type OutlineDoc,
  type NodeHeadingLevel,
  type EdgeId
} from "@thortiq/client-core";
import type { OutlineCommandId, NodeId } from "@thortiq/client-core";
import { getFormattingActionDefinitions } from "../formatting/formattingDefinitions";
import type { OutlineContextMenuEvent, OutlineSingletonRole } from "./contextMenuEvents";

export interface OutlineContextMenuEnvironment {
  readonly outline: OutlineDoc;
  readonly origin: unknown;
  readonly selection: OutlineContextMenuSelectionSnapshot;
  readonly handleCommand: (commandId: OutlineCommandId) => boolean;
  readonly handleDeleteSelection: () => boolean;
  readonly emitEvent: (event: OutlineContextMenuEvent) => void;
  readonly anchor: { readonly x: number; readonly y: number };
  readonly paneId: string;
  readonly triggerEdgeId: EdgeId;
  readonly applySelectionSnapshot?: (snapshot: OutlineContextMenuSelectionSnapshot) => void;
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
  const execute = runCommandId ? createCommandRunner(env, runCommandId) : customRun;
  if (!execute) {
    throw new Error(`Context menu command ${options.id} is missing a run handler`);
  }

  return {
    ...rest,
    type: "command",
    run: () => {
      env.applySelectionSnapshot?.(env.selection);
      return execute();
    },
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

const applyTaskConversion = (
  env: OutlineContextMenuEnvironment
): OutlineContextMenuCommandResult => {
  const nodeIds = env.selection.nodeIds as readonly NodeId[];
  if (nodeIds.length === 0) {
    return { handled: false } satisfies OutlineContextMenuCommandResult;
  }
  const updates = nodeIds.map((nodeId) => ({ nodeId, done: false }));
  updateTodoDoneStates(env.outline, updates, env.origin);
  return { handled: true } satisfies OutlineContextMenuCommandResult;
};

const buildSingletonAssignmentCommand = (
  env: OutlineContextMenuEnvironment,
  role: OutlineSingletonRole,
  id: OutlineContextMenuCommandDescriptor["id"],
  label: string
): OutlineContextMenuCommandDescriptor => {
  return createCommandDescriptor(env, {
    id,
    label,
    ariaLabel: label,
    selectionMode: "single",
    customRun: () => {
      const nodeIds = env.selection.nodeIds as readonly NodeId[];
      const targetNodeId = nodeIds[0];
      if (!targetNodeId) {
        return { handled: false } satisfies OutlineContextMenuCommandResult;
      }

      const getCurrent =
        role === "inbox" ? getInboxNodeId : getJournalNodeId;
      const setCurrent =
        role === "inbox" ? setInboxNodeId : setJournalNodeId;

      const currentNodeId = getCurrent(env.outline);
      const applyAssignment = () => {
        setCurrent(env.outline, targetNodeId, env.origin);
      };

      if (currentNodeId && currentNodeId !== targetNodeId) {
        env.emitEvent({
          type: "requestSingletonReassignment",
          role,
          currentNodeId,
          nextNodeId: targetNodeId,
          confirm: applyAssignment
        });
        return { handled: true } satisfies OutlineContextMenuCommandResult;
      }

      applyAssignment();
      return { handled: true } satisfies OutlineContextMenuCommandResult;
    }
  });
};

const createTurnIntoSubmenu = (
  env: OutlineContextMenuEnvironment
): OutlineContextMenuNode | null => {
  const items: OutlineContextMenuNode[] = [];

  items.push(
    createCommandDescriptor(env, {
      id: "outline.context.turnInto.task",
      label: "Task",
      ariaLabel: "Convert selection to task",
      selectionMode: "any",
      customRun: () => applyTaskConversion(env)
    })
  );

  items.push(
    buildSingletonAssignmentCommand(env, "inbox", "outline.context.turnInto.inbox", "Inbox")
  );

  items.push(
    buildSingletonAssignmentCommand(env, "journal", "outline.context.turnInto.journal", "Journal")
  );

  return {
    type: "submenu",
    id: "outline.context.submenu.turnInto",
    label: "Turn Into",
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

  const turnIntoSubmenu = createTurnIntoSubmenu(env);
  if (turnIntoSubmenu) {
    nodes.push(turnIntoSubmenu);
  }

  nodes.push(
    createCommandDescriptor(env, {
      id: "outline.context.moveTo",
      label: "Move to…",
      ariaLabel: "Move selection to another location",
      selectionMode: "any",
      customRun: () => {
        env.emitEvent({
          type: "requestMoveDialog",
          mode: "move",
          anchor: env.anchor,
          paneId: env.paneId,
          triggerEdgeId: env.triggerEdgeId,
          selection: env.selection
        });
        return { handled: true } satisfies OutlineContextMenuCommandResult;
      }
    })
  );

  nodes.push(
    createCommandDescriptor(env, {
      id: "outline.context.mirrorTo",
      label: "Mirror to…",
      ariaLabel: "Create mirror of selection in another location",
      selectionMode: "any",
      customRun: () => {
        env.emitEvent({
          type: "requestMoveDialog",
          mode: "mirror",
          anchor: env.anchor,
          paneId: env.paneId,
          triggerEdgeId: env.triggerEdgeId,
          selection: env.selection
        });
        return { handled: true } satisfies OutlineContextMenuCommandResult;
      }
    })
  );

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
