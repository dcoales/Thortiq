export {
  OutlineError,
  createOutlineDoc,
  outlineFromDoc,
  withTransaction
} from "./transactions";
export type { CreateOutlineDocResult } from "./transactions";

export {
  createNode,
  getNodeMetadata,
  getNodeSnapshot,
  getNodeText,
  getNodeTextFragment,
  nodeExists,
  setNodeText,
  syncTagsFromFragment,
  updateNodeMetadata,
  updateTodoDoneStates,
  updateWikiLinkDisplayText
} from "./nodes";
export type { TodoDoneUpdate } from "./nodes";

export {
  addEdge,
  edgeExists,
  getChildEdgeIds,
  getEdgeSnapshot,
  getParentEdgeId,
  getRootEdgeIds,
  moveEdge,
  reconcileOutlineStructure,
  removeEdge,
  toggleEdgeCollapsed
} from "./edges";
export type { RemoveEdgeOptions, ReconcileOutlineStructureOptions } from "./edges";

export { createOutlineSnapshot } from "./snapshots";
