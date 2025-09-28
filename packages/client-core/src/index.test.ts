import { describe, expect, it } from "vitest";

import { createEdgeId, createNodeId, isSameNode } from "./ids";

describe("identifier utilities", () => {
  it("creates unique node ids", () => {
    const a = createNodeId();
    const b = createNodeId();

    expect(a).not.toEqual(b);
  });

  it("creates unique edge ids", () => {
    const a = createEdgeId();
    const b = createEdgeId();

    expect(a).not.toEqual(b);
  });

  it("compares node identifiers explicitly", () => {
    const id = createNodeId();

    expect(isSameNode(id, id)).toBe(true);
  });
});
