import { describe, expect, it } from "vitest";

import {
  insertChild,
  insertSiblingBelow,
  indentEdge,
  outdentEdge,
  toggleCollapsedCommand
} from "./index";
import { createSyncContext } from "@thortiq/sync-core";
import { addEdge, createNode, getChildEdgeIds, getEdgeSnapshot } from "@thortiq/client-core";

describe("outline commands", () => {
  it("creates siblings and children with proper ordering", () => {
    const { outline, localOrigin } = createSyncContext();
    const root = createNode(outline, { text: "root", origin: localOrigin });
    const edge = addEdge(outline, { parentNodeId: null, childNodeId: root, origin: localOrigin });

    const { edgeId: firstChild } = insertChild({ outline, origin: localOrigin }, edge.edgeId);
    const { edgeId: secondChild } = insertChild({ outline, origin: localOrigin }, edge.edgeId);

    expect(getChildEdgeIds(outline, root)).toEqual([firstChild, secondChild]);

    const { edgeId: siblingEdge } = insertSiblingBelow({ outline, origin: localOrigin }, edge.edgeId);
    expect(outline.rootEdges.toArray()).toEqual([edge.edgeId, siblingEdge]);
  });

  it("indents and outdents edges while toggling collapsed state", () => {
    const { outline, localOrigin } = createSyncContext();
    const root = createNode(outline, { text: "root" });
    const rootEdge = addEdge(outline, { parentNodeId: null, childNodeId: root }).edgeId;
    const nodeOne = createNode(outline, { text: "one" });
    const edgeOne = addEdge(outline, { parentNodeId: root, childNodeId: nodeOne }).edgeId;
    const nodeTwo = createNode(outline, { text: "two" });
    const edgeTwo = addEdge(outline, { parentNodeId: root, childNodeId: nodeTwo }).edgeId;

    const indentResult = indentEdge({ outline, origin: localOrigin }, edgeTwo);
    expect(indentResult?.edgeId).toBe(edgeTwo);
    expect(getChildEdgeIds(outline, nodeOne)).toEqual([edgeTwo]);

    const collapsed = toggleCollapsedCommand({ outline }, edgeOne);
    expect(collapsed).toBe(true);
    expect(toggleCollapsedCommand({ outline }, edgeOne, false)).toBe(false);

    const outdentResult = outdentEdge({ outline, origin: localOrigin }, edgeTwo);
    expect(outdentResult?.edgeId).toBe(edgeTwo);
    expect(outline.rootEdges.toArray()).toEqual([rootEdge]);

    const rootChildren = getChildEdgeIds(outline, root);
    expect(rootChildren).toEqual([edgeOne, edgeTwo]);

    const parentSnapshot = getEdgeSnapshot(outline, edgeTwo);
    expect(parentSnapshot.parentNodeId).toBe(root);
  });
});
