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

    const button = screen.getByRole("menuitem", { name: "Sample command" });
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

  it("opens submenus via pointer interaction", async () => {
    const run = vi.fn().mockReturnValue({ handled: true });
    const onClose = vi.fn();
    const nodes: readonly OutlineContextMenuNode[] = [
      {
        type: "submenu",
        id: "outline.context.submenu.turnInto",
        label: "Turn Into",
        items: [
          {
            type: "command",
            id: "outline.context.turnInto.task",
            label: "Task",
            selectionMode: "any",
            run
          }
        ]
      }
    ];

    render(
      <OutlineContextMenu
        anchor={{ x: 30, y: 30 }}
        nodes={nodes}
        executionContext={createExecutionContext()}
        onClose={onClose}
      />
    );

    const submenuButton = screen.getByRole("menuitem", { name: "Turn Into" });
    fireEvent.mouseEnter(submenuButton);

    const taskItem = await screen.findByRole("menuitem", { name: "Task" });
    fireEvent.click(taskItem);

    await waitFor(() => {
      expect(run).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("opens submenus via keyboard navigation", async () => {
    const run = vi.fn().mockReturnValue({ handled: true });
    const nodes: readonly OutlineContextMenuNode[] = [
      {
        type: "submenu",
        id: "outline.context.submenu.format",
        label: "Format",
        items: [
          {
            type: "command",
            id: "outline.context.format.sample",
            label: "Heading",
            selectionMode: "any",
            run
          }
        ]
      }
    ];

    render(
      <OutlineContextMenu
        anchor={{ x: 24, y: 24 }}
        nodes={nodes}
        executionContext={createExecutionContext()}
        onClose={vi.fn()}
      />
    );

    const menu = screen.getByRole("menu");
    fireEvent.keyDown(menu, { key: "ArrowRight" });

    const headingItem = await screen.findByRole("menuitem", { name: "Heading" });
    await waitFor(() => {
      expect(document.activeElement).toBe(headingItem);
    });
  });

  it("displays a pending state while a command resolves", async () => {
    let resolveRun: ((result: { handled: boolean }) => void) | undefined;
    const run = vi.fn().mockImplementation(() => new Promise<{ handled: boolean }>((resolve) => {
      resolveRun = resolve;
    }));
    const onClose = vi.fn();
    const nodes: readonly OutlineContextMenuNode[] = [
      {
        type: "command",
        id: "outline.context.async",
        label: "Async Command",
        selectionMode: "any",
        run
      }
    ];

    render(
      <OutlineContextMenu
        anchor={{ x: 18, y: 18 }}
        nodes={nodes}
        executionContext={createExecutionContext()}
        onClose={onClose}
      />
    );

    const button = screen.getByRole("menuitem", { name: "Async Command" });
    fireEvent.click(button);

    expect(run).toHaveBeenCalledTimes(1);
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(screen.queryByText("Working…")).not.toBeNull();

    resolveRun?.({ handled: true });

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    expect(screen.queryByText("Working…")).toBeNull();
  });
});
