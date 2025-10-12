import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { OutlineError, createOutlineDoc } from "../doc/transactions";
import {
  DEFAULT_TEXT_COLOR_SWATCHES,
  DEFAULT_BACKGROUND_COLOR_SWATCHES,
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

    expect(palette.textSwatches).toEqual(DEFAULT_TEXT_COLOR_SWATCHES);
    expect(palette.backgroundSwatches).toEqual(DEFAULT_BACKGROUND_COLOR_SWATCHES);
    expect(palette.backgroundSwatches.every((swatch) => swatch.length === 9)).toBe(true);
    expect(palette.version).toBeGreaterThanOrEqual(2);
  });

  it("supports appending new swatches with a deterministic timestamp", () => {
    const outline = createOutlineDoc();
    const basePalette = getColorPalette(outline);
    const timestamp = 1_694_000_000_000;

    const updated = addColorPaletteSwatch(outline, "text", "#111111", { timestamp });

    expect(updated.updatedAt).toBe(timestamp);
    expect(updated.textSwatches.length).toBe(basePalette.textSwatches.length + 1);
    expect(updated.textSwatches.at(-1)).toBe("#111111");
    expect(updated.backgroundSwatches).toEqual(basePalette.backgroundSwatches);

    const persisted = getColorPalette(outline);
    expect(persisted.textSwatches).toEqual(updated.textSwatches);
    expect(persisted.backgroundSwatches).toEqual(updated.backgroundSwatches);
  });

  it("updates an existing swatch in place", () => {
    const outline = createOutlineDoc();
    const base = getColorPalette(outline);
    const insertIndex = base.backgroundSwatches.length;
    addColorPaletteSwatch(outline, "background", "#222222", { timestamp: 1 });

    const next = updateColorPaletteSwatch(outline, "background", insertIndex, "#ffffff", {
      timestamp: 2
    });

    expect(next.backgroundSwatches[insertIndex]).toBe("#ffffff");
    expect(next.backgroundSwatches.includes("#222222")).toBe(false);
    expect(next.textSwatches).toEqual(base.textSwatches);
  });

  it("prevents removing the final swatch", () => {
    const outline = createOutlineDoc();
    replaceColorPalette(outline, "text", ["#12345680"], { timestamp: 3 });

    expect(() => removeColorPaletteSwatch(outline, "text", 0, { timestamp: 4 })).toThrow(
      OutlineError
    );
  });

  it("resets to defaults and clears custom entries", () => {
    const outline = createOutlineDoc();
    replaceColorPalette(outline, "text", ["#12345678", "#abcdef12"], { timestamp: 5 });
    replaceColorPalette(outline, "background", ["#654321", "#abcdef"], { timestamp: 5 });
    const timestamp = 1_700_000_000_000;

    const resetSnapshot = resetColorPalette(outline, { timestamp });

    expect(resetSnapshot.textSwatches).toEqual(DEFAULT_TEXT_COLOR_SWATCHES);
    expect(resetSnapshot.backgroundSwatches).toEqual(DEFAULT_BACKGROUND_COLOR_SWATCHES);
    expect(resetSnapshot.updatedAt).toBe(timestamp);
  });

  it("propagates palette changes through CRDT updates", () => {
    const primary = createOutlineDoc();
    const replica = createOutlineDoc();

    addColorPaletteSwatch(primary, "text", "#123456", { timestamp: 10 });

    const update = Y.encodeStateAsUpdate(primary.doc);
    Y.applyUpdate(replica.doc, update);

    const replicated = getColorPalette(replica);
    expect(replicated.textSwatches).toContain("#123456");
    expect(replicated.updatedAt).toBeGreaterThan(0);
  });
});
