import { describe, expect, it, vi } from "vitest";

import { createOutlineDoc } from "./transactions";
import {
  getTagRegistryEntry,
  removeTagRegistryEntry,
  selectTagsByCreatedAt,
  touchTagRegistryEntry,
  upsertTagRegistryEntry
} from "./tags";

describe("tag registry helpers", () => {
  it("creates entries with normalized identifiers and timestamps", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));

      const outline = createOutlineDoc();
      const entry = upsertTagRegistryEntry(outline, { label: "  Product Launch  ", trigger: "#" });

      expect(entry.id).toBe("product launch");
      expect(entry.label).toBe("Product Launch");
      expect(entry.trigger).toBe("#");
      expect(entry.createdAt).toBeGreaterThan(0);
      expect(entry.lastUsedAt).toBe(entry.createdAt);

      const lookup = getTagRegistryEntry(outline, "PRODUCT   LAUNCH");
      expect(lookup).toEqual(entry);
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves creation time on idempotent updates", () => {
    const outline = createOutlineDoc();
    const first = upsertTagRegistryEntry(outline, {
      label: "Research",
      trigger: "@",
      createdAt: 1_000
    });

    const second = upsertTagRegistryEntry(outline, {
      label: " research ",
      trigger: "@",
      lastUsedAt: 5_000
    });

    expect(second.id).toBe(first.id);
    expect(second.createdAt).toBe(1_000);
    expect(second.lastUsedAt).toBe(5_000);
  });

  it("updates last used timestamp when touched with a newer value", () => {
    const outline = createOutlineDoc();
    upsertTagRegistryEntry(outline, {
      label: "Backlog",
      trigger: "#",
      createdAt: 10,
      lastUsedAt: 20
    });

    const touched = touchTagRegistryEntry(outline, "backlog", { timestamp: 40 });
    expect(touched).not.toBeNull();
    expect(touched?.lastUsedAt).toBe(40);

    const untouched = touchTagRegistryEntry(outline, "backlog", { timestamp: 10 });
    expect(untouched?.lastUsedAt).toBe(40);
  });

  it("sorts tags by creation time and memoizes the result", () => {
    const outline = createOutlineDoc();
    upsertTagRegistryEntry(outline, { label: "Alpha", trigger: "#", createdAt: 100 });
    upsertTagRegistryEntry(outline, { label: "Beta", trigger: "#", createdAt: 200 });

    const first = selectTagsByCreatedAt(outline);
    expect(first.map((entry) => entry.id)).toEqual(["beta", "alpha"]);

    const second = selectTagsByCreatedAt(outline);
    expect(second).toBe(first);

    touchTagRegistryEntry(outline, "alpha", { timestamp: 500 });
    const third = selectTagsByCreatedAt(outline);
    expect(third).not.toBe(first);
    expect(third.map((entry) => entry.id)).toEqual(["beta", "alpha"]);
  });

  it("removes entries and reports status", () => {
    const outline = createOutlineDoc();
    upsertTagRegistryEntry(outline, { label: "Cleanup", trigger: "#", createdAt: 1 });

    const removed = removeTagRegistryEntry(outline, "cleanup");
    expect(removed).toBe(true);

    const missing = removeTagRegistryEntry(outline, "cleanup");
    expect(missing).toBe(false);
    expect(selectTagsByCreatedAt(outline)).toHaveLength(0);
  });
});
