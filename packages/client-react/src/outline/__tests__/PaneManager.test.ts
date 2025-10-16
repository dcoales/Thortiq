import { describe, expect, it } from "vitest";

import type { PaneRuntimeState } from "@thortiq/client-core";

import { __private__computePaneSizes } from "../PaneManager";

const createRuntime = (paneId: string, widthRatio: number | null): PaneRuntimeState => ({
  paneId,
  scrollTop: 0,
  widthRatio,
  lastFocusedEdgeId: null,
  virtualizerVersion: 0
});

const getWidth = (map: Map<string, { readonly width: number }>, paneId: string): number =>
  map.get(paneId)?.width ?? 0;

describe("PaneManager sizing", () => {
  it("distributes widths evenly when no runtime state exists", () => {
    const paneIds = ["pane-a", "pane-b", "pane-c"] as const;
    const gapSize = 12;
    const sizes = __private__computePaneSizes(paneIds, 900, new Map(), 320, null, gapSize);
    expect(getWidth(sizes, "pane-a")).toBeCloseTo(292, 4);
    expect(getWidth(sizes, "pane-b")).toBeCloseTo(292, 4);
    expect(getWidth(sizes, "pane-c")).toBeCloseTo(292, 4);
  });

  it("honours stored width ratios and normalises them", () => {
    const paneIds = ["pane-a", "pane-b"] as const;
    const runtime = new Map<string, PaneRuntimeState | null>([
      ["pane-a", createRuntime("pane-a", 0.25)],
      ["pane-b", createRuntime("pane-b", 0.75)]
    ]);
    const gapSize = 12;
    const sizes = __private__computePaneSizes(paneIds, 800, runtime, 320, null, gapSize);
    // Left pane respects its ratio until the minimum width threshold applies.
    expect(getWidth(sizes, "pane-a")).toBeCloseTo(320, 3);
    expect(getWidth(sizes, "pane-b")).toBeCloseTo(480, 3);
  });

  it("enforces the minimum pane width when ratios would collapse a pane", () => {
    const paneIds = ["left", "right"] as const;
    const runtime = new Map<string, PaneRuntimeState | null>([
      ["left", createRuntime("left", 0.05)],
      ["right", createRuntime("right", 0.95)]
    ]);
    const gapSize = 12;
    const sizes = __private__computePaneSizes(paneIds, 1200, runtime, 320, null, gapSize);
    expect(getWidth(sizes, "left")).toBe(320);
    expect(getWidth(sizes, "right")).toBeCloseTo(880, 3);
  });

  it("respects draft overrides computed during a drag interaction", () => {
    const paneIds = ["left", "right"] as const;
    const runtime = new Map<string, PaneRuntimeState | null>([
      ["left", createRuntime("left", 0.5)],
      ["right", createRuntime("right", 0.5)]
    ]);
    const draftOverrides = new Map([
      [
        "left",
        {
          width: 640,
          ratio: 0.64
        }
      ],
      [
        "right",
        {
          width: 360,
          ratio: 0.36
        }
      ]
    ]);
    const gapSize = 12;
    const sizes = __private__computePaneSizes(paneIds, 1000, runtime, 320, draftOverrides, gapSize);
    expect(getWidth(sizes, "left")).toBeCloseTo(640, 3);
    expect(getWidth(sizes, "right")).toBeCloseTo(360, 3);
  });
});
