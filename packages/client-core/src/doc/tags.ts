/**
 * Tag registry utilities wrapping the shared Yjs map that stores normalized tag metadata.
 * The registry keeps display labels, trigger characters, and usage timestamps in sync with
 * the outline document while respecting transactional mutation rules (AGENTS §3).
 */
import * as Y from "yjs";

import type {
  OutlineDoc,
  TagRegistryEntry,
  TagRegistryRecord,
  TagRegistryStore,
  TagTrigger
} from "../types";
import { OutlineError, withTransaction } from "./transactions";

const TAG_REGISTRY_META_KEY = "__meta__";
const TAG_REGISTRY_VERSION_KEY = "version";
const TAG_REGISTRY_LABEL_KEY = "label";
const TAG_REGISTRY_TRIGGER_KEY = "trigger";
const TAG_REGISTRY_CREATED_AT_KEY = "createdAt";
const TAG_REGISTRY_LAST_USED_AT_KEY = "lastUsedAt";

interface TagRegistryCacheEntry {
  readonly version: number;
  readonly tags: ReadonlyArray<TagRegistryEntry>;
}

const sortedTagCache = new WeakMap<OutlineDoc, TagRegistryCacheEntry>();

const isTagTrigger = (value: unknown): value is TagTrigger => value === "#" || value === "@";

const normalizeWhitespace = (label: string): string => label.trim().replace(/\s+/gu, " ");

export const normalizeTagId = (label: string): string => normalizeWhitespace(label).toLowerCase();

const isReservedId = (id: string): boolean => id === TAG_REGISTRY_META_KEY;

const ensureMetaRecord = (registry: TagRegistryStore): TagRegistryRecord => {
  const existing = registry.get(TAG_REGISTRY_META_KEY);
  if (existing instanceof Y.Map) {
    return existing;
  }
  const meta = new Y.Map<unknown>();
  registry.set(TAG_REGISTRY_META_KEY, meta);
  return meta;
};

const bumpRegistryVersion = (registry: TagRegistryStore): number => {
  const meta = ensureMetaRecord(registry);
  const current = meta.get(TAG_REGISTRY_VERSION_KEY);
  const nextVersion = typeof current === "number" ? current + 1 : 1;
  meta.set(TAG_REGISTRY_VERSION_KEY, nextVersion);
  return nextVersion;
};

const readRegistryVersion = (registry: TagRegistryStore): number => {
  const meta = registry.get(TAG_REGISTRY_META_KEY);
  if (!(meta instanceof Y.Map)) {
    return 0;
  }
  const version = meta.get(TAG_REGISTRY_VERSION_KEY);
  return typeof version === "number" ? version : 0;
};

const toTagRegistryEntry = (id: string, record: TagRegistryRecord): TagRegistryEntry | null => {
  const labelValue = record.get(TAG_REGISTRY_LABEL_KEY);
  const triggerValue = record.get(TAG_REGISTRY_TRIGGER_KEY);
  const createdAtValue = record.get(TAG_REGISTRY_CREATED_AT_KEY);
  const lastUsedAtValue = record.get(TAG_REGISTRY_LAST_USED_AT_KEY);

  if (typeof labelValue !== "string") {
    return null;
  }
  if (!isTagTrigger(triggerValue)) {
    return null;
  }
  if (typeof createdAtValue !== "number") {
    return null;
  }

  const lastUsedAt =
    typeof lastUsedAtValue === "number" ? Math.max(lastUsedAtValue, createdAtValue) : createdAtValue;

  return {
    id,
    label: labelValue,
    trigger: triggerValue,
    createdAt: createdAtValue,
    lastUsedAt
  };
};

const ensureTagRecord = (registry: TagRegistryStore, id: string): TagRegistryRecord => {
  const existing = registry.get(id);
  if (existing instanceof Y.Map) {
    return existing;
  }
  const record = new Y.Map<unknown>();
  registry.set(id, record);
  return record;
};

const invalidateTagCache = (outline: OutlineDoc): void => {
  sortedTagCache.delete(outline);
};

const freezeEntry = (entry: TagRegistryEntry | null): TagRegistryEntry | null => {
  if (!entry) {
    return null;
  }
  return Object.freeze({ ...entry });
};

const touchRegistryRecord = (
  outline: OutlineDoc,
  id: string,
  record: TagRegistryRecord,
  timestamp: number
): TagRegistryEntry | null => {
  const createdAtValue = record.get(TAG_REGISTRY_CREATED_AT_KEY);
  if (typeof createdAtValue !== "number") {
    outline.tagRegistry.delete(id);
    bumpRegistryVersion(outline.tagRegistry);
    invalidateTagCache(outline);
    return null;
  }

  const existingLastUsed = record.get(TAG_REGISTRY_LAST_USED_AT_KEY);
  const resolvedLastUsed =
    typeof existingLastUsed === "number" ? Math.max(existingLastUsed, createdAtValue) : createdAtValue;
  const nextLastUsed = Math.max(timestamp, resolvedLastUsed);
  if (nextLastUsed !== resolvedLastUsed) {
    record.set(TAG_REGISTRY_LAST_USED_AT_KEY, nextLastUsed);
    bumpRegistryVersion(outline.tagRegistry);
    invalidateTagCache(outline);
  }
  return freezeEntry(toTagRegistryEntry(id, record));
};

export interface UpsertTagRegistryEntryOptions {
  readonly label: string;
  readonly trigger: TagTrigger;
  readonly createdAt?: number;
  readonly lastUsedAt?: number;
}

export const upsertTagRegistryEntry = (
  outline: OutlineDoc,
  options: UpsertTagRegistryEntryOptions,
  origin?: unknown
): TagRegistryEntry => {
  const normalizedLabel = normalizeWhitespace(options.label);
  if (normalizedLabel.length === 0) {
    throw new OutlineError("Tag label must be a non-empty string.");
  }
  if (!isTagTrigger(options.trigger)) {
    throw new OutlineError(`Invalid tag trigger "${String(options.trigger)}".`);
  }
  if (
    options.createdAt !== undefined
    && (typeof options.createdAt !== "number" || !Number.isFinite(options.createdAt))
  ) {
    throw new OutlineError(`Invalid tag createdAt timestamp "${String(options.createdAt)}".`);
  }
  if (
    options.lastUsedAt !== undefined
    && (typeof options.lastUsedAt !== "number" || !Number.isFinite(options.lastUsedAt))
  ) {
    throw new OutlineError(`Invalid tag lastUsedAt timestamp "${String(options.lastUsedAt)}".`);
  }

  const id = normalizeTagId(normalizedLabel);
  if (isReservedId(id)) {
    throw new OutlineError(`Tag id "${id}" is reserved.`);
  }
  let snapshot: TagRegistryEntry | null = null;

  withTransaction(
    outline,
    () => {
      const registry = outline.tagRegistry;
      const record = ensureTagRecord(registry, id);

      const existingCreatedAtValue = record.get(TAG_REGISTRY_CREATED_AT_KEY);
      const existingCreatedAt =
        typeof existingCreatedAtValue === "number" ? existingCreatedAtValue : undefined;

      const createdAt = options.createdAt ?? existingCreatedAt ?? Date.now();
      const existingLastUsedValue = record.get(TAG_REGISTRY_LAST_USED_AT_KEY);
      const lastUsedCandidate =
        options.lastUsedAt ??
        (typeof existingLastUsedValue === "number" ? existingLastUsedValue : undefined);
      const lastUsedAt =
        typeof lastUsedCandidate === "number" ? Math.max(lastUsedCandidate, createdAt) : createdAt;

      record.set(TAG_REGISTRY_LABEL_KEY, normalizedLabel);
      record.set(TAG_REGISTRY_TRIGGER_KEY, options.trigger);
      record.set(TAG_REGISTRY_CREATED_AT_KEY, createdAt);
      record.set(TAG_REGISTRY_LAST_USED_AT_KEY, lastUsedAt);

      bumpRegistryVersion(registry);
      invalidateTagCache(outline);

      snapshot = freezeEntry(toTagRegistryEntry(id, record));
    },
    origin
  );

  if (!snapshot) {
    throw new OutlineError(`Failed to upsert tag "${id}".`);
  }

  return snapshot;
};

export interface TouchTagRegistryEntryOptions {
  readonly timestamp?: number;
}

export const touchTagRegistryEntry = (
  outline: OutlineDoc,
  id: string,
  options: TouchTagRegistryEntryOptions = {},
  origin?: unknown
): TagRegistryEntry | null => {
  const normalizedId = normalizeTagId(id);
  if (isReservedId(normalizedId)) {
    return null;
  }
  const timestamp = options.timestamp ?? Date.now();
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) {
    throw new OutlineError(`Invalid tag usage timestamp "${String(options.timestamp)}".`);
  }
  let snapshot: TagRegistryEntry | null = null;

  withTransaction(
    outline,
    () => {
      const record = outline.tagRegistry.get(normalizedId);
      if (!(record instanceof Y.Map)) {
        snapshot = null;
        return;
      }
      snapshot = touchRegistryRecord(outline, normalizedId, record, timestamp);
    },
    origin
  );

  return snapshot;
};

export const touchTagRegistryEntryInScope = (
  outline: OutlineDoc,
  id: string,
  options: TouchTagRegistryEntryOptions = {}
): TagRegistryEntry | null => {
  const normalizedId = normalizeTagId(id);
  if (isReservedId(normalizedId)) {
    return null;
  }
  const timestamp = options.timestamp ?? Date.now();
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) {
    throw new OutlineError(`Invalid tag usage timestamp "${String(options.timestamp)}".`);
  }
  const record = outline.tagRegistry.get(normalizedId);
  if (!(record instanceof Y.Map)) {
    return null;
  }
  return touchRegistryRecord(outline, normalizedId, record, timestamp);
};

export const removeTagRegistryEntry = (
  outline: OutlineDoc,
  id: string,
  origin?: unknown
): boolean => {
  const normalizedId = normalizeTagId(id);
  if (isReservedId(normalizedId)) {
    return false;
  }
  let removed = false;

  withTransaction(
    outline,
    () => {
      const registry = outline.tagRegistry;
      if (!registry.has(normalizedId)) {
        return;
      }
      registry.delete(normalizedId);
      bumpRegistryVersion(registry);
      invalidateTagCache(outline);
      removed = true;
    },
    origin
  );

  return removed;
};

export const getTagRegistryEntry = (outline: OutlineDoc, id: string): TagRegistryEntry | null => {
  const normalizedId = normalizeTagId(id);
  if (isReservedId(normalizedId)) {
    return null;
  }
  const record = outline.tagRegistry.get(normalizedId);
  if (!(record instanceof Y.Map)) {
    return null;
  }
  return freezeEntry(toTagRegistryEntry(normalizedId, record));
};

export const selectTagsByCreatedAt = (outline: OutlineDoc): ReadonlyArray<TagRegistryEntry> => {
  const version = readRegistryVersion(outline.tagRegistry);
  const cached = sortedTagCache.get(outline);
  if (cached && cached.version === version) {
    return cached.tags;
  }

  const entries: TagRegistryEntry[] = [];
  outline.tagRegistry.forEach((value, key) => {
    if (key === TAG_REGISTRY_META_KEY) {
      return;
    }
    if (!(value instanceof Y.Map) || typeof key !== "string") {
      return;
    }
    const entry = toTagRegistryEntry(key, value);
    const snapshot = freezeEntry(entry);
    if (snapshot) {
      entries.push(snapshot);
    }
  });

  entries.sort((left, right) => {
    if (left.createdAt === right.createdAt) {
      return left.id.localeCompare(right.id);
    }
    return right.createdAt - left.createdAt;
  });

  const snapshot = Object.freeze(entries.slice());
  sortedTagCache.set(outline, { version, tags: snapshot });
  return snapshot;
};
