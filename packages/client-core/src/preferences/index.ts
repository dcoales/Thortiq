/**
 * Shared user preference helpers exposed by client-core. Modules here remain UI-agnostic so
 * platform adapters can compose them without duplicating persistence logic.
 */
export {
  DEFAULT_COLOR_SWATCHES,
  addColorPaletteSwatch,
  getColorPalette,
  removeColorPaletteSwatch,
  replaceColorPalette,
  resetColorPalette,
  updateColorPaletteSwatch,
  type AddColorPaletteSwatchOptions,
  type ColorPaletteSnapshot,
  type PaletteMutationOptions,
  type RemoveColorPaletteSwatchOptions,
  type ReplaceColorPaletteOptions,
  type ResetColorPaletteOptions,
  type UpdateColorPaletteSwatchOptions
} from "./colorPalette";
