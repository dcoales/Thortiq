import { describe, expect, it, vi } from "vitest";

import type {
  OutlineContextMenuCommandDescriptor,
  OutlineContextMenuExecutionContext,
  OutlineContextMenuSelectionSnapshot,
  OutlineContextMenuSubmenuDescriptor,
  OutlineContextMenuSeparatorDescriptor
} from "../outlineContextMenu";
import {
  flattenOutlineContextMenuTree,
  isOutlineContextMenuCommand,
  isOutlineContextMenuSeparator,
  isOutlineContextMenuSubmenu
} from "../outlineContextMenu";

const createSelectionSnapshot = (): OutlineContextMenuSelectionSnapshot => ({
  primaryEdgeId: "edge:primary",
  orderedEdgeIds: ["edge:primary"],
  canonicalEdgeIds: ["edge:primary"],
  nodeIds: ["node:primary"],
  anchorEdgeId: "edge:primary",
  focusEdgeId: "edge:primary"
});

const createExecutionContext = (): OutlineContextMenuExecutionContext => {
  const outline = null as unknown as OutlineContextMenuExecutionContext["outline"];
  return {
    outline,
    origin: Symbol("test"),
    selection: createSelectionSnapshot(),
    source: {
      paneId: "pane:test",
      triggerEdgeId: "edge:primary"
    }
  };
};

const createCommand = (overrides: Partial<OutlineContextMenuCommandDescriptor> = {}) => {
  const run = vi.fn().mockReturnValue({ handled: true });
  const command: OutlineContextMenuCommandDescriptor = {
    type: "command",
    id: "outline.context.test",
    label: "Test",
    selectionMode: "any",
    run,
    ...overrides
  };
  return command;
};

describe("outlineContextMenu descriptors", () => {
  it("identifies commands, submenus, and separators via type guards", () => {
    const command = createCommand();
    const submenu = {
      type: "submenu",
      id: "outline.context.submenu.sample",
      label: "Sub",
      items: [command]
    } satisfies OutlineContextMenuSubmenuDescriptor;
    const separator = {
      type: "separator",
      id: "outline.context.separator.sample"
    } satisfies OutlineContextMenuSeparatorDescriptor;

    expect(isOutlineContextMenuCommand(command)).toBe(true);
    expect(isOutlineContextMenuCommand(submenu)).toBe(false);
    expect(isOutlineContextMenuCommand(separator)).toBe(false);

    expect(isOutlineContextMenuSubmenu(submenu)).toBe(true);
    expect(isOutlineContextMenuSubmenu(command)).toBe(false);
    expect(isOutlineContextMenuSubmenu(separator)).toBe(false);

    expect(isOutlineContextMenuSeparator(separator)).toBe(true);
    expect(isOutlineContextMenuSeparator(command)).toBe(false);
    expect(isOutlineContextMenuSeparator(submenu)).toBe(false);
  });

  it("flattens descriptor trees depth-first", () => {
    const commandA = createCommand({ id: "outline.context.test.a" });
    const commandB = createCommand({ id: "outline.context.test.b" });
    const submenu = {
      type: "submenu",
      id: "outline.context.submenu.sample",
      label: "Sub",
      items: [commandB]
    } satisfies OutlineContextMenuSubmenuDescriptor;
    const nodes = [commandA, submenu];
    const flattened = flattenOutlineContextMenuTree(nodes);
    expect(flattened).toContain(commandA);
    expect(flattened).toContain(submenu);
    expect(flattened).toContain(commandB);
    expect(flattened.length).toBe(3);
  });

  it("evaluates enable predicates before running commands", () => {
    const runSpy = vi.fn().mockReturnValue({ handled: true });
    const command = createCommand({
      run: runSpy,
      isEnabled: (context) => context.selection.orderedEdgeIds.length > 0
    });
    const submenu = {
      type: "submenu",
      id: "outline.context.submenu.sample",
      label: "Sub",
      items: [command]
    } satisfies OutlineContextMenuSubmenuDescriptor;

    const context = createExecutionContext();
    const enabled = submenu.items.every((item) => {
      if (isOutlineContextMenuCommand(item) && item.isEnabled) {
        return item.isEnabled(context);
      }
      return true;
    });

    expect(enabled).toBe(true);
    expect(runSpy).not.toHaveBeenCalled();
  });
});
