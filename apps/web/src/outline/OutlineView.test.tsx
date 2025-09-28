import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { OutlineProvider } from "./OutlineProvider";
import { OutlineView } from "./OutlineView";

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
});
