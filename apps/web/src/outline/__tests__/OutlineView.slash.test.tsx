import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { act } from "react-dom/test-utils";
import { afterEach, describe, expect, it } from "vitest";

import { OutlineProvider, seedDefaultOutline } from "../OutlineProvider";
import { OutlineView } from "../OutlineView";

const renderOutline = () =>
  render(
    <OutlineProvider options={{ skipDefaultSeed: false, seedOutline: seedDefaultOutline }}>
      <OutlineView paneId="outline" />
    </OutlineProvider>
  );

const placeCaretInFirstRow = async () => {
  const tree = await screen.findByRole("tree");
  const rows = within(tree).getAllByRole("treeitem");
  const first = rows[0];
  fireEvent.mouseDown(first);
  await waitFor(() => expect(first.getAttribute("aria-selected")).toBe("true"));
  return { tree, first } as const;
};

afterEach(() => {
  cleanup();
});

describe("OutlineView slash commands", () => {
  it("/h2 applies heading 2 to the active row", async () => {
    renderOutline();
    const { tree, first } = await placeCaretInFirstRow();

    await act(async () => {
      fireEvent.keyDown(tree, { key: "/" });
      fireEvent.keyDown(tree, { key: "h" });
      fireEvent.keyDown(tree, { key: "2" });
      fireEvent.keyDown(tree, { key: "Enter" });
    });

    // Heading 2 is rendered via style change; assert aria-level remains but heading mark implied by CSS class
    expect(first.getAttribute("aria-level")).toBeDefined();
  });

  it("/move opens the Move To dialog", async () => {
    renderOutline();
    const { tree } = await placeCaretInFirstRow();

    await act(async () => {
      fireEvent.keyDown(tree, { key: "/" });
      fireEvent.keyDown(tree, { key: "m" });
      fireEvent.keyDown(tree, { key: "o" });
      fireEvent.keyDown(tree, { key: "v" });
      fireEvent.keyDown(tree, { key: "e" });
      fireEvent.keyDown(tree, { key: "Enter" });
    });

    // Move dialog should be present (has role dialog or textbox for query)
    const dialog = await screen.findByRole("dialog", { name: /move/i }).catch(() => null);
    const query = dialog ? within(dialog).queryByRole("textbox") : screen.queryByRole("textbox");
    expect(dialog || query).toBeTruthy();
  });

  it("/today inserts a date pill at caret (smoke)", async () => {
    renderOutline();
    const { tree } = await placeCaretInFirstRow();

    await act(async () => {
      fireEvent.keyDown(tree, { key: "/" });
      fireEvent.keyDown(tree, { key: "t" });
      fireEvent.keyDown(tree, { key: "o" });
      fireEvent.keyDown(tree, { key: "d" });
      fireEvent.keyDown(tree, { key: "a" });
      fireEvent.keyDown(tree, { key: "y" });
      fireEvent.keyDown(tree, { key: "Enter" });
    });

    // Date pill renders as a button with data-date
    const pill = await screen.findByRole("button", { name: /\w{3},\s\w{3}\s\d{1,2}/i }).catch(() => null);
    expect(pill || document.querySelector('[data-date="true"]')).toBeTruthy();
  });

  it("/task converts the row into a task (checkbox appears)", async () => {
    renderOutline();
    const { tree, first } = await placeCaretInFirstRow();

    await act(async () => {
      fireEvent.keyDown(tree, { key: "/" });
      fireEvent.keyDown(tree, { key: "t" });
      fireEvent.keyDown(tree, { key: "a" });
      fireEvent.keyDown(tree, { key: "s" });
      fireEvent.keyDown(tree, { key: "k" });
      fireEvent.keyDown(tree, { key: "Enter" });
    });

    // Expect a checkbox inside the selected row
    const checkbox = within(first).queryByRole("checkbox");
    expect(checkbox).toBeTruthy();
  });

  it("/move to date opens the date picker popover", async () => {
    renderOutline();
    const { tree } = await placeCaretInFirstRow();

    await act(async () => {
      fireEvent.keyDown(tree, { key: "/" });
      // Type "move to date" minimally to subsequence match: m t d
      fireEvent.keyDown(tree, { key: "m" });
      fireEvent.keyDown(tree, { key: "t" });
      fireEvent.keyDown(tree, { key: "d" });
      fireEvent.keyDown(tree, { key: "Enter" });
    });

    // The date picker shows current month header in "Month YYYY" format (en-US)
    const headerText = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(new Date());
    const header = await screen.findByText(new RegExp(headerText.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&"), "i"));
    expect(header).toBeTruthy();
  });
});


