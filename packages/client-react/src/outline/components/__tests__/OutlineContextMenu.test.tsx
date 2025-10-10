import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { OutlineContextMenu } from "../OutlineContextMenu";
import { createOutlineDoc } from "@thortiq/client-core";
import type {
  OutlineContextMenuExecutionContext,
  OutlineContextMenuNode
} from "@thortiq/client-core";

const createExecutionContext = (): OutlineContextMenuExecutionContext => {
  return {
    outline: createOutlineDoc(),
    origin: Symbol("test"),
    selection: {
      primaryEdgeId: "edge-1",
      orderedEdgeIds: ["edge-1"],
      canonicalEdgeIds: ["edge-1"],
      nodeIds: ["node-1"],
      anchorEdgeId: "edge-1",
      focusEdgeId: "edge-1"
    },
    source: {
      paneId: "pane-1",
      triggerEdgeId: "edge-1"
    }
  } satisfies OutlineContextMenuExecutionContext;
};

describe("OutlineContextMenu", () => {
  it("runs commands and closes when handled", async () => {
    const run = vi.fn().mockReturnValue({ handled: true });
    const onClose = vi.fn();
    const nodes: readonly OutlineContextMenuNode[] = [
      {
        type: "command",
        id: "outline.context.sample",
        label: "Sample",
        selectionMode: "any",
        run,
        ariaLabel: "Sample command"
      }
    ];

    render(
      <OutlineContextMenu
        anchor={{ x: 40, y: 40 }}
        nodes={nodes}
        executionContext={createExecutionContext()}
        onClose={onClose}
      />
    );

    const button = screen.getByRole("menuitem", { name: "Sample" });
    fireEvent.click(button);

    await waitFor(() => {
      expect(run).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("disables commands when the descriptor is not enabled", () => {
    const run = vi.fn().mockReturnValue({ handled: true });
    const nodes: readonly OutlineContextMenuNode[] = [
      {
        type: "command",
        id: "outline.context.disabled",
        label: "Disabled",
        selectionMode: "any",
        run,
        isEnabled: () => false
      }
    ];

    render(
      <OutlineContextMenu
        anchor={{ x: 10, y: 10 }}
        nodes={nodes}
        executionContext={createExecutionContext()}
        onClose={vi.fn()}
      />
    );

    const button = screen.getByRole("menuitem", { name: "Disabled" });
    expect(button.hasAttribute("disabled")).toBe(true);
    fireEvent.click(button);
    expect(run).not.toHaveBeenCalled();
  });
});
