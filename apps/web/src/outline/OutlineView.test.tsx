import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { OutlineProvider } from "./OutlineProvider";
import { OutlineView } from "./OutlineView";
import { TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";

describe("OutlineView", () => {
  it("renders seeded outline rows", async () => {
    render(
      <OutlineProvider>
        <OutlineView />
      </OutlineProvider>
    );

    const welcome = await screen.findByText(/Welcome to Thortiq/i);
    expect(welcome.textContent).toContain("Welcome to Thortiq");
  });

  it("runs basic outline commands via keyboard", async () => {
    render(
      <OutlineProvider>
        <OutlineView />
      </OutlineProvider>
    );

    const tree = await screen.findByRole("tree");
    const initialItems = within(tree).getAllByRole("treeitem");
    expect(initialItems.length).toBeGreaterThanOrEqual(4);

    fireEvent.keyDown(tree, { key: "Enter" });

    await screen.findAllByText(/Untitled node/i);
    const afterInsertItems = within(tree).getAllByRole("treeitem");
    expect(afterInsertItems.length).toBe(initialItems.length + 1);

    fireEvent.keyDown(tree, { key: "ArrowDown" });
    fireEvent.keyDown(tree, { key: "ArrowDown" });
    fireEvent.keyDown(tree, { key: "Tab" });

    fireEvent.keyDown(tree, { key: "ArrowLeft" });
    fireEvent.keyDown(tree, { key: "ArrowRight" });

    fireEvent.keyDown(tree, { key: "Enter", shiftKey: true });

    const untitledNodes = within(tree).getAllByText(/Untitled node/i);
    expect(untitledNodes.length).toBeGreaterThan(0);
  });

  it("allows clicking a row to select it", async () => {
    render(
      <OutlineProvider>
        <OutlineView />
      </OutlineProvider>
    );

    const treeItems = await screen.findAllByRole("treeitem");
    const secondRow = treeItems[1];

    fireEvent.mouseDown(secondRow);

    expect(secondRow.getAttribute("aria-selected")).toBe("true");
  });
});

describe("OutlineView with ProseMirror", () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).__THORTIQ_PROSEMIRROR_TEST__ = true;
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__THORTIQ_PROSEMIRROR_TEST__;
    delete (globalThis as Record<string, unknown>).__THORTIQ_LAST_EDITOR__;
  });

  const renderWithEditor = () =>
    render(
      <OutlineProvider>
        <OutlineView />
      </OutlineProvider>
    );

  // TODO(thortiq): enable once ProseMirror/y-prosemirror lifecycle is stable across node switches.
  it("keeps static rows in sync with editor edits", async () => {
    renderWithEditor();

    const tree = await screen.findByRole("tree");
    await waitFor(() => expect(document.querySelector(".thortiq-prosemirror")).toBeTruthy());

    const editorInstance = (globalThis as Record<string, unknown>).__THORTIQ_LAST_EDITOR__ as
      | { view: EditorView }
      | undefined;
    expect(editorInstance).toBeTruthy();

    const view = editorInstance!.view;
    view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)));
    view.dispatch(view.state.tr.insertText(" updated"));

    await waitFor(() => expect(view.state.doc.textContent).toMatch(/updated/));

    fireEvent.keyDown(tree, { key: "ArrowDown" });

    await waitFor(() => expect(tree.textContent).toMatch(/Welcome to Thortiq updated/));
  });

  // TODO(thortiq): fails due to y-prosemirror awareness updates hitting a destroyed view.
  it("toggles collapsed state via keyboard", async () => {
    renderWithEditor();

    const tree = await screen.findByRole("tree");
    await waitFor(() => expect(document.querySelector(".thortiq-prosemirror")).toBeTruthy());

    // Collapse the root node.
    fireEvent.keyDown(tree, { key: "ArrowLeft" });

    await waitFor(() => expect(within(tree).queryByText(/Phase 1 focuses/i)).toBeNull());
    expect(within(tree).getByText("▶")).toBeInTheDocument();

    // Expand again.
    fireEvent.keyDown(tree, { key: "ArrowRight" });

    await waitFor(() => expect(within(tree).getByText(/Phase 1 focuses/i)).toBeInTheDocument());
  });
});
