/**
 * Shared user preference helpers exposed by client-core. Modules here remain UI-agnostic so
 * platform adapters can compose them without duplicating persistence logic.
 */
export {
  DEFAULT_COLOR_SWATCHES,
  DEFAULT_TEXT_COLOR_SWATCHES,
  DEFAULT_BACKGROUND_COLOR_SWATCHES,
  type ColorPaletteMode,
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
export {
  getInboxNodeId,
  getJournalNodeId,
  getInboxSnapshot,
  getJournalSnapshot,
  setInboxNodeId,
  setJournalNodeId,
  clearInboxNode,
  clearJournalNode
} from "./singletonNodes";
export {
  getUserSetting,
  getUserSettingSnapshot,
  setUserSetting,
  deleteUserSetting,
  type UserSettingValue,
  getTasksPaneShowCompleted,
  setTasksPaneShowCompleted
} from "./userSettings";
