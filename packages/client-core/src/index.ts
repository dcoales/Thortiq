/**
 * Thortiq client-core exposes the collaborative outline domain model. It owns identifier
 * generation, Yjs document scaffolding, mutation guards (e.g. cycle prevention), and pure
 * snapshot selectors consumed by higher-level adapters.
 */
export {
  OutlineError,
  addEdge,
  createNode,
  createOutlineDoc,
  createOutlineSnapshot,
  edgeExists,
  getChildEdgeIds,
  getEdgeSnapshot,
  getNodeMetadata,
  getNodeSnapshot,
  getNodeText,
  getRootEdgeIds,
  nodeExists,
  outlineFromDoc,
  setNodeText,
  updateNodeMetadata,
  withTransaction
} from "./doc";

export { buildOutlineForest, getSnapshotChildEdgeIds } from "./selectors";

export { createEdgeId, createNodeId, isSameNode } from "./ids";
export type { EdgeId, NodeId } from "./ids";

export type {
  AddEdgeOptions,
  CreateNodeOptions,
  EdgeSnapshot,
  EdgeState,
  NodeMetadata,
  NodeSnapshot,
  OutlineDoc,
  OutlineSnapshot,
  OutlineTreeNode
} from "./types";
