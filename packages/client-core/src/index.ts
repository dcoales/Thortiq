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
  getTagRegistryEntry,
  getParentEdgeId,
  getRootEdgeIds,
  nodeExists,
  setNodeLayout,
  setNodeHeadingLevel,
  outlineUsesTag,
  normalizeTagId,
  outlineFromDoc,
  reconcileOutlineStructure,
  removeTagRegistryEntry,
  setNodeText,
  clearNodeFormatting,
  moveEdge,
  removeEdge,
  selectTagsByCreatedAt,
  toggleEdgeCollapsed,
  touchTagRegistryEntry,
  touchTagRegistryEntryInScope,
  updateNodeMetadata,
  updateTodoDoneStates,
  updateWikiLinkDisplayText,
  upsertTagRegistryEntry,
  withTransaction,
  type RemoveEdgeOptions,
  type TodoDoneUpdate,
  type TouchTagRegistryEntryOptions,
  type UpsertTagRegistryEntryOptions
} from "./doc/index";

export {
  createMirrorEdge,
  type CreateMirrorEdgeOptions,
  type CreateMirrorEdgeResult,
  type MirrorCreationMode
} from "./mirror";

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
  PaneStateLike,
  PaneSearchStateLike,
  PaneOutlineRowSearchMeta,
  PaneSearchRuntimeLike
} from "./selectors";

export {
  SEARCH_INDEX_FIELDS,
  SEARCH_INDEX_FIELDS_BY_ID
} from "./search/types";
export type {
  SearchBinaryExpression,
  SearchCompiledComparableBoundary,
  SearchCompiledDateValue,
  SearchCompiledPathValue,
  SearchCompiledRangeValue,
  SearchCompiledStringValue,
  SearchCompiledTagValue,
  SearchCompiledTypeValue,
  SearchCompiledValue,
  SearchComparablePrimitive,
  SearchComparator,
  SearchDateLiteral,
  SearchEvaluation,
  SearchExpression,
  SearchField,
  SearchFilterDescriptor,
  SearchGroupExpression,
  SearchIndexFieldDescriptor,
  SearchIndexFieldType,
  SearchLiteral,
  SearchLiteralKind,
  SearchNotExpression,
  SearchPredicateExpression,
  SearchRangeLiteral,
  SearchStringLiteral
} from "./search/types";
export { createSearchIndex } from "./search/index";
export type { SearchIndex, SearchIndexQueryResult } from "./search/index";
export { parseSearchQuery } from "./search/queryParser";
export type { ParseError, ParseResult } from "./search/queryParser";
export {
  formatTagFilter,
  toggleTagFilterInQuery,
  type ToggleTagFilterResult
} from "./search/tagFilters";

export { createEdgeId, createEdgeInstanceId, createNodeId, isSameNode } from "./ids";
export type { EdgeId, EdgeInstanceId, NodeId } from "./ids";

export {
  DEFAULT_COLOR_SWATCHES,
  addColorPaletteSwatch,
  getColorPalette,
  removeColorPaletteSwatch,
  replaceColorPalette,
  resetColorPalette,
  updateColorPaletteSwatch,
  getInboxNodeId,
  getJournalNodeId,
  getInboxSnapshot,
  getJournalSnapshot,
  setInboxNodeId,
  setJournalNodeId,
  clearInboxNode,
  clearJournalNode,
  type AddColorPaletteSwatchOptions,
  type ColorPaletteSnapshot,
  type PaletteMutationOptions,
  type RemoveColorPaletteSwatchOptions,
  type ReplaceColorPaletteOptions,
  type ResetColorPaletteOptions,
  type UpdateColorPaletteSwatchOptions
} from "./preferences";

export type {
  AddEdgeOptions,
  CreateNodeOptions,
  EdgeSnapshot,
  EdgeState,
  InlineMark,
  InlineSpan,
  NodeHeadingLevel,
  NodeLayout,
  NodeMetadata,
  NodeSnapshot,
  OutlineDoc,
  OutlineSnapshot,
  OutlineTreeNode,
  TagRegistryEntry,
  TagTrigger
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
  OutlineStoreOptions,
  OutlinePaneSearchRuntime,
  RunPaneSearchOptions
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
  isOutlineContextMenuCommand,
  isOutlineContextMenuSeparator,
  isOutlineContextMenuSubmenu,
  flattenOutlineContextMenuTree
} from "./contextMenu";
export type {
  OutlineContextMenuCommandDescriptor,
  OutlineContextMenuCommandId,
  OutlineContextMenuCommandResult,
  OutlineContextMenuCommandRunner,
  OutlineContextMenuEnablePredicate,
  OutlineContextMenuExecutionContext,
  OutlineContextMenuInvocationSource,
  OutlineContextMenuNode,
  OutlineContextMenuNodeType,
  OutlineContextMenuSelectionMode,
  OutlineContextMenuSelectionSnapshot,
  OutlineContextMenuSeparatorDescriptor,
  OutlineContextMenuSeparatorId,
  OutlineContextMenuSubmenuDescriptor,
  OutlineContextMenuSubmenuId
} from "./contextMenu";

export { EDGE_MIRROR_KEY } from "./doc/constants";

export {
  searchWikiLinkCandidates,
  searchMirrorCandidates,
  type WikiLinkBreadcrumbSegment,
  type WikiLinkSearchCandidate,
  type WikiLinkSearchOptions,
  type MirrorSearchCandidate,
  type MirrorSearchOptions
} from "./wiki";
