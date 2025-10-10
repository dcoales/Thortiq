import { describe, expect, it } from "vitest";

import {
  insertRootNode,
  insertChild,
  insertChildAtStart,
  insertSiblingBelow,
  insertSiblingAbove,
  indentEdge,
  indentEdges,
  mergeWithPrevious,
  outdentEdge,
  outdentEdges,
  toggleCollapsedCommand,
  toggleTodoDoneCommand,
  createDeleteEdgesPlan,
  deleteEdges,
  applyParagraphLayoutCommand,
  applyNumberedLayoutCommand,
  applyStandardLayoutCommand,
  moveEdgesToParent
} from "./index";
import { createSyncContext } from "@thortiq/sync-core";
import {
  addEdge,
  createNode,
  getChildEdgeIds,
  getEdgeSnapshot,
  getNodeMetadata,
  getNodeText,
  createMirrorEdge,
  updateNodeMetadata
} from "@thortiq/client-core";

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

  it("skips indent for descendants of other selected edges", () => {
    const { outline } = createSyncContext();
    const root = createNode(outline, { text: "root" });
    addEdge(outline, { parentNodeId: null, childNodeId: root });

    const alpha = createNode(outline, { text: "alpha" });
    const edgeAlpha = addEdge(outline, { parentNodeId: root, childNodeId: alpha }).edgeId;
    const parentNode = createNode(outline, { text: "parent" });
    const edgeParent = addEdge(outline, { parentNodeId: root, childNodeId: parentNode }).edgeId;
    const childNode = createNode(outline, { text: "child" });
    const edgeChild = addEdge(outline, { parentNodeId: parentNode, childNodeId: childNode }).edgeId;

    const result = indentEdges({ outline }, [edgeParent, edgeChild]);

    expect(result?.map((entry) => entry.edgeId)).toEqual([edgeParent]);
    expect(getChildEdgeIds(outline, alpha)).toEqual([edgeParent]);
    expect(getChildEdgeIds(outline, parentNode)).toEqual([edgeChild]);
    expect(getChildEdgeIds(outline, root)).toEqual([edgeAlpha]);
  });

  it("opens a previously childless parent after indent", () => {
    const { outline } = createSyncContext();
    const root = createNode(outline, { text: "root" });
    addEdge(outline, { parentNodeId: null, childNodeId: root });

    const parentNode = createNode(outline, { text: "parent" });
    const edgeParent = addEdge(outline, { parentNodeId: root, childNodeId: parentNode }).edgeId;
    const targetNode = createNode(outline, { text: "target" });
    const edgeTarget = addEdge(outline, { parentNodeId: root, childNodeId: targetNode }).edgeId;

    toggleCollapsedCommand({ outline }, edgeParent);

    const result = indentEdges({ outline }, [edgeTarget]);

    expect(result?.map((entry) => entry.edgeId)).toEqual([edgeTarget]);
    expect(getChildEdgeIds(outline, parentNode)).toEqual([edgeTarget]);
    expect(getEdgeSnapshot(outline, edgeParent).collapsed).toBe(false);
  });

  it("preserves collapse state when indenting under an existing parent", () => {
    const { outline } = createSyncContext();
    const root = createNode(outline, { text: "root" });
    addEdge(outline, { parentNodeId: null, childNodeId: root });

    const parentNode = createNode(outline, { text: "parent" });
    const edgeParent = addEdge(outline, { parentNodeId: root, childNodeId: parentNode }).edgeId;
    const existingChild = createNode(outline, { text: "existing" });
    const edgeExisting = addEdge(outline, {
      parentNodeId: parentNode,
      childNodeId: existingChild
    }).edgeId;
    const targetNode = createNode(outline, { text: "target" });
    const edgeTarget = addEdge(outline, { parentNodeId: root, childNodeId: targetNode }).edgeId;

    toggleCollapsedCommand({ outline }, edgeParent);

    const result = indentEdges({ outline }, [edgeTarget]);

    expect(result?.map((entry) => entry.edgeId)).toEqual([edgeTarget]);
    expect(getChildEdgeIds(outline, parentNode)).toEqual([edgeExisting, edgeTarget]);
    expect(getEdgeSnapshot(outline, edgeParent).collapsed).toBe(true);
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

  it("skips outdent for descendants of other selected edges", () => {
    const { outline } = createSyncContext();
    const root = createNode(outline, { text: "root" });
    addEdge(outline, { parentNodeId: null, childNodeId: root });

    const containerNode = createNode(outline, { text: "container" });
    const edgeContainer = addEdge(outline, { parentNodeId: root, childNodeId: containerNode }).edgeId;
    const parentNode = createNode(outline, { text: "parent" });
    const edgeParent = addEdge(outline, { parentNodeId: containerNode, childNodeId: parentNode }).edgeId;
    const childNode = createNode(outline, { text: "child" });
    const edgeChild = addEdge(outline, { parentNodeId: parentNode, childNodeId: childNode }).edgeId;
    const siblingNode = createNode(outline, { text: "sibling" });
    const edgeSibling = addEdge(outline, { parentNodeId: root, childNodeId: siblingNode }).edgeId;

    const result = outdentEdges({ outline }, [edgeParent, edgeChild]);

    expect(result?.map((entry) => entry.edgeId)).toEqual([edgeParent]);
    expect(getChildEdgeIds(outline, parentNode)).toEqual([edgeChild]);
    expect(getChildEdgeIds(outline, containerNode)).toEqual([]);
    expect(getChildEdgeIds(outline, root)).toEqual([edgeContainer, edgeParent, edgeSibling]);
  });

  it("merges an empty node into its previous sibling", () => {
    const { outline, localOrigin } = createSyncContext();
    const parent = createNode(outline, { text: "parent" });
    addEdge(outline, { parentNodeId: null, childNodeId: parent, origin: localOrigin });

    const firstNode = createNode(outline, { text: "first" });
    const firstEdge = addEdge(outline, { parentNodeId: parent, childNodeId: firstNode, origin: localOrigin }).edgeId;
    const emptyNode = createNode(outline, { text: "" });
    const emptyEdge = addEdge(outline, { parentNodeId: parent, childNodeId: emptyNode, origin: localOrigin }).edgeId;
    const grandChild = createNode(outline, { text: "child" });
    const grandChildEdge = addEdge(outline, {
      parentNodeId: emptyNode,
      childNodeId: grandChild,
      origin: localOrigin
    }).edgeId;

    const result = mergeWithPrevious({ outline, origin: localOrigin }, emptyEdge);

    expect(result).not.toBeNull();
    expect(result?.edgeId).toBe(firstEdge);
    expect(result?.cursor).toBe("end");
    expect(getChildEdgeIds(outline, firstNode)).toEqual([grandChildEdge]);
    expect(outline.edges.has(emptyEdge)).toBe(false);
  });

  it("merges an empty first child into its parent", () => {
    const { outline, localOrigin } = createSyncContext();
    const parent = createNode(outline, { text: "parent" });
    const parentEdge = addEdge(outline, { parentNodeId: null, childNodeId: parent, origin: localOrigin }).edgeId;

    const emptyNode = createNode(outline, { text: "  " });
    const emptyEdge = addEdge(outline, { parentNodeId: parent, childNodeId: emptyNode, origin: localOrigin }).edgeId;
    const childNode = createNode(outline, { text: "child" });
    const childEdge = addEdge(outline, {
      parentNodeId: emptyNode,
      childNodeId: childNode,
      origin: localOrigin
    }).edgeId;

    const result = mergeWithPrevious({ outline, origin: localOrigin }, emptyEdge);

    expect(result).not.toBeNull();
    expect(result?.edgeId).toBe(parentEdge);
    expect(result?.cursor).toBe("end");
    expect(getChildEdgeIds(outline, parent)).toEqual([childEdge]);
    expect(outline.edges.has(emptyEdge)).toBe(false);
  });

  it("merges text into the previous sibling when allowed", () => {
    const { outline, localOrigin } = createSyncContext();
    const parent = createNode(outline, { text: "parent" });
    addEdge(outline, { parentNodeId: null, childNodeId: parent, origin: localOrigin });

    const previousNode = createNode(outline, { text: "alpha" });
    const previousEdge = addEdge(outline, { parentNodeId: parent, childNodeId: previousNode, origin: localOrigin }).edgeId;
    const mergeNode = createNode(outline, { text: "beta" });
    const mergeEdge = addEdge(outline, { parentNodeId: parent, childNodeId: mergeNode, origin: localOrigin }).edgeId;
    const orphanChild = createNode(outline, { text: "nested" });
    const orphanEdge = addEdge(outline, {
      parentNodeId: mergeNode,
      childNodeId: orphanChild,
      origin: localOrigin
    }).edgeId;

    const result = mergeWithPrevious({ outline, origin: localOrigin }, mergeEdge);

    expect(result).not.toBeNull();
    expect(result?.edgeId).toBe(previousEdge);
    expect(result?.cursor).toEqual({ type: "offset", index: 5 });
    expect(getNodeText(outline, previousNode)).toBe("alphabeta");
    expect(getChildEdgeIds(outline, previousNode)).toEqual([orphanEdge]);
    expect(outline.edges.has(mergeEdge)).toBe(false);
  });

  it("cancels merge when both siblings have children", () => {
    const { outline, localOrigin } = createSyncContext();
    const parent = createNode(outline, { text: "parent" });
    addEdge(outline, { parentNodeId: null, childNodeId: parent, origin: localOrigin });

    const previousNode = createNode(outline, { text: "alpha" });
    const previousEdge = addEdge(outline, { parentNodeId: parent, childNodeId: previousNode, origin: localOrigin }).edgeId;
    const previousChild = createNode(outline, { text: "child" });
    addEdge(outline, { parentNodeId: previousNode, childNodeId: previousChild, origin: localOrigin });

    const mergeNode = createNode(outline, { text: "beta" });
    const mergeEdge = addEdge(outline, { parentNodeId: parent, childNodeId: mergeNode, origin: localOrigin }).edgeId;
    const mergeChild = createNode(outline, { text: "nested" });
    addEdge(outline, { parentNodeId: mergeNode, childNodeId: mergeChild, origin: localOrigin });

    const result = mergeWithPrevious({ outline, origin: localOrigin }, mergeEdge);

    expect(result).toBeNull();
    expect(getNodeText(outline, previousNode)).toBe("alpha");
    expect(getNodeText(outline, mergeNode)).toBe("beta");
    expect(getChildEdgeIds(outline, previousNode)).toHaveLength(1);
    expect(getChildEdgeIds(outline, mergeNode)).toHaveLength(1);
    expect(outline.edges.has(previousEdge)).toBe(true);
  });

  it("does nothing when there is no previous sibling", () => {
    const { outline, localOrigin } = createSyncContext();
    const parent = createNode(outline, { text: "parent" });
    addEdge(outline, { parentNodeId: null, childNodeId: parent, origin: localOrigin });

    const mergeNode = createNode(outline, { text: "beta" });
    const mergeEdge = addEdge(outline, { parentNodeId: parent, childNodeId: mergeNode, origin: localOrigin }).edgeId;

    const result = mergeWithPrevious({ outline, origin: localOrigin }, mergeEdge);

    expect(result).toBeNull();
    expect(getNodeText(outline, mergeNode)).toBe("beta");
    expect(outline.edges.has(mergeEdge)).toBe(true);
  });

  it("plans deletion including descendants and focuses the next sibling", () => {
    const { outline, localOrigin } = createSyncContext();
    const alphaNode = createNode(outline, { text: "alpha" });
    const edgeAlpha = addEdge(outline, { parentNodeId: null, childNodeId: alphaNode, origin: localOrigin }).edgeId;
    const alphaChildOne = createNode(outline, { text: "alpha child one" });
    const edgeAlphaChildOne = addEdge(outline, {
      parentNodeId: alphaNode,
      childNodeId: alphaChildOne,
      origin: localOrigin
    }).edgeId;
    const alphaChildTwo = createNode(outline, { text: "alpha child two" });
    const edgeAlphaChildTwo = addEdge(outline, {
      parentNodeId: alphaNode,
      childNodeId: alphaChildTwo,
      origin: localOrigin
    }).edgeId;

    const bravoNode = createNode(outline, { text: "bravo" });
    const edgeBravo = addEdge(outline, { parentNodeId: null, childNodeId: bravoNode, origin: localOrigin }).edgeId;
    const charlieNode = createNode(outline, { text: "charlie" });
    const edgeCharlie = addEdge(outline, { parentNodeId: null, childNodeId: charlieNode, origin: localOrigin }).edgeId;

    const plan = createDeleteEdgesPlan(outline, [edgeAlpha]);
    expect(plan).not.toBeNull();
    expect(plan?.removalOrder).toEqual([edgeAlphaChildOne, edgeAlphaChildTwo, edgeAlpha]);
    expect(plan?.nextEdgeId).toBe(edgeBravo);

    const result = deleteEdges({ outline, origin: localOrigin }, plan!);

    expect(result.deletedEdgeIds).toEqual([edgeAlphaChildOne, edgeAlphaChildTwo, edgeAlpha]);
    expect(result.nextEdgeId).toBe(edgeBravo);
    expect(outline.edges.has(edgeAlpha)).toBe(false);
    expect(outline.edges.has(edgeAlphaChildOne)).toBe(false);
    expect(outline.edges.has(edgeAlphaChildTwo)).toBe(false);
    expect(outline.rootEdges.toArray()).toEqual([edgeBravo, edgeCharlie]);
  });

  it("falls back to the previous edge when deleting the last sibling", () => {
    const { outline, localOrigin } = createSyncContext();
    const alphaNode = createNode(outline, { text: "alpha" });
    const edgeAlpha = addEdge(outline, { parentNodeId: null, childNodeId: alphaNode, origin: localOrigin }).edgeId;
    const bravoNode = createNode(outline, { text: "bravo" });
    const edgeBravo = addEdge(outline, { parentNodeId: null, childNodeId: bravoNode, origin: localOrigin }).edgeId;

    const plan = createDeleteEdgesPlan(outline, [edgeBravo]);
    expect(plan).not.toBeNull();
    expect(plan?.nextEdgeId).toBe(edgeAlpha);

    const result = deleteEdges({ outline, origin: localOrigin }, plan!);

    expect(result.nextEdgeId).toBe(edgeAlpha);
    expect(outline.rootEdges.toArray()).toEqual([edgeAlpha]);
    expect(outline.edges.has(edgeBravo)).toBe(false);
  });

  it("promotes a surviving mirror when deleting the original edge", () => {
    const { outline, localOrigin } = createSyncContext();
    const nodeId = createNode(outline, { text: "original", origin: localOrigin });
    const originalEdgeId = addEdge(outline, { parentNodeId: null, childNodeId: nodeId, origin: localOrigin }).edgeId;
    const childNodeId = createNode(outline, { text: "child", origin: localOrigin });
    const childEdgeId = addEdge(outline, { parentNodeId: nodeId, childNodeId: childNodeId, origin: localOrigin }).edgeId;

    const mirror = createMirrorEdge({
      outline,
      mirrorNodeId: nodeId,
      insertParentNodeId: null,
      insertIndex: 1,
      origin: localOrigin
    });

    expect(mirror).not.toBeNull();
    const mirrorEdgeId = mirror!.edgeId;

    const plan = createDeleteEdgesPlan(outline, [originalEdgeId]);
    expect(plan).not.toBeNull();
    expect(plan?.removalOrder).toEqual([childEdgeId, originalEdgeId]);

    const result = deleteEdges({ outline, origin: localOrigin }, plan!);

    expect(outline.edges.has(originalEdgeId)).toBe(false);
    const promotedSnapshot = getEdgeSnapshot(outline, mirrorEdgeId);
    expect(promotedSnapshot.mirrorOfNodeId).toBeNull();
    expect(result.deletedEdgeIds).toEqual([originalEdgeId]);
    expect(getChildEdgeIds(outline, nodeId)).toEqual([childEdgeId]);
  });

  it("removes only the mirror edge when deleting a mirror instance", () => {
    const { outline, localOrigin } = createSyncContext();
    const rootNodeId = createNode(outline, { text: "root", origin: localOrigin });
    const originalEdgeId = addEdge(outline, { parentNodeId: null, childNodeId: rootNodeId, origin: localOrigin }).edgeId;
    const childNodeId = createNode(outline, { text: "child", origin: localOrigin });
    const childEdgeId = addEdge(outline, { parentNodeId: rootNodeId, childNodeId: childNodeId, origin: localOrigin }).edgeId;

    const mirror = createMirrorEdge({
      outline,
      mirrorNodeId: rootNodeId,
      insertParentNodeId: null,
      insertIndex: 1,
      origin: localOrigin
    });

    expect(mirror).not.toBeNull();
    const mirrorEdgeId = mirror!.edgeId;

    const plan = createDeleteEdgesPlan(outline, [mirrorEdgeId]);
    expect(plan).not.toBeNull();
    expect(plan?.removalOrder).toEqual([mirrorEdgeId]);

    const result = deleteEdges({ outline, origin: localOrigin }, plan!);

    expect(outline.edges.has(mirrorEdgeId)).toBe(false);
    expect(outline.edges.has(childEdgeId)).toBe(true);
    const remainingChildren = getChildEdgeIds(outline, rootNodeId);
    expect(remainingChildren).toContain(childEdgeId);
    const originalSnapshot = getEdgeSnapshot(outline, originalEdgeId);
    expect(originalSnapshot.mirrorOfNodeId).toBeNull();
    expect(result.deletedEdgeIds).toEqual([mirrorEdgeId]);
  });

  it("promotes mirrors during cascading deletes while preserving descendants", () => {
    const { outline, localOrigin } = createSyncContext();
    const grandParentNodeId = createNode(outline, { text: "grand", origin: localOrigin });
    const grandParentEdgeId = addEdge(outline, { parentNodeId: null, childNodeId: grandParentNodeId, origin: localOrigin }).edgeId;
    const parentNodeId = createNode(outline, { text: "parent", origin: localOrigin });
    const parentEdgeId = addEdge(outline, { parentNodeId: grandParentNodeId, childNodeId: parentNodeId, origin: localOrigin }).edgeId;
    const leafNodeId = createNode(outline, { text: "leaf", origin: localOrigin });
    const leafEdgeId = addEdge(outline, { parentNodeId: parentNodeId, childNodeId: leafNodeId, origin: localOrigin }).edgeId;

    const mirror = createMirrorEdge({
      outline,
      mirrorNodeId: parentNodeId,
      insertParentNodeId: null,
      insertIndex: 1,
      origin: localOrigin
    });
    expect(mirror).not.toBeNull();
    const mirrorEdgeId = mirror!.edgeId;

    const plan = createDeleteEdgesPlan(outline, [grandParentEdgeId]);
    expect(plan).not.toBeNull();
    expect(plan?.removalOrder).toEqual([leafEdgeId, parentEdgeId, grandParentEdgeId]);

    const result = deleteEdges({ outline, origin: localOrigin }, plan!);

    expect(result.deletedEdgeIds).toEqual([parentEdgeId, grandParentEdgeId]);
    expect(outline.edges.has(parentEdgeId)).toBe(false);
    expect(outline.edges.has(grandParentEdgeId)).toBe(false);
    expect(outline.edges.has(leafEdgeId)).toBe(true);
    expect(getChildEdgeIds(outline, parentNodeId)).toEqual([leafEdgeId]);
    const promotedParent = getEdgeSnapshot(outline, mirrorEdgeId);
    expect(promotedParent.mirrorOfNodeId).toBeNull();
    expect(outline.nodes.has(grandParentNodeId)).toBe(false);
    expect(outline.nodes.has(parentNodeId)).toBe(true);
    expect(outline.nodes.has(leafNodeId)).toBe(true);
  });

  it("groups mirror promotion deletes into a single undo step", () => {
    const { outline, localOrigin, undoManager } = createSyncContext();
    const nodeId = createNode(outline, { text: "original", origin: localOrigin });
    const originalEdgeId = addEdge(outline, { parentNodeId: null, childNodeId: nodeId, origin: localOrigin }).edgeId;
    const childNodeId = createNode(outline, { text: "child", origin: localOrigin });
    const childEdgeId = addEdge(outline, { parentNodeId: nodeId, childNodeId: childNodeId, origin: localOrigin }).edgeId;

    const mirror = createMirrorEdge({
      outline,
      mirrorNodeId: nodeId,
      insertParentNodeId: null,
      insertIndex: 1,
      origin: localOrigin
    });
    expect(mirror).not.toBeNull();
    const mirrorEdgeId = mirror!.edgeId;

    const plan = createDeleteEdgesPlan(outline, [originalEdgeId]);
    expect(plan).not.toBeNull();

    undoManager.stopCapturing();
    deleteEdges({ outline, origin: localOrigin }, plan!);

    expect(outline.edges.has(originalEdgeId)).toBe(false);
    expect(getEdgeSnapshot(outline, mirrorEdgeId).mirrorOfNodeId).toBeNull();
    expect(getChildEdgeIds(outline, nodeId)).toEqual([childEdgeId]);

    undoManager.undo();

    expect(outline.edges.has(mirrorEdgeId)).toBe(true);
    expect(getEdgeSnapshot(outline, mirrorEdgeId).mirrorOfNodeId).toBe(nodeId);
    expect(outline.edges.has(originalEdgeId)).toBe(true);
    expect(getChildEdgeIds(outline, nodeId)).toEqual([childEdgeId]);
  });

  it("toggles the done state for a single edge", () => {
    const { outline, localOrigin } = createSyncContext();
    const nodeId = createNode(outline, { text: "task", origin: localOrigin });
    const edgeId = addEdge(outline, { parentNodeId: null, childNodeId: nodeId, origin: localOrigin }).edgeId;

    expect(getNodeMetadata(outline, nodeId).todo?.done ?? false).toBe(false);

    const firstToggle = toggleTodoDoneCommand({ outline, origin: localOrigin }, [edgeId]);
    expect(firstToggle).not.toBeNull();
    expect(getNodeMetadata(outline, nodeId).todo?.done).toBe(true);

    const secondToggle = toggleTodoDoneCommand({ outline, origin: localOrigin }, [edgeId]);
    expect(secondToggle).not.toBeNull();
    expect(getNodeMetadata(outline, nodeId).todo?.done).toBe(false);
  });

  it("toggles multiple edges and preserves due dates", () => {
    const { outline, localOrigin } = createSyncContext();
    const rootNode = createNode(outline, { text: "root", origin: localOrigin });
    addEdge(outline, { parentNodeId: null, childNodeId: rootNode, origin: localOrigin });

    const alphaNode = createNode(outline, { text: "alpha", origin: localOrigin });
    const edgeAlpha = addEdge(outline, { parentNodeId: rootNode, childNodeId: alphaNode, origin: localOrigin }).edgeId;
    const bravoNode = createNode(outline, { text: "bravo", origin: localOrigin });
    const edgeBravo = addEdge(outline, { parentNodeId: rootNode, childNodeId: bravoNode, origin: localOrigin }).edgeId;

    updateNodeMetadata(outline, bravoNode, {
      todo: { done: true, dueDate: "2024-12-01" }
    });

    const result = toggleTodoDoneCommand({ outline, origin: localOrigin }, [edgeAlpha, edgeBravo]);
    expect(result).not.toBeNull();

    const alphaMetadata = getNodeMetadata(outline, alphaNode);
    const bravoMetadata = getNodeMetadata(outline, bravoNode);

    expect(alphaMetadata.todo?.done).toBe(true);
    expect(bravoMetadata.todo?.done).toBe(false);
    expect(bravoMetadata.todo?.dueDate).toBe("2024-12-01");

    const revert = toggleTodoDoneCommand({ outline, origin: localOrigin }, [edgeAlpha, edgeBravo]);
    expect(revert).not.toBeNull();

    const revertedAlpha = getNodeMetadata(outline, alphaNode);
    const revertedBravo = getNodeMetadata(outline, bravoNode);

    expect(revertedAlpha.todo?.done).toBe(false);
    expect(revertedBravo.todo?.done).toBe(true);
    expect(revertedBravo.todo?.dueDate).toBe("2024-12-01");
  });

  it("applies paragraph layout to selected edges", () => {
    const { outline, localOrigin } = createSyncContext();
    const nodeId = createNode(outline, { text: "single", origin: localOrigin });
    const edgeId = addEdge(outline, { parentNodeId: null, childNodeId: nodeId, origin: localOrigin }).edgeId;

    const result = applyParagraphLayoutCommand({ outline, origin: localOrigin }, [edgeId]);
    expect(result).toEqual([{ edgeId, nodeId }]);
    expect(getNodeMetadata(outline, nodeId).layout).toBe("paragraph");

    const unchanged = applyParagraphLayoutCommand({ outline, origin: localOrigin }, [edgeId]);
    expect(unchanged).toBeNull();
  });

  it("switches numbered layouts back to standard across multiple edges", () => {
    const { outline, localOrigin } = createSyncContext();
    const parentNode = createNode(outline, { text: "root", origin: localOrigin });
    addEdge(outline, { parentNodeId: null, childNodeId: parentNode, origin: localOrigin });

    const firstNode = createNode(outline, { text: "first", origin: localOrigin });
    const firstEdge = addEdge(outline, { parentNodeId: parentNode, childNodeId: firstNode, origin: localOrigin }).edgeId;
    const secondNode = createNode(outline, { text: "second", origin: localOrigin });
    const secondEdge = addEdge(outline, { parentNodeId: parentNode, childNodeId: secondNode, origin: localOrigin }).edgeId;

    const numbered = applyNumberedLayoutCommand({ outline, origin: localOrigin }, [firstEdge, secondEdge, firstEdge]);
    expect(numbered).toEqual([
      { edgeId: firstEdge, nodeId: firstNode },
      { edgeId: secondEdge, nodeId: secondNode }
    ]);
    expect(getNodeMetadata(outline, firstNode).layout).toBe("numbered");
    expect(getNodeMetadata(outline, secondNode).layout).toBe("numbered");

    const reset = applyStandardLayoutCommand({ outline, origin: localOrigin }, [firstEdge, secondEdge]);
    expect(reset).toEqual([
      { edgeId: firstEdge, nodeId: firstNode },
      { edgeId: secondEdge, nodeId: secondNode }
    ]);
    expect(getNodeMetadata(outline, firstNode).layout).toBe("standard");
    expect(getNodeMetadata(outline, secondNode).layout).toBe("standard");
  });

  it("moves selected edges to a new parent at the beginning", () => {
    const { outline, localOrigin } = createSyncContext();
    const sourceParent = createNode(outline, { text: "source", origin: localOrigin });
    addEdge(outline, { parentNodeId: null, childNodeId: sourceParent, origin: localOrigin });

    const alphaNode = createNode(outline, { text: "Alpha", origin: localOrigin });
    const alphaEdge = addEdge(outline, { parentNodeId: sourceParent, childNodeId: alphaNode, origin: localOrigin }).edgeId;
    const betaNode = createNode(outline, { text: "Beta", origin: localOrigin });
    const betaEdge = addEdge(outline, { parentNodeId: sourceParent, childNodeId: betaNode, origin: localOrigin }).edgeId;

    const targetParent = createNode(outline, { text: "target", origin: localOrigin });
    addEdge(outline, { parentNodeId: null, childNodeId: targetParent, origin: localOrigin });

    const result = moveEdgesToParent(
      { outline, origin: localOrigin },
      [alphaEdge, betaEdge],
      targetParent,
      "start"
    );
    expect(result).toEqual([
      { edgeId: alphaEdge, nodeId: alphaNode },
      { edgeId: betaEdge, nodeId: betaNode }
    ]);

    expect(getChildEdgeIds(outline, sourceParent)).toEqual([]);
    expect(getChildEdgeIds(outline, targetParent)).toEqual([alphaEdge, betaEdge]);
  });

  it("appends moved edges to the end of the target parent", () => {
    const { outline, localOrigin } = createSyncContext();
    const sourceParent = createNode(outline, { text: "source", origin: localOrigin });
    addEdge(outline, { parentNodeId: null, childNodeId: sourceParent, origin: localOrigin });

    const gammaNode = createNode(outline, { text: "Gamma", origin: localOrigin });
    const gammaEdge = addEdge(outline, { parentNodeId: sourceParent, childNodeId: gammaNode, origin: localOrigin }).edgeId;
    const deltaNode = createNode(outline, { text: "Delta", origin: localOrigin });
    const deltaEdge = addEdge(outline, { parentNodeId: sourceParent, childNodeId: deltaNode, origin: localOrigin }).edgeId;

    const targetParent = createNode(outline, { text: "target", origin: localOrigin });
    const targetEdge = addEdge(outline, { parentNodeId: null, childNodeId: targetParent, origin: localOrigin }).edgeId;
    const existingChild = createNode(outline, { text: "Existing", origin: localOrigin });
    const existingEdge = addEdge(outline, { parentNodeId: targetParent, childNodeId: existingChild, origin: localOrigin }).edgeId;
    expect(targetEdge).toBeDefined();

    const result = moveEdgesToParent(
      { outline, origin: localOrigin },
      [gammaEdge, deltaEdge],
      targetParent,
      "end"
    );
    expect(result).toEqual([
      { edgeId: gammaEdge, nodeId: gammaNode },
      { edgeId: deltaEdge, nodeId: deltaNode }
    ]);

    expect(getChildEdgeIds(outline, targetParent)).toEqual([existingEdge, gammaEdge, deltaEdge]);
  });

  it("prevents moving a parent under its own descendant", () => {
    const { outline, localOrigin } = createSyncContext();
    const rootNode = createNode(outline, { text: "root", origin: localOrigin });
    const rootEdge = addEdge(outline, { parentNodeId: null, childNodeId: rootNode, origin: localOrigin }).edgeId;
    const childNode = createNode(outline, { text: "child", origin: localOrigin });
    const childEdge = addEdge(outline, { parentNodeId: rootNode, childNodeId: childNode, origin: localOrigin }).edgeId;
    const grandNode = createNode(outline, { text: "grand", origin: localOrigin });
    addEdge(outline, { parentNodeId: childNode, childNodeId: grandNode, origin: localOrigin });

    const result = moveEdgesToParent({ outline, origin: localOrigin }, [rootEdge], childNode, "end");
    expect(result).toBeNull();
    expect(getChildEdgeIds(outline, rootNode)).toEqual([childEdge]);
  });
});
