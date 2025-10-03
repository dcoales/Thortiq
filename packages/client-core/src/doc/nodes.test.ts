import { describe, expect, it, vi } from "vitest";

import { createOutlineDoc } from "./transactions";
import {
  createNode,
  getNodeMetadata,
  getNodeSnapshot,
  getNodeText,
  getNodeTextFragment,
  nodeExists,
  setNodeText,
  updateNodeMetadata,
  updateTodoDoneStates
} from "./nodes";

const advanceClock = (iso: string) => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(iso));
};

describe("nodes module", () => {
  it("creates nodes with default metadata and text", () => {
    advanceClock("2024-01-01T00:00:00Z");
    const outline = createOutlineDoc();
    const nodeId = createNode(outline, { text: "hello" });

    expect(nodeExists(outline, nodeId)).toBe(true);
    expect(getNodeText(outline, nodeId)).toBe("hello");

    const metadata = getNodeMetadata(outline, nodeId);
    expect(metadata.tags).toEqual([]);
    expect(metadata.createdAt).toBeGreaterThan(0);
    expect(metadata.updatedAt).toBe(metadata.createdAt);

    vi.useRealTimers();
  });

  it("updates node text while keeping the xml fragment hydrated", () => {
    const outline = createOutlineDoc();
    const nodeId = createNode(outline, { text: "initial" });

    const fragment = getNodeTextFragment(outline, nodeId);
    expect(fragment.length).toBeGreaterThan(0);

    setNodeText(outline, nodeId, "updated");
    expect(getNodeText(outline, nodeId)).toBe("updated");
  });

  it("merges metadata patches and clears nullable fields", () => {
    const outline = createOutlineDoc();
    const nodeId = createNode(outline, { metadata: { tags: ["initial"], color: "#abc" } });

    updateNodeMetadata(outline, nodeId, { tags: ["updated"], color: "#def" });

    let metadata = getNodeMetadata(outline, nodeId);
    expect(metadata.tags).toEqual(["updated"]);
    expect(metadata.color).toBe("#def");

    updateNodeMetadata(outline, nodeId, { color: undefined });
    metadata = getNodeMetadata(outline, nodeId);
    expect(metadata.color).toBeUndefined();
  });

  it("updates todo done states in batch", () => {
    const outline = createOutlineDoc();
    const nodeA = createNode(outline, { metadata: { todo: { done: false } } });
    const nodeB = createNode(outline, { metadata: { todo: { done: false } } });

    updateTodoDoneStates(
      outline,
      [
        { nodeId: nodeA, done: true },
        { nodeId: nodeB, done: true }
      ]
    );

    expect(getNodeMetadata(outline, nodeA).todo?.done).toBe(true);
    expect(getNodeMetadata(outline, nodeB).todo?.done).toBe(true);
  });

  it("reads node snapshots as plain data", () => {
    const outline = createOutlineDoc();
    const nodeId = createNode(outline, { text: "snapshot" });

    const snapshot = getNodeSnapshot(outline, nodeId);
    expect(snapshot.id).toBe(nodeId);
    expect(snapshot.text).toBe("snapshot");
  });
});
