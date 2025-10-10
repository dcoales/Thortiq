/**
 * Shared color palette preferences stored inside the collaborative Y.Doc. These helpers expose a
 * transactional API for reading and mutating swatches so platform adapters can provide consistent
 * UX while respecting AGENTS stability rules (single undo history, no direct Yjs mutations).
 */
import * as Y from "yjs";

import { OutlineError, withTransaction } from "../doc/transactions";
import type { OutlineDoc } from "../types";

const COLOR_PALETTE_RECORD_KEY = "colorPalette";
const COLOR_PALETTE_SWATCHES_KEY = "swatches";
const COLOR_PALETTE_UPDATED_AT_KEY = "updatedAt";
const COLOR_PALETTE_VERSION_KEY = "version";

const COLOR_PALETTE_SCHEMA_VERSION = 1;

type ColorPaletteRecord = Y.Map<unknown>;
type SwatchList = Y.Array<string>;

export interface ColorPaletteSnapshot {
  readonly swatches: ReadonlyArray<string>;
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

export const DEFAULT_COLOR_SWATCHES: ReadonlyArray<string> = freezeSwatches([
  "#ed0f0f",
  "#df630a",
  "#facc15",
  "#22c55e",
  "#0ea4e9",
  "#0a19e8",
  "#6e70f1",
  "#a22463"
]);

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

const ensurePaletteRecord = (outline: OutlineDoc): ColorPaletteRecord => {
  const existing = outline.userPreferences.get(COLOR_PALETTE_RECORD_KEY);
  if (existing instanceof Y.Map) {
    return existing as ColorPaletteRecord;
  }
  const record = new Y.Map<unknown>();
  outline.userPreferences.set(COLOR_PALETTE_RECORD_KEY, record);
  return record as ColorPaletteRecord;
};

const ensureSwatchList = (record: ColorPaletteRecord): SwatchList => {
  const existing = record.get(COLOR_PALETTE_SWATCHES_KEY);
  if (existing instanceof Y.Array) {
    return existing as SwatchList;
  }
  const swatches = new Y.Array<string>();
  record.set(COLOR_PALETTE_SWATCHES_KEY, swatches);
  return swatches;
};

const snapshotPalette = (record: ColorPaletteRecord): ColorPaletteSnapshot => {
  const rawSwatches = record.get(COLOR_PALETTE_SWATCHES_KEY);
  const swatches =
    rawSwatches instanceof Y.Array
      ? rawSwatches
          .toArray()
          .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
          .map((value) => value.trim())
      : [...DEFAULT_COLOR_SWATCHES];
  const normalizedSwatches =
    swatches.length > 0 ? swatches : [...DEFAULT_COLOR_SWATCHES];

  const updatedAtValue = record.get(COLOR_PALETTE_UPDATED_AT_KEY);
  const updatedAt =
    typeof updatedAtValue === "number" && Number.isFinite(updatedAtValue) ? updatedAtValue : 0;

  const versionValue = record.get(COLOR_PALETTE_VERSION_KEY);
  const version =
    typeof versionValue === "number" && Number.isFinite(versionValue)
      ? versionValue
      : COLOR_PALETTE_SCHEMA_VERSION;

  return {
    swatches: freezeSwatches(normalizedSwatches),
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
  const swatches = ensureSwatchList(record);
  if (swatches.length === 0) {
    swatches.push([...DEFAULT_COLOR_SWATCHES]);
  }
  if (typeof record.get(COLOR_PALETTE_VERSION_KEY) !== "number") {
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
  mutator: (record: ColorPaletteRecord, swatches: SwatchList) => void,
  seedDefaults: boolean
): ColorPaletteSnapshot => {
  const timestamp = resolveTimestamp(options);
  let snapshot: ColorPaletteSnapshot | null = null;
  withTransaction(
    outline,
    () => {
      const record = ensurePaletteRecord(outline);
      const swatches = ensureSwatchList(record);
      if (seedDefaults && swatches.length === 0) {
        swatches.push([...DEFAULT_COLOR_SWATCHES]);
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
  const record = outline.userPreferences.get(COLOR_PALETTE_RECORD_KEY);
  if (record instanceof Y.Map) {
    const snapshot = snapshotPalette(record as ColorPaletteRecord);
    if (snapshot.swatches.length > 0) {
      return snapshot;
    }
  }
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
  swatches: ReadonlyArray<string>,
  options?: ReplaceColorPaletteOptions
): ColorPaletteSnapshot => {
  const normalized = normalizeSwatchList(swatches);
  return mutatePalette(
    outline,
    options,
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
  return mutatePalette(
    outline,
    options,
    (_record, list) => {
      if (list.length > 0) {
        list.delete(0, list.length);
      }
      list.push([...DEFAULT_COLOR_SWATCHES]);
    },
    false
  );
};

export const addColorPaletteSwatch = (
  outline: OutlineDoc,
  swatch: string,
  options?: AddColorPaletteSwatchOptions
): ColorPaletteSnapshot => {
  const normalized = normalizeSwatch(swatch);
  return mutatePalette(
    outline,
    options,
    (_record, list) => {
      const index = resolveInsertIndex(list, options?.index);
      list.insert(index, [normalized]);
    },
    true
  );
};

export const updateColorPaletteSwatch = (
  outline: OutlineDoc,
  index: number,
  swatch: string,
  options?: UpdateColorPaletteSwatchOptions
): ColorPaletteSnapshot => {
  const normalized = normalizeSwatch(swatch);
  return mutatePalette(
    outline,
    options,
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
  index: number,
  options?: RemoveColorPaletteSwatchOptions
): ColorPaletteSnapshot => {
  return mutatePalette(
    outline,
    options,
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
