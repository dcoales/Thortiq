/**
 * Outline command helpers wrap transactional operations on the shared Yjs outline so that
 * platform-specific shells (web, desktop, mobile) can implement consistent keyboard and menu
 * behaviour without duplicating data manipulation logic.
 */
import {
  addEdge,
  createNode,
  getChildEdgeIds,
  getEdgeSnapshot,
  getParentEdgeId,
  moveEdge,
  toggleEdgeCollapsed,
  type EdgeId,
  type NodeId,
  type OutlineDoc
} from "@thortiq/client-core";

export interface CommandContext {
  readonly outline: OutlineDoc;
  readonly origin?: unknown;
}

export interface CommandResult {
  readonly edgeId: EdgeId;
  readonly nodeId: NodeId;
}

export const insertSiblingBelow = (context: CommandContext, edgeId: EdgeId): CommandResult => {
  const { outline, origin } = context;
  const snapshot = getEdgeSnapshot(outline, edgeId);
  const siblings = getSiblingEdges(outline, snapshot.parentNodeId);
  const index = siblings.indexOf(edgeId);
  const insertionIndex = index >= 0 ? index + 1 : siblings.length;

  const newNodeId = createNode(outline, { origin });
  const { edgeId: newEdgeId, nodeId } = addEdge(outline, {
    parentNodeId: snapshot.parentNodeId,
    childNodeId: newNodeId,
    position: insertionIndex,
    origin
  });

  return { edgeId: newEdgeId, nodeId };
};

export const insertChild = (context: CommandContext, edgeId: EdgeId): CommandResult => {
  const { outline, origin } = context;
  const snapshot = getEdgeSnapshot(outline, edgeId);
  const children = getChildEdgeIds(outline, snapshot.childNodeId);
  const newNodeId = createNode(outline, { origin });
  const { edgeId: newEdgeId, nodeId } = addEdge(outline, {
    parentNodeId: snapshot.childNodeId,
    childNodeId: newNodeId,
    position: children.length,
    origin
  });

  return { edgeId: newEdgeId, nodeId };
};

export const indentEdge = (context: CommandContext, edgeId: EdgeId): CommandResult | null => {
  const { outline, origin } = context;
  const snapshot = getEdgeSnapshot(outline, edgeId);
  const siblings = getSiblingEdges(outline, snapshot.parentNodeId);
  const currentIndex = siblings.indexOf(edgeId);
  if (currentIndex <= 0) {
    return null;
  }

  const newParentEdgeId = siblings[currentIndex - 1];
  const newParentEdge = getEdgeSnapshot(outline, newParentEdgeId);

  moveEdge(outline, edgeId, newParentEdge.childNodeId, getChildEdgeIds(outline, newParentEdge.childNodeId).length, origin);

  return { edgeId, nodeId: snapshot.childNodeId };
};

export const outdentEdge = (context: CommandContext, edgeId: EdgeId): CommandResult | null => {
  const { outline, origin } = context;
  const snapshot = getEdgeSnapshot(outline, edgeId);
  if (snapshot.parentNodeId === null) {
    return null;
  }

  const parentEdgeId = getParentEdgeId(outline, snapshot.parentNodeId);
  const parentEdge = parentEdgeId ? getEdgeSnapshot(outline, parentEdgeId) : null;
  const parentSiblings = getSiblingEdges(outline, parentEdge ? parentEdge.parentNodeId : null);
  const parentIndex = parentEdge ? parentSiblings.indexOf(parentEdge.id) : parentSiblings.length;

  moveEdge(outline, edgeId, parentEdge ? parentEdge.parentNodeId : null, parentIndex + 1, origin);

  return { edgeId, nodeId: snapshot.childNodeId };
};

export const toggleCollapsedCommand = (
  context: CommandContext,
  edgeId: EdgeId,
  collapsed?: boolean
): boolean => {
  return toggleEdgeCollapsed(context.outline, edgeId, collapsed, context.origin);
};

const getSiblingEdges = (outline: OutlineDoc, parentNodeId: NodeId | null): EdgeId[] => {
  return parentNodeId === null ? outline.rootEdges.toArray() : [...getChildEdgeIds(outline, parentNodeId)];
};
