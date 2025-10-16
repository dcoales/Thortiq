import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { OutlineProvider } from "../../outline/OutlineProvider";
import { OutlineView } from "../OutlineView";
// Imports below kept minimal; this test only verifies dialog path without setup.

describe("Journal UI", () => {
  it("shows Missing Journal dialog when focusing Journal via shortcut without assignment", async () => {
    render(
      <OutlineProvider>
        <OutlineView paneId="outline" />
      </OutlineProvider>
    );

    // Simulate Alt+Ctrl+J handled inside OutlineView to focus journal
    const event = new KeyboardEvent("keydown", { key: "j", altKey: true, ctrlKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(event);

    const dialog = await screen.findByRole("dialog", { name: /No Journal Node Found/i });
    expect(dialog).toBeDefined();
    const ok = within(dialog).getByRole("button", { name: /OK/i });
    fireEvent.click(ok);
  });
});


