import { describe, expect, it, vi } from "vitest";

import { createOutlineContextMenuDescriptors } from "../createOutlineContextMenuDescriptors";
import type { OutlineContextMenuExecutionContext, OutlineContextMenuSelectionSnapshot } from "@thortiq/client-core";
import { createOutlineDoc, addEdge, getNodeMetadata, setNodeHeadingLevel } from "@thortiq/client-core";

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
      handleDeleteSelection: handleDelete
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
      handleDeleteSelection: () => true
    });
    const executionContext = createExecutionContext(outline, origin, selection, "edge-a");

    const newChild = nodes.find(
      (node): node is Extract<typeof node, { type: "command" }> => node.type === "command" && node.id === "outline.context.insertChild"
    );
    expect(newChild?.isEnabled?.(executionContext)).toBe(false);
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
      handleDeleteSelection: () => true
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
});
