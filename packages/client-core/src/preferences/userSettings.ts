import * as Y from "yjs";

import { withTransaction } from "../doc";
import type { OutlineDoc } from "../types";

type PrimitivePreference = string | number | boolean | null;
export type UserSettingValue = PrimitivePreference | Readonly<Record<string, unknown>>;

const USER_SETTING_PREFIX = "setting.";

interface SettingSnapshot {
  readonly value: UserSettingValue;
  readonly updatedAt: number;
}

const encodeKey = (key: string): string => `${USER_SETTING_PREFIX}${key}`;

const encodeValue = (value: UserSettingValue): string => JSON.stringify(value ?? null);

const decodeValue = (stored: unknown): UserSettingValue => {
  if (typeof stored !== "string") {
    return null;
  }
  try {
    const parsed = JSON.parse(stored);
    if (parsed === null) {
      return null;
    }
    if (typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Readonly<Record<string, unknown>>;
    }
    if (Array.isArray(parsed)) {
      return parsed as unknown as UserSettingValue;
    }
    return parsed as PrimitivePreference;
  } catch (_error) {
    return null;
  }
};

const readSettingSnapshot = (record: unknown): SettingSnapshot | null => {
  if (!(record instanceof Y.Map)) {
    return null;
  }
  const storedValue = record.get("value");
  const updatedAt = record.get("updatedAt");
  if (typeof updatedAt !== "number") {
    return null;
  }
  return {
    value: decodeValue(storedValue),
    updatedAt
  };
};

const ensureSettingRecord = (outline: OutlineDoc, key: string): Y.Map<unknown> => {
  const existing = outline.userPreferences.get(key);
  if (existing instanceof Y.Map) {
    return existing as Y.Map<unknown>;
  }
  const record = new Y.Map<unknown>();
  outline.userPreferences.set(key, record);
  return record;
};

export const getUserSetting = (outline: OutlineDoc, key: string): UserSettingValue | null => {
  const record = outline.userPreferences.get(encodeKey(key));
  const snapshot = readSettingSnapshot(record);
  return snapshot?.value ?? null;
};

export const getUserSettingSnapshot = (outline: OutlineDoc, key: string): SettingSnapshot | null => {
  const record = outline.userPreferences.get(encodeKey(key));
  return readSettingSnapshot(record);
};

export const setUserSetting = (
  outline: OutlineDoc,
  key: string,
  value: UserSettingValue,
  origin?: unknown
): void => {
  const storageKey = encodeKey(key);
  withTransaction(
    outline,
    () => {
      const record = ensureSettingRecord(outline, storageKey);
      record.set("value", encodeValue(value));
      record.set("updatedAt", Date.now());
    },
    origin
  );
};

export const deleteUserSetting = (outline: OutlineDoc, key: string, origin?: unknown): void => {
  const storageKey = encodeKey(key);
  if (!outline.userPreferences.has(storageKey)) {
    return;
  }
  withTransaction(
    outline,
    () => {
      outline.userPreferences.delete(storageKey);
    },
    origin
  );
};
