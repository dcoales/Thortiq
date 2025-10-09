import { describe, expect, it } from "vitest";

import { OutlineError, createOutlineDoc } from "../doc/transactions";
import {
  DEFAULT_COLOR_SWATCHES,
  addColorPaletteSwatch,
  getColorPalette,
  removeColorPaletteSwatch,
  replaceColorPalette,
  resetColorPalette,
  updateColorPaletteSwatch
} from "./colorPalette";

describe("colorPalette preferences", () => {
  it("seeds default swatches on first read", () => {
    const outline = createOutlineDoc();

    const palette = getColorPalette(outline);

    expect(palette.swatches).toEqual(DEFAULT_COLOR_SWATCHES);
    expect(palette.version).toBeGreaterThan(0);
  });

  it("supports appending new swatches with a deterministic timestamp", () => {
    const outline = createOutlineDoc();
    const basePalette = getColorPalette(outline);
    const timestamp = 1_694_000_000_000;

    const updated = addColorPaletteSwatch(outline, "#111111", { timestamp });

    expect(updated.updatedAt).toBe(timestamp);
    expect(updated.swatches.length).toBe(basePalette.swatches.length + 1);
    expect(updated.swatches.at(-1)).toBe("#111111");

    const persisted = getColorPalette(outline);
    expect(persisted.swatches).toEqual(updated.swatches);
  });

  it("updates an existing swatch in place", () => {
    const outline = createOutlineDoc();
    const base = getColorPalette(outline);
    const insertIndex = base.swatches.length;
    addColorPaletteSwatch(outline, "#222222", { timestamp: 1 });

    const next = updateColorPaletteSwatch(outline, insertIndex, "#ffffff", { timestamp: 2 });

    expect(next.swatches[insertIndex]).toBe("#ffffff");
    expect(next.swatches.includes("#222222")).toBe(false);
  });

  it("prevents removing the final swatch", () => {
    const outline = createOutlineDoc();
    replaceColorPalette(outline, ["#12345680"], { timestamp: 3 });

    expect(() => removeColorPaletteSwatch(outline, 0, { timestamp: 4 })).toThrow(
      OutlineError
    );
  });

  it("resets to defaults and clears custom entries", () => {
    const outline = createOutlineDoc();
    replaceColorPalette(outline, ["#12345678", "#abcdef12"], { timestamp: 5 });
    const timestamp = 1_700_000_000_000;

    const resetSnapshot = resetColorPalette(outline, { timestamp });

    expect(resetSnapshot.swatches).toEqual(DEFAULT_COLOR_SWATCHES);
    expect(resetSnapshot.updatedAt).toBe(timestamp);
  });
});
