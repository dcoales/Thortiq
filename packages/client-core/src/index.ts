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
  getNodeTextFragment,
  getParentEdgeId,
  getRootEdgeIds,
  nodeExists,
  outlineFromDoc,
  reconcileOutlineStructure,
  setNodeText,
  moveEdge,
  toggleEdgeCollapsed,
  updateNodeMetadata,
  withTransaction
} from "./doc";

export {
  buildOutlineForest,
  buildPaneRows,
  getSnapshotChildEdgeIds,
  planBreadcrumbVisibility
} from "./selectors";

export type {
  BreadcrumbDisplayPlan,
  BreadcrumbMeasurement,
  PaneFocusContext,
  PaneFocusPathSegment,
  PaneOutlineRow,
  PaneRowsResult,
  PaneStateLike
} from "./selectors";

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

export type { ReconcileOutlineStructureOptions } from "./doc";

export type {
  SyncManager,
  SyncManagerOptions,
  SyncManagerEvent,
  SyncManagerObservers,
  SyncManagerStatus,
  SyncProviderStatus,
  SyncProviderAdapter,
  SyncProviderContext,
  SyncProviderError,
  SyncPersistenceAdapter,
  SyncPersistenceContext,
  SyncAwarenessState,
  SyncPresenceSelection,
  SyncReconnectOptions
} from "./sync/SyncManager";

export { createSyncManager } from "./sync/SyncManager";
export { createEphemeralPersistenceFactory } from "./sync/persistence";
export { createEphemeralProviderFactory } from "./sync/ephemeralProvider";
