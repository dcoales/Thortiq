import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { OutlineProvider } from "../../outline/OutlineProvider";
import { OutlineView } from "../OutlineView";
// Imports below kept minimal; this test only verifies dialog path without setup.

describe("Journal UI", () => {
  it("shows Missing Journal dialog when focusing Journal via shortcut without assignment", async () => {
    render(
      <OutlineProvider options={{ skipDefaultSeed: true }}>
        <OutlineView paneId="outline" />
      </OutlineProvider>
    );

    // Ensure the tree is mounted so keyboard listeners are registered
    await screen.findByRole("tree", { name: /Outline/i });
    // Simulate Alt+Ctrl+J handled inside OutlineView to focus journal
    // Listener is registered with capture:true; dispatch in capture phase
    const event = new KeyboardEvent("keydown", { key: "j", altKey: true, ctrlKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(event);

    const dialog = await screen.findByRole("dialog", { name: /No Journal Node Found/i }, { timeout: 1500 });
    expect(dialog).toBeDefined();
    const ok = within(dialog).getByRole("button", { name: /OK/i });
    fireEvent.click(ok);
  });
});


