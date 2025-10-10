import { describe, expect, it, vi } from "vitest";

import { createOutlineContextMenuDescriptors } from "../createOutlineContextMenuDescriptors";
import type {
  OutlineContextMenuMoveRequestEvent,
  OutlineContextMenuSingletonReassignmentEvent
} from "../contextMenuEvents";
import type { OutlineContextMenuExecutionContext, OutlineContextMenuSelectionSnapshot } from "@thortiq/client-core";
import {
  createOutlineDoc,
  addEdge,
  getInboxNodeId,
  getJournalNodeId,
  getNodeMetadata,
  setInboxNodeId,
  setNodeHeadingLevel
} from "@thortiq/client-core";

const createSelection = (edgeIds: readonly string[]): OutlineContextMenuSelectionSnapshot => ({
  primaryEdgeId: edgeIds[0] ?? "edge-primary",
  orderedEdgeIds: edgeIds.length > 0 ? [...edgeIds] : ["edge-primary"],
  canonicalEdgeIds: edgeIds.length > 0 ? [...edgeIds] : ["edge-primary"],
  nodeIds: edgeIds.length > 0 ? edgeIds.map((edgeId) => `node-${edgeId}`) : ["node-primary"],
  anchorEdgeId: edgeIds[0] ?? "edge-primary",
  focusEdgeId: edgeIds.slice(-1)[0] ?? "edge-primary"
});

const createExecutionContext = (
  outline: ReturnType<typeof createOutlineDoc>,
  origin: symbol,
  selection: OutlineContextMenuSelectionSnapshot,
  triggerEdgeId: string
): OutlineContextMenuExecutionContext => ({
  outline,
  origin,
  selection,
  source: {
    paneId: "pane",
    triggerEdgeId
  }
});

describe("createOutlineContextMenuDescriptors", () => {
  it("builds the base command list for single selection", () => {
    const handleCommand = vi.fn().mockReturnValue(true);
    const handleDelete = vi.fn().mockReturnValue(true);
    const selection = createSelection(["edge-1"]);
    const outline = createOutlineDoc();
    const origin = Symbol("test");
    const nodes = createOutlineContextMenuDescriptors({
      outline,
      origin,
      selection,
      handleCommand,
      handleDeleteSelection: handleDelete,
      emitEvent: () => undefined,
      anchor: { x: 10, y: 20 },
      paneId: "pane",
      triggerEdgeId: selection.primaryEdgeId
    });
    const executionContext = createExecutionContext(outline, origin, selection, "edge-1");

    const sibling = nodes.find(
      (node): node is Extract<typeof node, { type: "command" }> => node.type === "command" && node.id === "outline.context.insertSiblingBelow"
    );
    expect(sibling).toBeDefined();
    expect(sibling?.isEnabled?.(executionContext)).toBe(true);
    sibling?.run(executionContext);
    expect(handleCommand).toHaveBeenCalledWith("outline.insertSiblingBelow");

    const deleteNode = nodes.find(
      (node): node is Extract<typeof node, { type: "command" }> => node.type === "command" && node.id === "outline.context.delete"
    );
    expect(deleteNode?.isEnabled?.(executionContext)).toBe(true);
    deleteNode?.run(executionContext);
    expect(handleDelete).toHaveBeenCalled();
  });

  it("disables single-selection commands when multiple nodes are selected", () => {
    const handleCommand = vi.fn().mockReturnValue(true);
    const selection = createSelection(["edge-a", "edge-b"]);
    const outline = createOutlineDoc();
    const origin = Symbol("test");
    const nodes = createOutlineContextMenuDescriptors({
      outline,
      origin,
      selection,
      handleCommand,
      handleDeleteSelection: () => true,
      emitEvent: () => undefined,
      anchor: { x: 10, y: 20 },
      paneId: "pane",
      triggerEdgeId: selection.primaryEdgeId
    });
    const executionContext = createExecutionContext(outline, origin, selection, "edge-a");

    const newChild = nodes.find(
      (node): node is Extract<typeof node, { type: "command" }> => node.type === "command" && node.id === "outline.context.insertChild"
    );
    expect(newChild?.isEnabled?.(executionContext)).toBe(false);
  });

  it("emits a move dialog event when invoking Move to", () => {
    const outline = createOutlineDoc();
    const origin = Symbol("test");
    const selection = createSelection(["edge-move"]);
    const emitEvent = vi.fn();
    const nodes = createOutlineContextMenuDescriptors({
      outline,
      origin,
      selection,
      handleCommand: () => true,
      handleDeleteSelection: () => true,
      emitEvent,
      anchor: { x: 42, y: 64 },
      paneId: "pane",
      triggerEdgeId: selection.primaryEdgeId
    });
    const executionContext = createExecutionContext(outline, origin, selection, "edge-move");

    const moveCommand = nodes.find(
      (node): node is Extract<typeof node, { type: "command" }> => node.type === "command" && node.id === "outline.context.moveTo"
    );
    expect(moveCommand).toBeDefined();
    moveCommand?.run(executionContext);
    expect(emitEvent).toHaveBeenCalledTimes(1);
    const event = emitEvent.mock.calls[0][0] as OutlineContextMenuMoveRequestEvent;
    expect(event.type).toBe("requestMoveDialog");
    expect(event.mode).toBe("move");
    expect(event.anchor).toEqual({ x: 42, y: 64 });
    expect(event.selection).toBe(selection);
    expect(event.triggerEdgeId).toBe("edge-move");
    expect(event.paneId).toBe("pane");
  });

  it("emits a mirror dialog event when invoking Mirror to", () => {
    const outline = createOutlineDoc();
    const origin = Symbol("test");
    const selection = createSelection(["edge-mirror"]);
    const emitEvent = vi.fn();
    const nodes = createOutlineContextMenuDescriptors({
      outline,
      origin,
      selection,
      handleCommand: () => true,
      handleDeleteSelection: () => true,
      emitEvent,
      anchor: { x: 32, y: 80 },
      paneId: "pane",
      triggerEdgeId: selection.primaryEdgeId
    });
    const executionContext = createExecutionContext(outline, origin, selection, "edge-mirror");

    const mirrorCommand = nodes.find(
      (node): node is Extract<typeof node, { type: "command" }> => node.type === "command" && node.id === "outline.context.mirrorTo"
    );
    expect(mirrorCommand).toBeDefined();
    mirrorCommand?.run(executionContext);
    expect(emitEvent).toHaveBeenCalledTimes(1);
    const event = emitEvent.mock.calls[0][0] as OutlineContextMenuMoveRequestEvent;
    expect(event.type).toBe("requestMoveDialog");
    expect(event.mode).toBe("mirror");
    expect(event.anchor).toEqual({ x: 32, y: 80 });
    expect(event.selection).toBe(selection);
    expect(event.triggerEdgeId).toBe("edge-mirror");
    expect(event.paneId).toBe("pane");
  });

  it("toggles heading level and clears formatting via the format submenu", () => {
    const outline = createOutlineDoc();
    const origin = Symbol("test");
    const { edgeId, nodeId } = addEdge(outline, {
      parentNodeId: null,
      position: 0,
      origin,
      text: "Heading sample"
    });

    const selection: OutlineContextMenuSelectionSnapshot = {
      primaryEdgeId: edgeId,
      orderedEdgeIds: [edgeId],
      canonicalEdgeIds: [edgeId],
      nodeIds: [nodeId],
      anchorEdgeId: edgeId,
      focusEdgeId: edgeId
    };

    const nodes = createOutlineContextMenuDescriptors({
      outline,
      origin,
      selection,
      handleCommand: () => true,
      handleDeleteSelection: () => true,
      emitEvent: () => undefined,
      anchor: { x: 10, y: 20 },
      paneId: "pane",
      triggerEdgeId: selection.primaryEdgeId
    });

    const executionContext = createExecutionContext(outline, origin, selection, edgeId);
    const formatSubmenu = nodes.find((node) => node.type === "submenu" && node.id === "outline.context.submenu.format");
    expect(formatSubmenu).toBeDefined();
    const formatItems = formatSubmenu && formatSubmenu.type === "submenu" ? formatSubmenu.items : [];
    const headingCommand = formatItems.find(
      (item) => item.type === "command" && item.id === "outline.context.format.heading-1"
    );
    expect(headingCommand).toBeDefined();
    if (headingCommand && headingCommand.type === "command") {
      headingCommand.run(executionContext);
    }
    expect(getNodeMetadata(outline, nodeId).headingLevel).toBe(1);

    if (headingCommand && headingCommand.type === "command") {
      headingCommand.run(executionContext);
    }
    expect(getNodeMetadata(outline, nodeId).headingLevel).toBeUndefined();

    setNodeHeadingLevel(outline, [nodeId], 2, origin);
    const clearCommand = formatItems.find(
      (item) => item.type === "command" && item.id === "outline.context.format.clear"
    );
    expect(clearCommand).toBeDefined();
    if (clearCommand && clearCommand.type === "command") {
      clearCommand.run(executionContext);
    }
    expect(getNodeMetadata(outline, nodeId).headingLevel).toBeUndefined();
  });

  it("converts selected nodes into tasks via the Turn Into submenu", () => {
    const outline = createOutlineDoc();
    const origin = Symbol("test");
    const { edgeId, nodeId } = addEdge(outline, {
      parentNodeId: null,
      position: 0,
      origin,
      text: "Task candidate"
    });

    const selection: OutlineContextMenuSelectionSnapshot = {
      primaryEdgeId: edgeId,
      orderedEdgeIds: [edgeId],
      canonicalEdgeIds: [edgeId],
      nodeIds: [nodeId],
      anchorEdgeId: edgeId,
      focusEdgeId: edgeId
    };

    const emitEvent = vi.fn();
    const nodes = createOutlineContextMenuDescriptors({
      outline,
      origin,
      selection,
      handleCommand: () => true,
      handleDeleteSelection: () => true,
      emitEvent,
      anchor: { x: 10, y: 20 },
      paneId: "pane",
      triggerEdgeId: selection.primaryEdgeId
    });
    const executionContext = createExecutionContext(outline, origin, selection, edgeId);

    const turnIntoSubmenu = nodes.find(
      (node) => node.type === "submenu" && node.id === "outline.context.submenu.turnInto"
    );
    expect(turnIntoSubmenu).toBeDefined();
    const submenuItems = turnIntoSubmenu && turnIntoSubmenu.type === "submenu" ? turnIntoSubmenu.items : [];
    const taskCommand = submenuItems.find(
      (item) => item.type === "command" && item.id === "outline.context.turnInto.task"
    );
    expect(taskCommand).toBeDefined();
    if (taskCommand && taskCommand.type === "command") {
      taskCommand.run(executionContext);
    }
    const metadata = getNodeMetadata(outline, nodeId);
    expect(metadata.todo?.done).toBe(false);
    expect(emitEvent).not.toHaveBeenCalled();
  });

  it("emits a reassignment event before replacing the Inbox node", () => {
    const outline = createOutlineDoc();
    const origin = Symbol("test");
    const first = addEdge(outline, {
      parentNodeId: null,
      position: 0,
      origin,
      text: "Existing inbox"
    });
    const second = addEdge(outline, {
      parentNodeId: null,
      position: 1,
      origin,
      text: "Next inbox"
    });

    setInboxNodeId(outline, first.nodeId, origin);

    const selection: OutlineContextMenuSelectionSnapshot = {
      primaryEdgeId: second.edgeId,
      orderedEdgeIds: [second.edgeId],
      canonicalEdgeIds: [second.edgeId],
      nodeIds: [second.nodeId],
      anchorEdgeId: second.edgeId,
      focusEdgeId: second.edgeId
    };

    const emitEvent = vi.fn();
    const nodes = createOutlineContextMenuDescriptors({
      outline,
      origin,
      selection,
      handleCommand: () => true,
      handleDeleteSelection: () => true,
      emitEvent,
      anchor: { x: 10, y: 20 },
      paneId: "pane",
      triggerEdgeId: selection.primaryEdgeId
    });
    const executionContext = createExecutionContext(outline, origin, selection, second.edgeId);

    const turnIntoSubmenu = nodes.find(
      (node) => node.type === "submenu" && node.id === "outline.context.submenu.turnInto"
    );
    expect(turnIntoSubmenu).toBeDefined();
    const submenuItems = turnIntoSubmenu && turnIntoSubmenu.type === "submenu" ? turnIntoSubmenu.items : [];
    const inboxCommand = submenuItems.find(
      (item) => item.type === "command" && item.id === "outline.context.turnInto.inbox"
    );
    expect(inboxCommand).toBeDefined();
    if (inboxCommand && inboxCommand.type === "command") {
      inboxCommand.run(executionContext);
    }

    expect(emitEvent).toHaveBeenCalledTimes(1);
    const event = emitEvent.mock.calls[0][0] as OutlineContextMenuSingletonReassignmentEvent;
    expect(event.type).toBe("requestSingletonReassignment");
    expect(event.role).toBe("inbox");
    expect(event.currentNodeId).toBe(first.nodeId);
    expect(event.nextNodeId).toBe(second.nodeId);
    // The menu should not reassign automatically.
    expect(getInboxNodeId(outline)).toBe(first.nodeId);

    event.confirm();
    expect(getInboxNodeId(outline)).toBe(second.nodeId);
  });

  it("assigns the journal node immediately when no reassignment is required", () => {
    const outline = createOutlineDoc();
    const origin = Symbol("test");
    const { edgeId, nodeId } = addEdge(outline, {
      parentNodeId: null,
      position: 0,
      origin,
      text: "Journal candidate"
    });

    const selection: OutlineContextMenuSelectionSnapshot = {
      primaryEdgeId: edgeId,
      orderedEdgeIds: [edgeId],
      canonicalEdgeIds: [edgeId],
      nodeIds: [nodeId],
      anchorEdgeId: edgeId,
      focusEdgeId: edgeId
    };

    const emitEvent = vi.fn();
    const nodes = createOutlineContextMenuDescriptors({
      outline,
      origin,
      selection,
      handleCommand: () => true,
      handleDeleteSelection: () => true,
      emitEvent,
      anchor: { x: 12, y: 16 },
      paneId: "pane",
      triggerEdgeId: selection.primaryEdgeId
    });
    const executionContext = createExecutionContext(outline, origin, selection, edgeId);

    const turnIntoSubmenu = nodes.find(
      (node): node is Extract<typeof node, { type: "submenu" }> =>
        node.type === "submenu" && node.id === "outline.context.submenu.turnInto"
    );
    expect(turnIntoSubmenu).toBeDefined();
    const journalCommand = turnIntoSubmenu?.items.find(
      (item) => item.type === "command" && item.id === "outline.context.turnInto.journal"
    );
    expect(journalCommand && journalCommand.type === "command").toBe(true);
    expect(getJournalNodeId(outline)).toBeNull();
    if (journalCommand && journalCommand.type === "command") {
      journalCommand.run(executionContext);
    }
    expect(getJournalNodeId(outline)).toBe(nodeId);
    expect(emitEvent).not.toHaveBeenCalled();
  });

  it("applies the current selection snapshot before running shared command handlers", () => {
    const outline = createOutlineDoc();
    const origin = Symbol("test");
    const selection = createSelection(["edge-order"]);
    const invocationOrder: string[] = [];
    const handleCommand = vi.fn(() => {
      invocationOrder.push("command");
      return true;
    });
    const applySelectionSnapshot = vi.fn(() => {
      invocationOrder.push("snapshot");
    });

    const nodes = createOutlineContextMenuDescriptors({
      outline,
      origin,
      selection,
      handleCommand,
      handleDeleteSelection: () => true,
      emitEvent: () => undefined,
      anchor: { x: 4, y: 8 },
      paneId: "pane",
      triggerEdgeId: selection.primaryEdgeId,
      applySelectionSnapshot
    });
    const executionContext = createExecutionContext(outline, origin, selection, "edge-order");

    const indentCommand = nodes.find(
      (node): node is Extract<typeof node, { type: "command" }> =>
        node.type === "command" && node.id === "outline.context.indent"
    );
    expect(indentCommand).toBeDefined();
    indentCommand?.run(executionContext);
    expect(applySelectionSnapshot).toHaveBeenCalledTimes(1);
    expect(applySelectionSnapshot).toHaveBeenCalledWith(selection);
    expect(handleCommand).toHaveBeenCalledWith("outline.indentSelection");
    expect(invocationOrder).toEqual(["snapshot", "command"]);
  });
});
