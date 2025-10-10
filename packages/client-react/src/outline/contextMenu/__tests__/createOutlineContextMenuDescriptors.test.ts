import { describe, expect, it, vi } from "vitest";

import { createOutlineContextMenuDescriptors } from "../createOutlineContextMenuDescriptors";
import type { OutlineContextMenuExecutionContext, OutlineContextMenuSelectionSnapshot } from "@thortiq/client-core";
import { createOutlineDoc } from "@thortiq/client-core";

const createSelection = (edgeIds: readonly string[]): OutlineContextMenuSelectionSnapshot => ({
  primaryEdgeId: edgeIds[0] ?? "edge-primary",
  orderedEdgeIds: edgeIds.length > 0 ? [...edgeIds] : ["edge-primary"],
  canonicalEdgeIds: edgeIds.length > 0 ? [...edgeIds] : ["edge-primary"],
  nodeIds: edgeIds.length > 0 ? edgeIds.map((edgeId) => `node-${edgeId}`) : ["node-primary"],
  anchorEdgeId: edgeIds[0] ?? "edge-primary",
  focusEdgeId: edgeIds.slice(-1)[0] ?? "edge-primary"
});

const createExecutionContext = (
  selection: OutlineContextMenuSelectionSnapshot,
  triggerEdgeId: string
): OutlineContextMenuExecutionContext => ({
  outline: createOutlineDoc(),
  origin: Symbol("test"),
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
    const nodes = createOutlineContextMenuDescriptors({
      selection,
      handleCommand,
      handleDeleteSelection: handleDelete
    });
    const executionContext = createExecutionContext(selection, "edge-1");

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
    const nodes = createOutlineContextMenuDescriptors({
      selection,
      handleCommand,
      handleDeleteSelection: () => true
    });
    const executionContext = createExecutionContext(selection, "edge-a");

    const newChild = nodes.find(
      (node): node is Extract<typeof node, { type: "command" }> => node.type === "command" && node.id === "outline.context.insertChild"
    );
    expect(newChild?.isEnabled?.(executionContext)).toBe(false);
  });
});
