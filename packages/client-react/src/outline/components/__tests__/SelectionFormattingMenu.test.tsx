import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import type { EditorView } from "prosemirror-view";
import type { EditorState } from "prosemirror-state";

import type { CollaborativeEditor } from "@thortiq/editor-prosemirror";

import { SelectionFormattingMenu } from "../SelectionFormattingMenu";

type MutableSelection = {
  from: number;
  to: number;
  empty: boolean;
};

interface StubEditor extends CollaborativeEditor {
  __setCoords: (pos: number, coords: { left: number; right: number; top: number; bottom: number }) => void;
  __setSelection: (selection: MutableSelection) => void;
}

const createStubEditor = (): StubEditor => {
  const container = document.createElement("div");
  document.body.appendChild(container);

  const coordsMap = new Map<number, { left: number; right: number; top: number; bottom: number }>();
  const selection: MutableSelection = { from: 1, to: 4, empty: false };

  const view = {
    dom: container,
    state: {
      selection,
      schema: { marks: {} },
      doc: { rangeHasMark: () => false },
      storedMarks: null
    } as unknown as EditorState,
    hasFocus: () => true,
    coordsAtPos: (pos: number) => {
      const coords = coordsMap.get(pos);
      if (!coords) {
        throw new Error(`Missing coordinates for ${pos}`);
      }
      return coords;
    }
  } as unknown as EditorView;

  const focus = vi.fn();
  const toggleBold = vi.fn().mockReturnValue(true);
  const toggleItalic = vi.fn().mockReturnValue(true);
  const toggleUnderline = vi.fn().mockReturnValue(true);
  const clearInlineFormatting = vi.fn().mockReturnValue(true);
  const toggleHeadingLevel = vi.fn().mockReturnValue(true);

  const stub: CollaborativeEditor = {
    view,
    focus,
    setNode: () => {},
    setContainer: () => {},
    setOutlineKeymapOptions: () => {},
    setWikiLinkOptions: () => {},
    setMirrorOptions: () => {},
    setTagOptions: () => {},
    getWikiLinkTrigger: () => null,
    getMirrorTrigger: () => null,
    getTagTrigger: () => null,
    applyWikiLink: () => false,
    applyTag: () => false,
    cancelWikiLink: () => {},
    consumeMirrorTrigger: () => null,
    cancelMirrorTrigger: () => {},
    consumeTagTrigger: () => null,
    cancelTagTrigger: () => {},
    setHeadingLevel: () => false,
    toggleHeadingLevel,
    getActiveHeadingLevel: () => null,
    toggleBold,
    toggleItalic,
    toggleUnderline,
    clearInlineFormatting,
    destroy: () => {}
  };

  const extended: StubEditor = Object.assign(stub, {
    __setCoords: (pos: number, coords: { left: number; right: number; top: number; bottom: number }) => {
      coordsMap.set(pos, coords);
    },
    __setSelection: (next: MutableSelection) => {
      (view.state as { selection: MutableSelection }).selection = next;
    }
  });

  return extended;
};

describe("SelectionFormattingMenu", () => {
  beforeEach(() => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("invokes inline commands and restores focus after clicking an action", async () => {
    const editor = createStubEditor();
    editor.__setCoords(1, { left: 100, right: 110, top: 50, bottom: 60 });
    editor.__setCoords(4, { left: 140, right: 150, top: 60, bottom: 70 });

    render(<SelectionFormattingMenu editor={editor} />);

    document.dispatchEvent(new Event("selectionchange"));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Bold" })).not.toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: "Bold" }));

    expect(editor.toggleBold).toHaveBeenCalledTimes(1);
    expect(editor.focus).toHaveBeenCalled();
  });

  it("supports arrow-key navigation between buttons", async () => {
    const editor = createStubEditor();
    editor.__setCoords(1, { left: 200, right: 210, top: 40, bottom: 50 });
    editor.__setCoords(4, { left: 240, right: 250, top: 60, bottom: 70 });

    render(<SelectionFormattingMenu editor={editor} />);

    document.dispatchEvent(new Event("selectionchange"));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Heading 1" })).not.toBeNull();
    });

    const firstButton = screen.getByRole("button", { name: "Heading 1" });
    firstButton.focus();
    fireEvent.keyDown(firstButton, { key: "ArrowRight" });

    const activeElement = document.activeElement as HTMLElement | null;
    expect(activeElement?.getAttribute("aria-label")).toBe("Heading 2");
  });

  it("returns focus to the editor when Escape is pressed", async () => {
    const editor = createStubEditor();
    editor.__setCoords(1, { left: 80, right: 90, top: 40, bottom: 50 });
    editor.__setCoords(4, { left: 120, right: 130, top: 60, bottom: 70 });

    render(<SelectionFormattingMenu editor={editor} />);

    document.dispatchEvent(new Event("selectionchange"));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Heading 1" })).not.toBeNull();
    });

    const button = screen.getByRole("button", { name: "Heading 1" });
    button.focus();
    fireEvent.keyDown(button, { key: "Escape" });

    expect(editor.focus).toHaveBeenCalled();
  });
});
