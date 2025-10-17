import { describe, expect, it } from "vitest";

import { formatTagFilter, toggleTagFilterInQuery } from "../tagFilters";

describe("tag filter helpers", () => {
  it("formats simple labels without quotes", () => {
    expect(formatTagFilter("alpha")).toBe("tag:alpha");
  });

  it("wraps labels with spaces in quotes", () => {
    expect(formatTagFilter("alpha beta")).toBe('tag:"alpha beta"');
  });

  it("escapes embedded quotes", () => {
    expect(formatTagFilter('alpha "beta"')).toBe('tag:"alpha \\"beta\\""');
  });

  it("appends missing filters to queries", () => {
    const result = toggleTagFilterInQuery("text:alpha", "beta");
    expect(result).toEqual({
      query: "text:alpha tag:beta",
      removed: false
    });
  });

  it("removes existing filters when toggled", () => {
    const result = toggleTagFilterInQuery("tag:beta text:alpha", "beta");
    expect(result).toEqual({
      query: "text:alpha",
      removed: true
    });
  });

  it("returns empty query when last filter is removed", () => {
    const result = toggleTagFilterInQuery("tag:beta", "beta");
    expect(result).toEqual({
      query: "",
      removed: true
    });
  });
});
