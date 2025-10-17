import { describe, expect, it } from "vitest";

import {
  addEdge,
  createOutlineDoc,
  getChildEdgeIds,
  getEdgeSnapshot,
  getRootEdgeIds,
  setNodeText
} from "../doc";
import type { EdgeId, NodeId } from "../ids";
import { createMirrorEdge } from "./createMirrorEdge";

const createRootNode = (
  outline: ReturnType<typeof createOutlineDoc>,
  text: string
): { edgeId: EdgeId; nodeId: NodeId } => {
  const { edgeId, nodeId } = addEdge(outline, { parentNodeId: null });
  setNodeText(outline, nodeId, text);
  return { edgeId, nodeId };
};

describe("createMirrorEdge", () => {
  it("converts an empty bullet into a mirror targeting the selected node", () => {
    const outline = createOutlineDoc();
    const source = createRootNode(outline, "Source node");
    const blank = createRootNode(outline, "");

    const result = createMirrorEdge({
      outline,
      targetEdgeId: blank.edgeId,
      mirrorNodeId: source.nodeId,
      origin: Symbol("test-convert")
    });

    expect(result).not.toBeNull();
    expect(result?.mode).toBe("converted");
    expect(result?.edgeId).toBe(blank.edgeId);
    const snapshot = getEdgeSnapshot(outline, blank.edgeId);
    expect(snapshot.childNodeId).toBe(source.nodeId);
    expect(snapshot.mirrorOfNodeId).toBe(source.nodeId);
    expect(outline.nodes.has(blank.nodeId)).toBe(false);
  });

  it("inserts a sibling mirror when the current node contains text", () => {
    const outline = createOutlineDoc();
    const source = createRootNode(outline, "Original node");
    const target = createRootNode(outline, "Sibling with text");

    const result = createMirrorEdge({
      outline,
      targetEdgeId: target.edgeId,
      mirrorNodeId: source.nodeId,
      origin: Symbol("test-insert")
    });

    expect(result).not.toBeNull();
    expect(result?.mode).toBe("inserted");
    expect(result?.edgeId).not.toBe(target.edgeId);
    const siblings = getRootEdgeIds(outline);
    const targetIndex = siblings.indexOf(target.edgeId);
    expect(targetIndex).toBeGreaterThanOrEqual(0);
    expect(siblings[targetIndex + 1]).toBe(result?.edgeId);
    const snapshot = getEdgeSnapshot(outline, result!.edgeId);
    expect(snapshot.childNodeId).toBe(source.nodeId);
    expect(snapshot.mirrorOfNodeId).toBe(source.nodeId);
  });

  it("returns null when the mirror node does not exist", () => {
    const outline = createOutlineDoc();
    const target = createRootNode(outline, "Target");

    const result = createMirrorEdge({
      outline,
      targetEdgeId: target.edgeId,
      mirrorNodeId: "missing-node" as NodeId,
      origin: Symbol("test-missing")
    });

    expect(result).toBeNull();
  });

  it("inserts a mirror at an explicit parent position", () => {
    const outline = createOutlineDoc();
    const root = createRootNode(outline, "Root");
    const source = addEdge(outline, {
      parentNodeId: root.nodeId,
      origin: Symbol("source")
    });

    const result = createMirrorEdge({
      outline,
      mirrorNodeId: source.nodeId,
      insertParentNodeId: root.nodeId,
      insertIndex: 0,
      origin: Symbol("explicit-parent")
    });

    expect(result).not.toBeNull();
    const childEdgeIds = getChildEdgeIds(outline, root.nodeId);
    expect(childEdgeIds[0]).toBe(result?.edgeId);
    const snapshot = getEdgeSnapshot(outline, result!.edgeId);
    expect(snapshot.childNodeId).toBe(source.nodeId);
    expect(snapshot.mirrorOfNodeId).toBe(source.nodeId);
  });
});
