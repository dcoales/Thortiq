import { describe, expect, it } from "vitest";

import {
  matchOutlineCommand,
  type OutlineCommandDescriptor
} from "../outlineCommands";

describe("outline command matcher", () => {
  it("matches navigation keys", () => {
    const match = matchOutlineCommand({ key: "ArrowDown" });
    expect(match).not.toBeNull();
    expect(match?.descriptor.id).toBe("outline.focusNextRow");
  });

  it("prefers more specific modifier bindings", () => {
    const match = matchOutlineCommand({ key: "Enter", shiftKey: true });
    expect(match?.descriptor.id).toBe("outline.insertChild");
  });

  it("matches control bindings while rejecting meta variants", () => {
    const ctrlMatch = matchOutlineCommand({ key: "Enter", ctrlKey: true });
    expect(ctrlMatch?.descriptor.id).toBe("outline.toggleTodoDone");

    const metaConflict = matchOutlineCommand({ key: "Enter", ctrlKey: true, metaKey: true });
    expect(metaConflict).toBeNull();
  });

  it("resolves overlapping delete bindings", () => {
    const ctrlDelete = matchOutlineCommand({ key: "Backspace", ctrlKey: true, shiftKey: true });
    expect(ctrlDelete?.descriptor.id).toBe("outline.deleteSelection");

    const metaDelete = matchOutlineCommand({ key: "Backspace", metaKey: true, shiftKey: true });
    expect(metaDelete?.descriptor.id).toBe("outline.deleteSelection");
  });

  it("respects repeat flags", () => {
    const repeatAllowed = matchOutlineCommand({ key: "ArrowUp", repeat: true });
    expect(repeatAllowed?.descriptor.id).toBe("outline.focusPreviousRow");

    const repeatBlocked = matchOutlineCommand({ key: "Enter", repeat: true });
    expect(repeatBlocked).toBeNull();
  });

  it("handles conflicting descriptors deterministically", () => {
    const descriptors: OutlineCommandDescriptor[] = [
      {
        id: "outline.insertSiblingBelow",
        category: "editing",
        description: "fallback",
        bindings: [
          {
            key: "KeyX",
            modifiers: { alt: false, ctrl: false, meta: false, shift: false },
            allowRepeat: false
          }
        ]
      },
      {
        id: "outline.insertChild",
        category: "editing",
        description: "shift variant",
        bindings: [
          {
            key: "KeyX",
            modifiers: { alt: false, ctrl: false, meta: false, shift: true },
            allowRepeat: false
          }
        ]
      }
    ];

    const match = matchOutlineCommand({ key: "KeyX", shiftKey: true }, descriptors);
    expect(match?.descriptor.id).toBe("outline.insertChild");
  });
});
