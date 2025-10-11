import { describe, expect, it, vi } from "vitest";

import * as Y from "yjs";

import { createOutlineDoc, withTransaction } from "./transactions";
import {
  clearNodeFormatting,
  clearTodoMetadata,
  createNode,
  getNodeMetadata,
  getNodeSnapshot,
  getNodeText,
  getNodeTextFragment,
  nodeExists,
  setNodeHeadingLevel,
  setNodeLayout,
  setNodeText,
  setNodeColorMark,
  toggleNodeInlineMark,
  updateNodeMetadata,
  updateTodoDoneStates,
  updateWikiLinkDisplayText
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

  it("clears todo metadata across multiple nodes in a single transaction", () => {
    const outline = createOutlineDoc();
    const nodeA = createNode(outline, { metadata: { todo: { done: false } } });
    const nodeB = createNode(outline, {});

    clearTodoMetadata(outline, [nodeA, nodeB]);

    expect(getNodeMetadata(outline, nodeA).todo).toBeUndefined();
    expect(getNodeMetadata(outline, nodeB).todo).toBeUndefined();
  });

  it("reads node snapshots as plain data", () => {
    const outline = createOutlineDoc();
    const nodeId = createNode(outline, { text: "snapshot" });

    const snapshot = getNodeSnapshot(outline, nodeId);
    expect(snapshot.id).toBe(nodeId);
    expect(snapshot.text).toBe("snapshot");
  });

  it("updates wiki link display text while preserving mark metadata", () => {
    const outline = createOutlineDoc();
    const nodeId = createNode(outline);
    const fragment = getNodeTextFragment(outline, nodeId);

    withTransaction(outline, () => {
      fragment.delete(0, fragment.length);
      const paragraph = new Y.XmlElement("paragraph");
      const textNode = new Y.XmlText();
      textNode.insert(0, "Original", { wikilink: { nodeId: "target-node" } });
      paragraph.insert(0, [textNode]);
      fragment.insert(0, [paragraph]);
    });

    updateWikiLinkDisplayText(outline, nodeId, 0, "Updated");

    const snapshot = getNodeSnapshot(outline, nodeId);
    expect(snapshot.text).toBe("Updated");
    const [segment] = snapshot.inlineContent;
    expect(segment?.text).toBe("Updated");
    const mark = segment?.marks.find((candidate) => candidate.type === "wikilink");
    expect(mark?.attrs).toMatchObject({ nodeId: "target-node" });
  });

  it("clears node formatting including heading, layout, and inline marks", () => {
    const outline = createOutlineDoc();
    const nodeId = createNode(outline, { text: "Content" });

    const fragment = getNodeTextFragment(outline, nodeId);
    withTransaction(outline, () => {
      const paragraph = fragment.get(0) as Y.XmlElement | undefined;
      const textNode = paragraph?.get(0) as Y.XmlText | undefined;
      if (textNode) {
        textNode.format(0, textNode.length, { strong: {} });
      }
    });

    setNodeHeadingLevel(outline, [nodeId], 2);
    setNodeLayout(outline, [nodeId], "numbered");

    clearNodeFormatting(outline, [nodeId]);

    const metadata = getNodeMetadata(outline, nodeId);
    expect(metadata.headingLevel).toBeUndefined();
    expect(metadata.layout).toBe("standard");

    const clearedFragment = getNodeTextFragment(outline, nodeId);
    const paragraph = clearedFragment.get(0) as Y.XmlElement | undefined;
    const textNode = paragraph?.get(0) as Y.XmlText | undefined;
    const deltas = textNode?.toDelta() as Array<{ insert: unknown; attributes?: Record<string, unknown> }>;
    if (deltas) {
      deltas.forEach((delta) => {
        if (typeof delta.insert === "string") {
          expect(delta.attributes ?? {}).toEqual({});
        }
      });
    }

    expect(getNodeText(outline, nodeId)).toBe("Content");
  });

  it("toggles inline marks across the full node text", () => {
    const outline = createOutlineDoc();
    const nodeId = createNode(outline, { text: "Sample" });

    toggleNodeInlineMark(outline, [nodeId], "strong");
    let snapshot = getNodeSnapshot(outline, nodeId);
    const firstSegment = snapshot.inlineContent[0];
    expect(firstSegment?.marks.some((mark) => mark.type === "strong")).toBe(true);

    const metadataAfterApply = getNodeMetadata(outline, nodeId);
    expect(metadataAfterApply.updatedAt).toBeGreaterThanOrEqual(metadataAfterApply.createdAt);

    toggleNodeInlineMark(outline, [nodeId], "strong");
    snapshot = getNodeSnapshot(outline, nodeId);
    const marksAfterToggle = snapshot.inlineContent[0]?.marks ?? [];
    expect(marksAfterToggle.some((mark) => mark.type === "strong")).toBe(false);
    const metadataAfterToggle = getNodeMetadata(outline, nodeId);
    expect(metadataAfterToggle.updatedAt).toBeGreaterThanOrEqual(metadataAfterApply.updatedAt);
  });

  it("sets and clears color marks on entire nodes", () => {
    const outline = createOutlineDoc();
    const nodeId = createNode(outline, { text: "Colored" });

    setNodeColorMark(outline, [nodeId], "textColor", "#FF8800");
    let snapshot = getNodeSnapshot(outline, nodeId);
    let textColorMark = snapshot.inlineContent[0]?.marks.find((mark) => mark.type === "textColor");
    expect(textColorMark?.attrs).toMatchObject({ color: "#ff8800" });

    setNodeColorMark(outline, [nodeId], "textColor", "#00ff00");
    snapshot = getNodeSnapshot(outline, nodeId);
    textColorMark = snapshot.inlineContent[0]?.marks.find((mark) => mark.type === "textColor");
    expect(textColorMark?.attrs).toMatchObject({ color: "#00ff00" });

    setNodeColorMark(outline, [nodeId], "textColor", null);
    snapshot = getNodeSnapshot(outline, nodeId);
    const marksAfterClear = snapshot.inlineContent[0]?.marks ?? [];
    expect(marksAfterClear.some((mark) => mark.type === "textColor")).toBe(false);
  });
});
