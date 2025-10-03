import { describe, expect, it } from "vitest";

import {
  insertRootNode,
  insertChild,
  insertChildAtStart,
  insertSiblingBelow,
  insertSiblingAbove,
  indentEdge,
  indentEdges,
  outdentEdge,
  outdentEdges,
  toggleCollapsedCommand
} from "./index";
import { createSyncContext } from "@thortiq/sync-core";
import { addEdge, createNode, getChildEdgeIds, getEdgeSnapshot } from "@thortiq/client-core";

describe("outline commands", () => {
  it("inserts root nodes at the end of the root edge list", () => {
    const { outline, localOrigin } = createSyncContext();

    const first = insertRootNode({ outline, origin: localOrigin });
    const second = insertRootNode({ outline, origin: localOrigin });

    expect(outline.rootEdges.toArray()).toEqual([first.edgeId, second.edgeId]);
    expect(getEdgeSnapshot(outline, first.edgeId).parentNodeId).toBeNull();
    expect(getEdgeSnapshot(outline, second.edgeId).parentNodeId).toBeNull();
  });

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

  it("inserts children at the start when requested", () => {
    const { outline, localOrigin } = createSyncContext();
    const parentNode = createNode(outline, { text: "parent", origin: localOrigin });
    const parentEdge = addEdge(outline, {
      parentNodeId: null,
      childNodeId: parentNode,
      origin: localOrigin
    }).edgeId;

    const { edgeId: appended } = insertChild({ outline, origin: localOrigin }, parentEdge);
    const { edgeId: insertedFirst } = insertChildAtStart({ outline, origin: localOrigin }, parentEdge);

    expect(getChildEdgeIds(outline, parentNode)).toEqual([insertedFirst, appended]);
  });

  it("inserts siblings above the reference edge", () => {
    const { outline, localOrigin } = createSyncContext();
    const rootNode = createNode(outline, { text: "root", origin: localOrigin });
    const firstEdge = addEdge(outline, {
      parentNodeId: null,
      childNodeId: rootNode,
      origin: localOrigin
    }).edgeId;

    const { edgeId: secondEdge } = insertSiblingBelow({ outline, origin: localOrigin }, firstEdge);

    const { edgeId: newEdge } = insertSiblingAbove({ outline, origin: localOrigin }, secondEdge);

    expect(outline.rootEdges.toArray()).toEqual([firstEdge, newEdge, secondEdge]);
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

  it("indents multiple edges in descending order when all have previous siblings", () => {
    const { outline, localOrigin } = createSyncContext();
    const root = createNode(outline, { text: "root" });
    addEdge(outline, { parentNodeId: null, childNodeId: root, origin: localOrigin });

    const alpha = createNode(outline, { text: "alpha" });
    const edgeAlpha = addEdge(outline, { parentNodeId: root, childNodeId: alpha, origin: localOrigin }).edgeId;
    const bravo = createNode(outline, { text: "bravo" });
    const edgeBravo = addEdge(outline, { parentNodeId: root, childNodeId: bravo, origin: localOrigin }).edgeId;
    const charlie = createNode(outline, { text: "charlie" });
    const edgeCharlie = addEdge(outline, { parentNodeId: root, childNodeId: charlie, origin: localOrigin }).edgeId;
    const delta = createNode(outline, { text: "delta" });
    const edgeDelta = addEdge(outline, { parentNodeId: root, childNodeId: delta, origin: localOrigin }).edgeId;

    const result = indentEdges({ outline, origin: localOrigin }, [edgeCharlie, edgeBravo]);

    expect(result).not.toBeNull();
    expect(result?.map((entry) => entry.edgeId)).toEqual([edgeCharlie, edgeBravo]);
    expect(getChildEdgeIds(outline, alpha)).toEqual([edgeBravo, edgeCharlie]);
    expect(getChildEdgeIds(outline, root)).toEqual([edgeAlpha, edgeDelta]);
  });

  it("does not indent any edge when one selection has no previous sibling", () => {
    const { outline } = createSyncContext();
    const root = createNode(outline, { text: "root" });
    addEdge(outline, { parentNodeId: null, childNodeId: root });

    const alpha = createNode(outline, { text: "alpha" });
    const edgeAlpha = addEdge(outline, { parentNodeId: root, childNodeId: alpha }).edgeId;
    const bravo = createNode(outline, { text: "bravo" });
    const edgeBravo = addEdge(outline, { parentNodeId: root, childNodeId: bravo }).edgeId;

    const result = indentEdges({ outline }, [edgeAlpha, edgeBravo]);
    expect(result).toBeNull();
    expect(getChildEdgeIds(outline, root)).toEqual([edgeAlpha, edgeBravo]);
  });

  it("cancels indent when every previous sibling is also selected", () => {
    const { outline } = createSyncContext();
    const root = createNode(outline, { text: "root" });
    addEdge(outline, { parentNodeId: null, childNodeId: root });

    const alpha = createNode(outline, { text: "alpha" });
    const edgeAlpha = addEdge(outline, { parentNodeId: root, childNodeId: alpha }).edgeId;
    const bravo = createNode(outline, { text: "bravo" });
    const edgeBravo = addEdge(outline, { parentNodeId: root, childNodeId: bravo }).edgeId;
    const charlie = createNode(outline, { text: "charlie" });
    const edgeCharlie = addEdge(outline, { parentNodeId: root, childNodeId: charlie }).edgeId;

    const result = indentEdges({ outline }, [edgeBravo, edgeAlpha]);
    expect(result).toBeNull();
    expect(getChildEdgeIds(outline, root)).toEqual([edgeAlpha, edgeBravo, edgeCharlie]);
  });

  it("outdents multiple edges in ascending order when all have parents", () => {
    const { outline, localOrigin } = createSyncContext();
    const root = createNode(outline, { text: "root" });
    addEdge(outline, { parentNodeId: null, childNodeId: root, origin: localOrigin });

    const alpha = createNode(outline, { text: "alpha" });
    const edgeAlpha = addEdge(outline, { parentNodeId: root, childNodeId: alpha, origin: localOrigin }).edgeId;
    const bravo = createNode(outline, { text: "bravo" });
    const edgeBravo = addEdge(outline, { parentNodeId: alpha, childNodeId: bravo, origin: localOrigin }).edgeId;
    const charlie = createNode(outline, { text: "charlie" });
    const edgeCharlie = addEdge(outline, { parentNodeId: alpha, childNodeId: charlie, origin: localOrigin }).edgeId;
    const delta = createNode(outline, { text: "delta" });
    const edgeDelta = addEdge(outline, { parentNodeId: root, childNodeId: delta, origin: localOrigin }).edgeId;

    const result = outdentEdges(
      { outline, origin: localOrigin },
      [edgeBravo, edgeCharlie]
    );

    expect(result).not.toBeNull();
    expect(result?.map((entry) => entry.edgeId)).toEqual([edgeBravo, edgeCharlie]);
    expect(getChildEdgeIds(outline, alpha)).toEqual([]);
    expect(getChildEdgeIds(outline, root)).toEqual([edgeAlpha, edgeBravo, edgeCharlie, edgeDelta]);
  });

  it("does not outdent any edge when one selection has no parent", () => {
    const { outline } = createSyncContext();
    const root = createNode(outline, { text: "root" });
    const edgeRoot = addEdge(outline, { parentNodeId: null, childNodeId: root }).edgeId;
    const alpha = createNode(outline, { text: "alpha" });
    const edgeAlpha = addEdge(outline, { parentNodeId: root, childNodeId: alpha }).edgeId;

    const result = outdentEdges({ outline }, [edgeRoot, edgeAlpha]);
    expect(result).toBeNull();
    expect(outline.rootEdges.toArray()).toEqual([edgeRoot]);
    expect(getChildEdgeIds(outline, root)).toEqual([edgeAlpha]);
  });
});
