import {
  clearInboxNode,
  clearJournalNode,
  clearNodeFormatting,
  clearTodoMetadata,
  getInboxNodeId,
  getJournalNodeId,
  getNodeMetadata,
  setInboxNodeId,
  setJournalNodeId,
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
import {
  getFormattingActionDefinitions,
  type FormattingActionDefinition,
  type FormattingActionId
} from "../formatting/formattingDefinitions";
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
  readonly runFormattingAction?: (
    request: OutlineContextMenuFormattingActionRequest
  ) => void;
  readonly requestPendingCursor?: (request: {
    readonly edgeId: EdgeId;
    readonly clientX: number;
    readonly clientY: number;
  }) => void;
  readonly openColorPalette?: (request: OutlineContextMenuColorPaletteRequest) => void;
}

export interface OutlineContextMenuFormattingActionRequest {
  readonly actionId: FormattingActionId;
  readonly definition: FormattingActionDefinition;
  readonly nodeIds: readonly NodeId[];
  readonly targetHeadingLevel: NodeHeadingLevel | null;
  readonly selection: OutlineContextMenuSelectionSnapshot;
  readonly triggerEdgeId: EdgeId;
  readonly anchor: { readonly x: number; readonly y: number };
  readonly inlineMark?: "bold" | "italic" | "underline" | "strikethrough";
  readonly colorMode?: "text" | "background";
  readonly color?: string | null;
}

export interface OutlineContextMenuColorPaletteRequest {
  readonly actionId: FormattingActionId;
  readonly definition: FormattingActionDefinition;
  readonly nodeIds: readonly NodeId[];
  readonly selection: OutlineContextMenuSelectionSnapshot;
  readonly triggerEdgeId: EdgeId;
  readonly anchor: { readonly x: number; readonly y: number };
  readonly colorMode: "text" | "background";
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
  definition: FormattingActionDefinition
): OutlineContextMenuCommandDescriptor => {
  const level = definition.headingLevel as NodeHeadingLevel;
  const shortcutHint = definition.shortcutHint;
  return createCommandDescriptor(env, {
    id: `outline.context.format.${definition.id}`,
    label: definition.menuLabel,
    ariaLabel: definition.menuLabel,
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
      env.runFormattingAction?.({
        actionId: definition.id,
        definition,
        nodeIds,
        targetHeadingLevel: targetLevel,
        selection: env.selection,
        triggerEdgeId: env.triggerEdgeId,
        anchor: env.anchor
      });
      env.requestPendingCursor?.({
        edgeId: env.triggerEdgeId,
        clientX: env.anchor.x,
        clientY: env.anchor.y
      });
      return { handled: true } satisfies OutlineContextMenuCommandResult;
    }
  });
};

const buildInlineMarkCommand = (
  env: OutlineContextMenuEnvironment,
  definition: FormattingActionDefinition
): OutlineContextMenuCommandDescriptor => {
  const mark = definition.inlineMark;
  if (!mark) {
    throw new Error(`Formatting definition ${definition.id} is missing inline mark metadata.`);
  }
  return createCommandDescriptor(env, {
    id: `outline.context.format.${definition.id}`,
    label: definition.menuLabel,
    ariaLabel: definition.menuLabel,
    selectionMode: "any",
    shortcut: definition.shortcutHint,
    customRun: () => {
      const nodeIds = env.selection.nodeIds as readonly NodeId[];
      if (nodeIds.length === 0) {
        return { handled: false } satisfies OutlineContextMenuCommandResult;
      }
      env.runFormattingAction?.({
        actionId: definition.id,
        definition,
        nodeIds,
        targetHeadingLevel: null,
        selection: env.selection,
        triggerEdgeId: env.triggerEdgeId,
        anchor: env.anchor,
        inlineMark: mark
      });
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

const buildColorCommand = (
  env: OutlineContextMenuEnvironment,
  definition: FormattingActionDefinition
): OutlineContextMenuCommandDescriptor | null => {
  const mode = definition.colorMode;
  if (!mode) {
    return null;
  }
  return createCommandDescriptor(env, {
    id: `outline.context.format.${definition.id}`,
    label: definition.menuLabel,
    ariaLabel: definition.menuLabel,
    selectionMode: "any",
    customRun: () => {
      const nodeIds = env.selection.nodeIds as readonly NodeId[];
      if (nodeIds.length === 0) {
        return { handled: false } satisfies OutlineContextMenuCommandResult;
      }
      env.openColorPalette?.({
        actionId: definition.id,
        definition,
        nodeIds,
        selection: env.selection,
        triggerEdgeId: env.triggerEdgeId,
        anchor: env.anchor,
        colorMode: mode
      });
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
  const headingItems: OutlineContextMenuNode[] = [];
  const inlineMarkItems: OutlineContextMenuNode[] = [];
  const colorCommands: OutlineContextMenuNode[] = [];
  let clearCommand: OutlineContextMenuNode | null = null;

  definitions.forEach((definition) => {
    if (definition.type === "heading" && definition.headingLevel) {
      headingItems.push(buildHeadingCommand(env, definition));
      return;
    }
    if (definition.type === "clear") {
      clearCommand = buildClearFormattingCommand(env, definition.menuLabel);
      return;
    }
    if (definition.type === "inlineMark" && definition.inlineMark) {
      inlineMarkItems.push(buildInlineMarkCommand(env, definition));
      return;
    }
    if (definition.type === "color") {
      const command = buildColorCommand(env, definition);
      if (command) {
        colorCommands.push(command);
      }
    }
  });

  items.push(...headingItems);

  if (headingItems.length > 0 && (inlineMarkItems.length > 0 || colorCommands.length > 0 || clearCommand)) {
    items.push(createSeparator("format-heading-divider"));
  }

  items.push(...inlineMarkItems);

  if (inlineMarkItems.length > 0 && (colorCommands.length > 0 || clearCommand)) {
    items.push(createSeparator("format-inline-divider"));
  }

  items.push(...colorCommands);

  if (colorCommands.length > 0 && clearCommand) {
    items.push(createSeparator("format-color-divider"));
  }

  if (clearCommand) {
    items.push(clearCommand);
  }

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
  const inboxNodeId = getInboxNodeId(env.outline);
  const journalNodeId = getJournalNodeId(env.outline);
  let clearedInbox = false;
  let clearedJournal = false;
  for (const nodeId of nodeIds) {
    // A node can hold only one role; releasing singleton roles keeps Task exclusive.
    if (!clearedInbox && inboxNodeId && nodeId === inboxNodeId) {
      clearInboxNode(env.outline, env.origin);
      clearedInbox = true;
    }
    if (!clearedJournal && journalNodeId && nodeId === journalNodeId) {
      clearJournalNode(env.outline, env.origin);
      clearedJournal = true;
    }
  }
  const updates = nodeIds.map((nodeId) => ({ nodeId, done: false }));
  updateTodoDoneStates(env.outline, updates, env.origin);
  env.requestPendingCursor?.({
    edgeId: env.triggerEdgeId,
    clientX: env.anchor.x,
    clientY: env.anchor.y
  });
  return { handled: true } satisfies OutlineContextMenuCommandResult;
};

const applyBulletConversion = (
  env: OutlineContextMenuEnvironment
): OutlineContextMenuCommandResult => {
  const nodeIds = env.selection.nodeIds as readonly NodeId[];
  if (nodeIds.length === 0) {
    return { handled: false } satisfies OutlineContextMenuCommandResult;
  }
  const inboxNodeId = getInboxNodeId(env.outline);
  const journalNodeId = getJournalNodeId(env.outline);
  let clearedInbox = false;
  let clearedJournal = false;
  for (const nodeId of nodeIds) {
    if (!clearedInbox && inboxNodeId && nodeId === inboxNodeId) {
      clearInboxNode(env.outline, env.origin);
      clearedInbox = true;
    }
    if (!clearedJournal && journalNodeId && nodeId === journalNodeId) {
      clearJournalNode(env.outline, env.origin);
      clearedJournal = true;
    }
  }
  clearTodoMetadata(env.outline, nodeIds, env.origin);
  env.requestPendingCursor?.({
    edgeId: env.triggerEdgeId,
    clientX: env.anchor.x,
    clientY: env.anchor.y
  });
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
    createCommandDescriptor(env, {
      id: "outline.context.turnInto.bullet",
      label: "Bullet",
      ariaLabel: "Convert selection to bullet",
      selectionMode: "any",
      customRun: () => applyBulletConversion(env)
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
