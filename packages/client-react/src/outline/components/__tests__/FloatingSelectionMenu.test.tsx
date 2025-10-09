import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import type { EditorState } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";

import type { CollaborativeEditor } from "@thortiq/editor-prosemirror";

import { FloatingSelectionMenu } from "../FloatingSelectionMenu";

type MutableSelection = {
  from: number;
  to: number;
  empty: boolean;
};

const createStubEditor = (
  selection: MutableSelection
): CollaborativeEditor & {
  __setCoords: (pos: number, coords: { left: number; right: number; top: number; bottom: number }) => void;
  __setSelection: (nextSelection: MutableSelection) => void;
} => {
  const dom = document.createElement("div");
  document.body.appendChild(dom);

  const coordsMap = new Map<number, { left: number; right: number; top: number; bottom: number }>();
  const setCoords = (pos: number, coords: { left: number; right: number; top: number; bottom: number }) => {
    coordsMap.set(pos, coords);
  };

  const state = { selection } as unknown as EditorState;

  const view = {
    state,
    dom,
    hasFocus: () => true,
    coordsAtPos: (pos: number) => {
      const coords = coordsMap.get(pos);
      if (!coords) {
        throw new Error(`Missing coords for position ${pos}`);
      }
      return coords;
    }
  } as unknown as EditorView;

  const stub: CollaborativeEditor = {
    view,
    focus: () => {},
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
    toggleHeadingLevel: () => false,
    getActiveHeadingLevel: () => null,
    toggleBold: () => false,
    toggleItalic: () => false,
    toggleUnderline: () => false,
    clearInlineFormatting: () => false,
    destroy: () => {}
  };

  return Object.assign(stub, {
    __setCoords: setCoords,
    __setSelection(nextSelection: MutableSelection) {
      (stub.view as unknown as { state: { selection: MutableSelection } }).state.selection = nextSelection;
    }
  });
};

describe("FloatingSelectionMenu", () => {
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

  it("does not render when the selection is collapsed", async () => {
    const selection: MutableSelection = { from: 1, to: 1, empty: true };
    const editor = createStubEditor(selection);

    render(
      <FloatingSelectionMenu editor={editor}>
        <div>menu</div>
      </FloatingSelectionMenu>
    );

    await waitFor(() => {
      expect(document.querySelector("[data-floating-selection-menu=\"true\"]")).toBeNull();
    });
  });

  it("renders in a portal with computed coordinates for a non-empty selection", async () => {
    const selection: MutableSelection = { from: 1, to: 4, empty: false };
    const editor = createStubEditor(selection);
    editor.__setCoords(1, { left: 200, right: 220, top: 100, bottom: 120 });
    editor.__setCoords(4, { left: 260, right: 280, top: 120, bottom: 140 });

    const portalRoot = document.createElement("div");
    document.body.appendChild(portalRoot);

    render(
      <FloatingSelectionMenu editor={editor} portalContainer={portalRoot}>
        {({ selectionRect }) => <span data-testid="menu" data-width={selectionRect.width} />}
      </FloatingSelectionMenu>
    );

    document.dispatchEvent(new Event("selectionchange"));

    await waitFor(() => {
      expect(screen.getByTestId("menu")).not.toBeNull();
    });

    const host = portalRoot.querySelector("[data-floating-selection-menu=\"true\"]") as HTMLElement;
    expect(host).not.toBeNull();
    expect(host.style.top).toBe("92px");
    expect(host.style.left).toBe("240px");
    expect(host.style.transform).toBe("translate(-50%, -100%)");

    expect(screen.getByTestId("menu").getAttribute("data-width")).toBe("80");
  });

  it("hides after the selection collapses", async () => {
    const selection: MutableSelection = { from: 1, to: 4, empty: false };
    const editor = createStubEditor(selection);
    editor.__setCoords(1, { left: 10, right: 20, top: 10, bottom: 20 });
    editor.__setCoords(4, { left: 30, right: 40, top: 10, bottom: 20 });

    render(
      <FloatingSelectionMenu editor={editor}>
        <div>visible</div>
      </FloatingSelectionMenu>
    );

    document.dispatchEvent(new Event("selectionchange"));

    await waitFor(() => {
      expect(document.querySelector("[data-floating-selection-menu=\"true\"]")).not.toBeNull();
    });

    editor.__setSelection({ from: 2, to: 2, empty: true });
    document.dispatchEvent(new Event("selectionchange"));

    await waitFor(() => {
      expect(document.querySelector("[data-floating-selection-menu=\"true\"]")).toBeNull();
    });
  });
});
