/**
 * Shared color palette preferences stored inside the collaborative Y.Doc. These helpers expose a
 * transactional API for reading and mutating swatches so platform adapters can provide consistent
 * UX while respecting AGENTS stability rules (single undo history, no direct Yjs mutations).
 */
import * as Y from "yjs";

import { OutlineError, withTransaction } from "../doc/transactions";
import type { OutlineDoc } from "../types";

const COLOR_PALETTE_RECORD_KEY = "colorPalette";
const COLOR_PALETTE_TEXT_SWATCHES_KEY = "textSwatches";
const COLOR_PALETTE_BACKGROUND_SWATCHES_KEY = "backgroundSwatches";
const LEGACY_COLOR_PALETTE_SWATCHES_KEY = "swatches";
const COLOR_PALETTE_UPDATED_AT_KEY = "updatedAt";
const COLOR_PALETTE_VERSION_KEY = "version";

const COLOR_PALETTE_SCHEMA_VERSION = 2;

type ColorPaletteRecord = Y.Map<unknown>;
type SwatchList = Y.Array<string>;

export type ColorPaletteMode = "text" | "background";

export interface ColorPaletteSnapshot {
  readonly textSwatches: ReadonlyArray<string>;
  readonly backgroundSwatches: ReadonlyArray<string>;
  readonly updatedAt: number;
  readonly version: number;
}

export interface PaletteMutationOptions {
  readonly origin?: unknown;
  readonly timestamp?: number;
}

export interface AddColorPaletteSwatchOptions extends PaletteMutationOptions {
  readonly index?: number;
}

export type ReplaceColorPaletteOptions = PaletteMutationOptions;

export type ResetColorPaletteOptions = PaletteMutationOptions;

export type UpdateColorPaletteSwatchOptions = PaletteMutationOptions;

export type RemoveColorPaletteSwatchOptions = PaletteMutationOptions;

const freezeSwatches = (swatches: ReadonlyArray<string>): ReadonlyArray<string> =>
  Object.freeze([...swatches]);

export const DEFAULT_TEXT_COLOR_SWATCHES: ReadonlyArray<string> = freezeSwatches([
  "#ed0f0f",
  "#df630a",
  "#facc15",
  "#22c55e",
  "#0ea4e9",
  "#0a19e8",
  "#6e70f1",
  "#a22463"
]);

const HEX6_REGEX = /^#([0-9a-f]{6})$/i;
const HEX8_REGEX = /^#([0-9a-f]{8})$/i;

const normalizeSwatch = (value: string): string => {
  if (typeof value !== "string") {
    throw new OutlineError("Color swatch must be a string.");
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new OutlineError("Color swatch cannot be empty.");
  }
  return trimmed;
};

const normalizeSwatchList = (swatches: ReadonlyArray<string>): string[] => {
  const normalized = swatches.map(normalizeSwatch);
  if (normalized.length === 0) {
    throw new OutlineError("Color palette must contain at least one swatch.");
  }
  return normalized;
};

const clamp = (value: number, min: number, max: number): number => {
  if (Number.isNaN(value)) {
    return min;
  }
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
};

const normalizeHexColor = (value: string): string => {
  const normalized = value.trim().toLowerCase();
  if (HEX6_REGEX.test(normalized)) {
    return normalized;
  }
  if (HEX8_REGEX.test(normalized)) {
    return `#${normalized.slice(1, 7)}`;
  }
  if (normalized.startsWith("#") && normalized.length === 4) {
    const r = normalized[1];
    const g = normalized[2];
    const b = normalized[3];
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return "#000000";
};

const appendAlphaChannel = (hex: string, alpha: number): string => {
  const normalized = normalizeHexColor(hex);
  const alphaByte = clamp(Math.round(alpha * 255), 0, 255);
  const alphaHex = alphaByte.toString(16).padStart(2, "0");
  return `${normalized}${alphaHex}`;
};

export const DEFAULT_BACKGROUND_COLOR_SWATCHES: ReadonlyArray<string> = freezeSwatches(
  DEFAULT_TEXT_COLOR_SWATCHES.map((swatch) => appendAlphaChannel(swatch, 0.7))
);

// Maintain the legacy name for consumers that still import the shared default swatches.
export const DEFAULT_COLOR_SWATCHES = DEFAULT_TEXT_COLOR_SWATCHES;

const readSwatchArray = (value: unknown): string[] | null => {
  if (!(value instanceof Y.Array)) {
    return null;
  }
  return value
    .toArray()
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => entry.trim());
};

const getDefaultSwatchesForMode = (mode: ColorPaletteMode): ReadonlyArray<string> =>
  mode === "text" ? DEFAULT_TEXT_COLOR_SWATCHES : DEFAULT_BACKGROUND_COLOR_SWATCHES;

const ensurePaletteRecord = (outline: OutlineDoc): ColorPaletteRecord => {
  const existing = outline.userPreferences.get(COLOR_PALETTE_RECORD_KEY);
  if (existing instanceof Y.Map) {
    return existing as ColorPaletteRecord;
  }
  const record = new Y.Map<unknown>();
  outline.userPreferences.set(COLOR_PALETTE_RECORD_KEY, record);
  return record as ColorPaletteRecord;
};

const ensureSwatchListForMode = (record: ColorPaletteRecord, mode: ColorPaletteMode): SwatchList => {
  const key =
    mode === "text"
      ? COLOR_PALETTE_TEXT_SWATCHES_KEY
      : COLOR_PALETTE_BACKGROUND_SWATCHES_KEY;
  const existing = record.get(key);
  if (existing instanceof Y.Array) {
    return existing as SwatchList;
  }
  const list = new Y.Array<string>();
  record.set(key, list);
  return list;
};

const snapshotPalette = (record: ColorPaletteRecord): ColorPaletteSnapshot => {
  const versionValue = record.get(COLOR_PALETTE_VERSION_KEY);
  const version =
    typeof versionValue === "number" && Number.isFinite(versionValue)
      ? (versionValue as number)
      : COLOR_PALETTE_SCHEMA_VERSION;

  const updatedAtValue = record.get(COLOR_PALETTE_UPDATED_AT_KEY);
  const updatedAt =
    typeof updatedAtValue === "number" && Number.isFinite(updatedAtValue)
      ? (updatedAtValue as number)
      : 0;

  const textSwatches =
    readSwatchArray(record.get(COLOR_PALETTE_TEXT_SWATCHES_KEY)) ??
    [...DEFAULT_TEXT_COLOR_SWATCHES];

  const backgroundSwatches =
    readSwatchArray(record.get(COLOR_PALETTE_BACKGROUND_SWATCHES_KEY)) ??
    [...DEFAULT_BACKGROUND_COLOR_SWATCHES];

  const normalizedText =
    textSwatches.length > 0 ? textSwatches : [...DEFAULT_TEXT_COLOR_SWATCHES];

  const normalizedBackground =
    backgroundSwatches.length > 0
      ? backgroundSwatches
      : normalizedText.length > 0
      ? normalizedText
      : [...DEFAULT_BACKGROUND_COLOR_SWATCHES];

  return {
    textSwatches: freezeSwatches(normalizedText),
    backgroundSwatches: freezeSwatches(normalizedBackground),
    updatedAt,
    version
  };
};

const resolveTimestamp = (options?: PaletteMutationOptions): number => {
  const rawTimestamp = options?.timestamp ?? Date.now();
  if (typeof rawTimestamp !== "number" || !Number.isFinite(rawTimestamp)) {
    throw new OutlineError(`Invalid palette timestamp "${String(rawTimestamp)}".`);
  }
  return rawTimestamp;
};

const touchPaletteMetadata = (record: ColorPaletteRecord, timestamp: number): void => {
  record.set(COLOR_PALETTE_UPDATED_AT_KEY, timestamp);
  record.set(COLOR_PALETTE_VERSION_KEY, COLOR_PALETTE_SCHEMA_VERSION);
};

const resolveInsertIndex = (swatches: SwatchList, index: number | undefined): number => {
  const length = swatches.length;
  if (index === undefined) {
    return length;
  }
  if (!Number.isInteger(index)) {
    throw new OutlineError(`Palette index must be an integer, received "${String(index)}".`);
  }
  if (index < 0 || index > length) {
    throw new OutlineError(`Palette index ${index} is out of bounds for length ${length}.`);
  }
  return index;
};

const resolveExistingIndex = (swatches: SwatchList, index: number): number => {
  if (!Number.isInteger(index)) {
    throw new OutlineError(`Palette index must be an integer, received "${String(index)}".`);
  }
  const length = swatches.length;
  if (index < 0 || index >= length) {
    throw new OutlineError(`Palette index ${index} is out of bounds for length ${length}.`);
  }
  return index;
};

const ensurePaletteInitialized = (outline: OutlineDoc): ColorPaletteRecord => {
  const record = ensurePaletteRecord(outline);
  const versionValue = record.get(COLOR_PALETTE_VERSION_KEY);
  const existingVersion =
    typeof versionValue === "number" && Number.isFinite(versionValue)
      ? (versionValue as number)
      : 0;

  const legacySwatches = readSwatchArray(record.get(LEGACY_COLOR_PALETTE_SWATCHES_KEY));

  const textList = ensureSwatchListForMode(record, "text");
  if (textList.length === 0) {
    const seed =
      legacySwatches && legacySwatches.length > 0
        ? legacySwatches
        : [...DEFAULT_TEXT_COLOR_SWATCHES];
    textList.push([...seed]);
  }

  const backgroundList = ensureSwatchListForMode(record, "background");
  if (backgroundList.length === 0) {
    const seed =
      existingVersion < COLOR_PALETTE_SCHEMA_VERSION && legacySwatches && legacySwatches.length > 0
        ? legacySwatches
        : [...DEFAULT_BACKGROUND_COLOR_SWATCHES];
    backgroundList.push([...seed]);
  }

  if (record.has(LEGACY_COLOR_PALETTE_SWATCHES_KEY)) {
    record.delete(LEGACY_COLOR_PALETTE_SWATCHES_KEY);
  }

  if (existingVersion !== COLOR_PALETTE_SCHEMA_VERSION) {
    record.set(COLOR_PALETTE_VERSION_KEY, COLOR_PALETTE_SCHEMA_VERSION);
  }

  if (typeof record.get(COLOR_PALETTE_UPDATED_AT_KEY) !== "number") {
    record.set(COLOR_PALETTE_UPDATED_AT_KEY, Date.now());
  }
  return record;
};

const mutatePalette = (
  outline: OutlineDoc,
  options: PaletteMutationOptions | undefined,
  mode: ColorPaletteMode,
  mutator: (record: ColorPaletteRecord, swatches: SwatchList) => void,
  seedDefaults: boolean
): ColorPaletteSnapshot => {
  const timestamp = resolveTimestamp(options);
  let snapshot: ColorPaletteSnapshot | null = null;
  withTransaction(
    outline,
    () => {
      const record = ensurePaletteInitialized(outline);
      const swatches = ensureSwatchListForMode(record, mode);
      if (seedDefaults && swatches.length === 0) {
        swatches.push([...getDefaultSwatchesForMode(mode)]);
      }
      mutator(record, swatches);
      touchPaletteMetadata(record, timestamp);
      snapshot = snapshotPalette(record);
    },
    options?.origin
  );
  if (!snapshot) {
    throw new OutlineError("Failed to mutate the color palette.");
  }
  return snapshot;
};

export const getColorPalette = (outline: OutlineDoc): ColorPaletteSnapshot => {
  let snapshot: ColorPaletteSnapshot | null = null;
  withTransaction(outline, () => {
    const ensured = ensurePaletteInitialized(outline);
    snapshot = snapshotPalette(ensured);
  });
  if (!snapshot) {
    throw new OutlineError("Failed to read the color palette.");
  }
  return snapshot;
};

export const replaceColorPalette = (
  outline: OutlineDoc,
  mode: ColorPaletteMode,
  swatches: ReadonlyArray<string>,
  options?: ReplaceColorPaletteOptions
): ColorPaletteSnapshot => {
  const normalized = normalizeSwatchList(swatches);
  return mutatePalette(
    outline,
    options,
    mode,
    (_record, list) => {
      if (list.length > 0) {
        list.delete(0, list.length);
      }
      list.push([...normalized]);
    },
    false
  );
};

export const resetColorPalette = (
  outline: OutlineDoc,
  options?: ResetColorPaletteOptions
): ColorPaletteSnapshot => {
  const timestamp = resolveTimestamp(options);
  let snapshot: ColorPaletteSnapshot | null = null;
  withTransaction(
    outline,
    () => {
      const record = ensurePaletteInitialized(outline);
      const textList = ensureSwatchListForMode(record, "text");
      if (textList.length > 0) {
        textList.delete(0, textList.length);
      }
      textList.push([...DEFAULT_TEXT_COLOR_SWATCHES]);

      const backgroundList = ensureSwatchListForMode(record, "background");
      if (backgroundList.length > 0) {
        backgroundList.delete(0, backgroundList.length);
      }
      backgroundList.push([...DEFAULT_BACKGROUND_COLOR_SWATCHES]);

      touchPaletteMetadata(record, timestamp);
      snapshot = snapshotPalette(record);
    },
    options?.origin
  );
  if (!snapshot) {
    throw new OutlineError("Failed to reset the color palette.");
  }
  return snapshot;
};

export const addColorPaletteSwatch = (
  outline: OutlineDoc,
  mode: ColorPaletteMode,
  swatch: string,
  options?: AddColorPaletteSwatchOptions
): ColorPaletteSnapshot => {
  const normalized = normalizeSwatch(swatch);
  return mutatePalette(
    outline,
    options,
    mode,
    (_record, list) => {
      const index = resolveInsertIndex(list, options?.index);
      list.insert(index, [normalized]);
    },
    true
  );
};

export const updateColorPaletteSwatch = (
  outline: OutlineDoc,
  mode: ColorPaletteMode,
  index: number,
  swatch: string,
  options?: UpdateColorPaletteSwatchOptions
): ColorPaletteSnapshot => {
  const normalized = normalizeSwatch(swatch);
  return mutatePalette(
    outline,
    options,
    mode,
    (_record, list) => {
      const targetIndex = resolveExistingIndex(list, index);
      list.delete(targetIndex, 1);
      list.insert(targetIndex, [normalized]);
    },
    true
  );
};

export const removeColorPaletteSwatch = (
  outline: OutlineDoc,
  mode: ColorPaletteMode,
  index: number,
  options?: RemoveColorPaletteSwatchOptions
): ColorPaletteSnapshot => {
  return mutatePalette(
    outline,
    options,
    mode,
    (_record, list) => {
      if (list.length <= 1) {
        throw new OutlineError("Color palette must retain at least one swatch.");
      }
      const targetIndex = resolveExistingIndex(list, index);
      list.delete(targetIndex, 1);
    },
    true
  );
};
