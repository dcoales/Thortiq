import { describe, expect, it } from "vitest";
import { createEditorPlaceholder } from "./index";

describe("editor-prosemirror placeholder", () => {
  it("returns a stable placeholder contract", () => {
    expect(createEditorPlaceholder()).toEqual({ placeholder: "prosemirror-editor-pending" });
  });
});
