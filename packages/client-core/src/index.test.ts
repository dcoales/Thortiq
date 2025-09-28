import { describe, expect, it } from "vitest";
import { createNodeId, isSameNode } from "./index";

describe("client-core identifiers", () => {
  it("creates unique node ids", () => {
    const first = createNodeId();
    const second = createNodeId();

    expect(first).not.toEqual(second);
  });

  it("compares node identifiers correctly", () => {
    const id = createNodeId();

    expect(isSameNode(id, id)).toBe(true);
  });
});
