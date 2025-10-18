import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import type { EditorView } from "prosemirror-view";
import type { EditorState } from "prosemirror-state";

import type { CollaborativeEditor } from "@thortiq/editor-prosemirror";
import {
  DEFAULT_BACKGROUND_COLOR_SWATCHES,
  DEFAULT_TEXT_COLOR_SWATCHES,
  type ColorPaletteMode,
  type ColorPaletteSnapshot
} from "@thortiq/client-core";

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
  const toggleStrikethrough = vi.fn().mockReturnValue(true);
  const clearInlineFormatting = vi.fn().mockReturnValue(true);
  const toggleHeadingLevel = vi.fn().mockReturnValue(true);
  const setTextColor = vi.fn().mockReturnValue(true);
  const setBackgroundColor = vi.fn().mockReturnValue(true);
  const clearTextColor = vi.fn().mockReturnValue(true);
  const clearBackgroundColor = vi.fn().mockReturnValue(true);

  const stub: CollaborativeEditor = {
    view,
    focus,
    setNode: () => {},
    setContainer: () => {},
    setOutlineKeymapOptions: () => {},
    setWikiLinkOptions: () => {},
    setMirrorOptions: () => {},
    setTagOptions: () => {},
    setDateOptions: () => {},
    setSlashOptions: () => {},
    getWikiLinkTrigger: () => null,
    getMirrorTrigger: () => null,
    getTagTrigger: () => null,
    getSlashTrigger: () => null,
    applyWikiLink: () => false,
    applyTag: () => false,
    applyDateTag: () => false,
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
    toggleStrikethrough,
    clearInlineFormatting,
    setTextColor,
    setBackgroundColor,
    clearTextColor,
    clearBackgroundColor,
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

const createPalette = (): ColorPaletteSnapshot => ({
  textSwatches: [...DEFAULT_TEXT_COLOR_SWATCHES],
  backgroundSwatches: [...DEFAULT_BACKGROUND_COLOR_SWATCHES],
  updatedAt: Date.now(),
  version: 2
});

const originalResizeObserver = globalThis.ResizeObserver;

class ImmediateResizeObserver implements ResizeObserver {
  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe(target: Element) {
    const entry = {
      target,
      contentRect: {
        width: target.getBoundingClientRect().width,
        height: target.getBoundingClientRect().height,
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        bottom: 0,
        right: 0,
        toJSON() {
          return {};
        }
      }
    } as ResizeObserverEntry;
    this.callback([entry], this);
  }

  unobserve() {}

  disconnect() {}
}

describe("SelectionFormattingMenu", () => {
  beforeEach(() => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver =
      ImmediateResizeObserver as unknown as typeof ResizeObserver;
  });

  afterEach(() => {
    (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver = originalResizeObserver;
    vi.restoreAllMocks();
  });

  it("invokes inline commands and restores focus after clicking an action", async () => {
    const editor = createStubEditor();
    editor.__setCoords(1, { left: 100, right: 110, top: 50, bottom: 60 });
    editor.__setCoords(4, { left: 140, right: 150, top: 60, bottom: 70 });

    const palette = createPalette();
    render(
      <SelectionFormattingMenu
        editor={editor}
        colorPalette={palette}
        onUpdateColorPalette={() => {}}
      />
    );

    act(() => {
      document.dispatchEvent(new Event("selectionchange"));
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Bold" })).not.toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: "Bold" }));
    fireEvent.click(screen.getByRole("button", { name: "Strikethrough" }));

    expect(editor.toggleBold).toHaveBeenCalledTimes(1);
    expect(editor.toggleStrikethrough).toHaveBeenCalledTimes(1);
    expect(editor.focus).toHaveBeenCalled();
  });

  it("supports arrow-key navigation between buttons", async () => {
    const editor = createStubEditor();
    editor.__setCoords(1, { left: 200, right: 210, top: 40, bottom: 50 });
    editor.__setCoords(4, { left: 240, right: 250, top: 60, bottom: 70 });

    const palette = createPalette();
    render(
      <SelectionFormattingMenu
        editor={editor}
        colorPalette={palette}
        onUpdateColorPalette={() => {}}
      />
    );

    act(() => {
      document.dispatchEvent(new Event("selectionchange"));
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Heading 1" })).not.toBeNull();
    });

    const firstButton = screen.getByRole("button", { name: "Heading 1" });
    act(() => {
      firstButton.focus();
    });
    act(() => {
      fireEvent.keyDown(firstButton, { key: "ArrowRight" });
    });

    const activeElement = document.activeElement as HTMLElement | null;
    expect(activeElement?.getAttribute("aria-label")).toBe("Heading 2");
  });

  it("returns focus to the editor when Escape is pressed", async () => {
    const editor = createStubEditor();
    editor.__setCoords(1, { left: 80, right: 90, top: 40, bottom: 50 });
    editor.__setCoords(4, { left: 120, right: 130, top: 60, bottom: 70 });

    const palette = createPalette();
    render(
      <SelectionFormattingMenu
        editor={editor}
        colorPalette={palette}
        onUpdateColorPalette={() => {}}
      />
    );

    act(() => {
      document.dispatchEvent(new Event("selectionchange"));
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Heading 1" })).not.toBeNull();
    });

    const button = screen.getByRole("button", { name: "Heading 1" });
    act(() => {
      button.focus();
    });
    act(() => {
      fireEvent.keyDown(button, { key: "Escape" });
    });

    expect(editor.focus).toHaveBeenCalled();
  });

  it("applies and clears text colors from the palette", async () => {
    const editor = createStubEditor();
    editor.__setCoords(1, { left: 90, right: 110, top: 40, bottom: 60 });
    editor.__setCoords(4, { left: 130, right: 150, top: 60, bottom: 80 });
    const palette = createPalette();

    render(
      <SelectionFormattingMenu
        editor={editor}
        colorPalette={palette}
        onUpdateColorPalette={() => {}}
      />
    );

    act(() => {
      document.dispatchEvent(new Event("selectionchange"));
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Text color" })).not.toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: "Text color" }));

    await waitFor(() => {
      expect(document.querySelector('[data-formatting-color-popover="text"]')).not.toBeNull();
    });

    const swatchButton = screen.getByRole("button", {
      name: `Set text color to ${palette.textSwatches[0]}`
    });
    fireEvent.click(swatchButton);

    expect(editor.setTextColor).toHaveBeenCalledWith(palette.textSwatches[0]);

    await waitFor(() => {
      expect(document.querySelector('[data-formatting-color-popover="text"]')).toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: "Text color" }));

    await waitFor(() => {
      expect(document.querySelector('[data-formatting-color-popover="text"]')).not.toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: "Clear text" }));

    expect(editor.clearTextColor).toHaveBeenCalled();
  });

  it("supports editing the palette with save and cancel confirmation", async () => {
    const editor = createStubEditor();
    editor.__setCoords(1, { left: 60, right: 90, top: 30, bottom: 50 });
    editor.__setCoords(4, { left: 120, right: 150, top: 55, bottom: 75 });
    const palette = createPalette();
    const handleUpdate = vi.fn();

    render(
      <SelectionFormattingMenu
        editor={editor}
        colorPalette={palette}
        onUpdateColorPalette={handleUpdate}
      />
    );

    act(() => {
      document.dispatchEvent(new Event("selectionchange"));
    });

    fireEvent.click(await screen.findByRole("button", { name: "Text color" }));

    await waitFor(() => {
      expect(document.querySelector('[data-formatting-color-popover="text"]')).not.toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: "Edit palette" }));

    const firstSwatchEditButton = await screen.findByRole("button", { name: "Edit color swatch 1" });
    fireEvent.click(firstSwatchEditButton);

    const colorEditor = await screen.findByRole("dialog", { name: "Edit color" });
    const hexInput = within(colorEditor).getByLabelText("Hex value") as HTMLInputElement;
    fireEvent.change(hexInput, { target: { value: "#123456" } });
    fireEvent.click(within(colorEditor).getByRole("button", { name: "Select color" }));

    fireEvent.click(screen.getByRole("button", { name: "Save palette" }));

    expect(handleUpdate).toHaveBeenCalledTimes(1);
    const [mode, updatedSwatches] = handleUpdate.mock.calls[0] as [
      ColorPaletteMode,
      ReadonlyArray<string>
    ];
    expect(mode).toBe("text");
    expect(updatedSwatches[0]).toBe("#123456");

    fireEvent.click(screen.getByRole("button", { name: "Edit palette" }));
    const firstSwatchEditButtonAfterSave = await screen.findByRole("button", {
      name: "Edit color swatch 1"
    });
    fireEvent.click(firstSwatchEditButtonAfterSave);
    const colorEditorAfterSave = await screen.findByRole("dialog", { name: "Edit color" });
    const hexInputAfterSave = within(colorEditorAfterSave).getByLabelText("Hex value") as HTMLInputElement;
    fireEvent.change(hexInputAfterSave, { target: { value: "#abcdef" } });
    fireEvent.click(within(colorEditorAfterSave).getByRole("button", { name: "Select color" }));

    fireEvent.click(screen.getByRole("button", { name: "Cancel editing" }));

    await waitFor(() => {
      expect(document.querySelector('[data-formatting-color-popover="text"] [role="alert"]')).not.toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: "Discard" }));

    expect(document.querySelector('[data-formatting-color-popover="text"]')).not.toBeNull();
    expect(handleUpdate).toHaveBeenCalledTimes(1);
  });
});
