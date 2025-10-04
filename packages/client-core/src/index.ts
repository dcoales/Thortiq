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
  removeEdge,
  toggleEdgeCollapsed,
  updateNodeMetadata,
  updateTodoDoneStates,
  updateWikiLinkDisplayText,
  withTransaction,
  type RemoveEdgeOptions,
  type TodoDoneUpdate
} from "./doc/index";

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
  InlineMark,
  InlineSpan,
  NodeMetadata,
  NodeSnapshot,
  OutlineDoc,
  OutlineSnapshot,
  OutlineTreeNode
} from "./types";

export type { ReconcileOutlineStructureOptions } from "./doc/index";

export {
  createOutlineStore,
  seedDefaultOutline
} from "./outlineStore";
export type {
  OutlinePresenceParticipant,
  OutlinePresenceSnapshot,
  OutlineStore,
  OutlineStoreOptions
} from "./outlineStore";

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

export {
  outlineCommandDescriptors,
  matchOutlineCommand
} from "./commands/outlineCommands";
export type {
  OutlineCommandId,
  OutlineCommandDescriptor,
  OutlineCommandMatch,
  OutlineCommandCategory,
  OutlineCommandBinding,
  OutlineKeyStrokeInit
} from "./commands/outlineCommands";

export {
  searchWikiLinkCandidates,
  type WikiLinkBreadcrumbSegment,
  type WikiLinkSearchCandidate,
  type WikiLinkSearchOptions
} from "./wiki";
