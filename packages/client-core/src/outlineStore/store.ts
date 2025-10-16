/**
 * Platform-agnostic outline store orchestration. This module composes the sync manager with the
 * session store, keeps awareness state in sync, and exposes a subscription interface that UI
 * adapters (React, mobile, desktop) can consume without duplicating lifecycle code.
 */
import type { Transaction as YTransaction, YEvent, YMapEvent } from "yjs";
import type { AbstractType } from "yjs/dist/src/internals";

import {
  claimBootstrap,
  createSessionStore,
  defaultSessionState,
  defaultPaneSearchState,
  markBootstrapComplete,
  reconcilePaneFocus,
  releaseBootstrapClaim,
  type SessionPaneSearchState,
  type SessionPaneState,
  type SessionState,
  type SessionStore,
  type SessionStorageAdapter
} from "@thortiq/sync-core";

import {
  createOutlineSnapshot,
  getNodeSnapshot,
  reconcileOutlineStructure
} from "../doc/index";
import { addEdge, createNode } from "../doc/index";
import type { OutlineSnapshot, NodeSnapshot } from "../types";
import type { EdgeId, NodeId } from "../ids";
import type { PaneRuntimeState } from "../panes/paneTypes";
import {
  createSyncManager,
  type SyncAwarenessState,
  type SyncManager,
  type SyncManagerOptions,
  type SyncManagerStatus,
  type SyncPresenceSelection
} from "../sync/SyncManager";
import { createUserDocId } from "../sync/docLocator";
import { createSearchIndex } from "../search/index";
import type { SearchExpression, SearchEvaluation } from "../search/types";

export interface OutlinePresenceParticipant {
  readonly clientId: number;
  readonly userId: string;
  readonly displayName: string;
  readonly color: string;
  readonly focusEdgeId: EdgeId | null;
  readonly selection?: SyncPresenceSelection;
  readonly metadata?: Readonly<Record<string, string>>;
  readonly isLocal: boolean;
}

export interface OutlinePresenceSnapshot {
  readonly participants: readonly OutlinePresenceParticipant[];
  readonly byEdgeId: ReadonlyMap<EdgeId, readonly OutlinePresenceParticipant[]>;
}

export interface OutlineStoreOptions {
  readonly docId?: string;
  readonly persistenceFactory: SyncManagerOptions["persistenceFactory"];
  readonly providerFactory: SyncManagerOptions["providerFactory"];
  readonly sessionAdapter: SessionStorageAdapter;
  readonly awarenessDefaults?: SyncAwarenessState;
  readonly autoConnect?: boolean;
  readonly skipDefaultSeed?: boolean;
  readonly seedOutline?: (sync: SyncManager) => void;
  readonly enableAwarenessIndicators?: boolean;
  readonly enableSyncDebugLogging?: boolean;
}

export interface RunPaneSearchOptions {
  readonly query: string;
  readonly expression: SearchExpression;
}

export interface OutlinePaneSearchRuntime {
  readonly query: string;
  readonly evaluation: SearchEvaluation;
  readonly expression: SearchExpression;
  readonly matches: ReadonlySet<EdgeId>;
  readonly ancestorEdgeIds: ReadonlySet<EdgeId>;
  readonly resultEdgeIds: readonly EdgeId[];
}

export interface OutlineStore {
  readonly sync: SyncManager;
  readonly session: SessionStore;
  readonly ready: Promise<void>;
  readonly awarenessIndicatorsEnabled: boolean;
  readonly syncDebugLoggingEnabled: boolean;
  getSnapshot(): OutlineSnapshot;
  subscribe(listener: () => void): () => void;
  getPresenceSnapshot(): OutlinePresenceSnapshot;
  subscribePresence(listener: () => void): () => void;
  getStatus(): SyncManagerStatus;
  subscribeStatus(listener: () => void): () => void;
  runPaneSearch(paneId: string, options: RunPaneSearchOptions): void;
  clearPaneSearch(paneId: string): void;
  toggleSearchExpansion(paneId: string, edgeId: EdgeId): void;
  getPaneSearchRuntime(paneId: string): OutlinePaneSearchRuntime | null;
  getPaneRuntimeState(paneId: string): PaneRuntimeState | null;
  updatePaneRuntimeState(
    paneId: string,
    updater: (current: PaneRuntimeState | null) => PaneRuntimeState | null
  ): void;
  attach(): void;
  detach(): void;
}

interface EdgeArrayLike {
  toArray(): EdgeId[];
}

const SYNC_DOC_ID = createUserDocId({ userId: "local", type: "outline" });
const RECONCILE_ORIGIN = Symbol("outline-reconcile");
const STRUCTURAL_REBUILD_META_KEY = Symbol("outline-structural-rebuild");

const getPaneById = (state: SessionState, paneId: string): SessionPaneState | null =>
  state.panesById[paneId] ?? null;

const getOrderedPanes = (state: SessionState): SessionPaneState[] =>
  state.paneOrder
    .map((paneId) => state.panesById[paneId])
    .filter((pane): pane is SessionPaneState => Boolean(pane));

const findActivePane = (state: SessionState): SessionPaneState | null => {
  const activePane = getPaneById(state, state.activePaneId);
  if (activePane) {
    return activePane;
  }
  for (const paneId of state.paneOrder) {
    const pane = getPaneById(state, paneId);
    if (pane) {
      return pane;
    }
  }
  return null;
};

const createPresenceSelectionFromPane = (
  pane: SessionPaneState | null
): SyncPresenceSelection | undefined => {
  if (!pane) {
    return undefined;
  }
  if (pane.selectionRange) {
    return {
      anchorEdgeId: pane.selectionRange.anchorEdgeId,
      headEdgeId: pane.selectionRange.headEdgeId
    } satisfies SyncPresenceSelection;
  }
  if (pane.activeEdgeId) {
    return {
      anchorEdgeId: pane.activeEdgeId,
      headEdgeId: pane.activeEdgeId
    } satisfies SyncPresenceSelection;
  }
  return undefined;
};

export const createOutlineStore = (options: OutlineStoreOptions): OutlineStore => {
  const persistenceFactory = options.persistenceFactory;
  const providerFactory = options.providerFactory;
  const awarenessDefaults: SyncAwarenessState = options.awarenessDefaults ?? {
    userId: "local",
    displayName: "Local",
    color: "#4f46e5",
    focusEdgeId: null
  };

  const awarenessIndicatorsEnabled = options.enableAwarenessIndicators ?? false;
  const syncDebugLoggingEnabled = options.enableSyncDebugLogging ?? false;

  const storeConfig = {
    autoConnect: options.autoConnect ?? true,
    skipDefaultSeed: options.skipDefaultSeed ?? true,
    seedOutline: options.seedOutline
  } as const;

  const sync = createSyncManager({
    docId: options.docId ?? SYNC_DOC_ID,
    persistenceFactory,
    providerFactory,
    awarenessDefaults
  });
  const session = createSessionStore(options.sessionAdapter, {
    initialState: defaultSessionState()
  });

  const searchIndex = createSearchIndex(sync.outline);
  searchIndex.rebuildFromSnapshot();

  interface PaneSearchRuntimeInternal {
    query: string;
    expression: SearchExpression;
    evaluation: SearchEvaluation;
    matches: Set<EdgeId>;
    ancestors: Set<EdgeId>;
    resultEdgeIds: EdgeId[];
  }

  const paneSearchRuntimes = new Map<string, PaneSearchRuntimeInternal>();
  const paneRuntimeState = new Map<string, PaneRuntimeState>();

  const getPaneRuntimeState = (paneId: string): PaneRuntimeState | null =>
    paneRuntimeState.get(paneId) ?? null;

  // Runtime-only pane metadata lives outside the session store to avoid polluting undo history.
  const updatePaneRuntimeState = (
    paneId: string,
    updater: (current: PaneRuntimeState | null) => PaneRuntimeState | null
  ): void => {
    const previous = paneRuntimeState.get(paneId) ?? null;
    const next = updater(previous);
    if (next === previous) {
      return;
    }
    if (next === null) {
      if (!paneRuntimeState.has(paneId)) {
        return;
      }
      paneRuntimeState.delete(paneId);
      notify();
      return;
    }
    if (
      previous
      && previous.scrollTop === next.scrollTop
      && previous.widthRatio === next.widthRatio
      && previous.lastFocusedEdgeId === next.lastFocusedEdgeId
      && previous.virtualizerVersion === next.virtualizerVersion
    ) {
      return;
    }
    paneRuntimeState.set(paneId, next);
    notify();
  };

  let snapshot = createOutlineSnapshot(sync.outline);
  let pendingNodeRefresh: Set<NodeId> | null = null;
  let nodeRefreshFlushScheduled = false;
  let isOutlineBootstrapped = false;
  const listeners = new Set<() => void>();
  const presenceListeners = new Set<() => void>();
  const statusListeners = new Set<() => void>();
  const teardownCallbacks: Array<() => void> = [];
  let listenersAttached = false;
  let status: SyncManagerStatus = sync.status;

  const log = (...args: Parameters<Console["log"]>) => {
    if (!syncDebugLoggingEnabled) {
      return;
    }
    if (typeof console === "undefined") {
      return;
    }
    if (typeof console.log === "function") {
      console.log(...args);
      return;
    }
    if (typeof console.debug === "function") {
      console.debug(...args);
    }
  };

  const notify = () => {
    listeners.forEach((listener) => listener());
  };

  const notifyPresence = () => {
    presenceListeners.forEach((listener) => listener());
  };

  const notifyStatus = () => {
    statusListeners.forEach((listener) => listener());
  };

  const arraysEqual = (left: ReadonlyArray<EdgeId>, right: ReadonlyArray<EdgeId>): boolean => {
    if (left.length !== right.length) {
      return false;
    }
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index]) {
        return false;
      }
    }
    return true;
  };

  const toOrderedArray = (source: Set<EdgeId>, preferredOrder: readonly EdgeId[]): EdgeId[] => {
    const seen = new Set<EdgeId>();
    const result: EdgeId[] = [];
    preferredOrder.forEach((edgeId) => {
      if (source.has(edgeId) && !seen.has(edgeId)) {
        seen.add(edgeId);
        result.push(edgeId);
      }
    });
    source.forEach((edgeId) => {
      if (!seen.has(edgeId)) {
        seen.add(edgeId);
        result.push(edgeId);
      }
    });
    return result;
  };

  const projectSearchResults = (
    matchesInput: Iterable<EdgeId>
  ): { matches: Set<EdgeId>; ancestors: Set<EdgeId>; ordered: EdgeId[] } => {
    const canonicalEdgeByNodeId = new Map<NodeId, EdgeId>();
    snapshot.edges.forEach((edgeSnapshot, id) => {
      if (edgeSnapshot.canonicalEdgeId === id) {
        canonicalEdgeByNodeId.set(edgeSnapshot.childNodeId, id);
      }
    });

    const matches = new Set<EdgeId>();
    for (const candidate of matchesInput) {
      if (typeof candidate === "string" && snapshot.edges.has(candidate)) {
        matches.add(candidate);
      }
    }

    const ancestors = new Set<EdgeId>();
    matches.forEach((edgeId) => {
      let currentEdgeId: EdgeId | null = edgeId;
      const visited = new Set<EdgeId>();
      while (currentEdgeId) {
        const edge = snapshot.edges.get(currentEdgeId);
        if (!edge) {
          break;
        }
        if (edge.parentNodeId === null) {
          break;
        }
        const parentEdgeId = canonicalEdgeByNodeId.get(edge.parentNodeId) ?? null;
        if (!parentEdgeId) {
          break;
        }
        if (visited.has(parentEdgeId)) {
          break;
        }
        visited.add(parentEdgeId);
        if (!matches.has(parentEdgeId)) {
          ancestors.add(parentEdgeId);
        }
        currentEdgeId = parentEdgeId;
      }
    });

    const includeSet = new Set<EdgeId>();
    matches.forEach((edgeId) => includeSet.add(edgeId));
    ancestors.forEach((edgeId) => includeSet.add(edgeId));

    const ordered: EdgeId[] = [];
    const visited = new Set<EdgeId>();

    const visitEdge = (edgeId: EdgeId) => {
      if (visited.has(edgeId)) {
        return;
      }
      visited.add(edgeId);
      if (!includeSet.has(edgeId)) {
        return;
      }
      ordered.push(edgeId);
      const edge = snapshot.edges.get(edgeId);
      if (!edge) {
        return;
      }
      const childEdgeIds = snapshot.childrenByParent.get(edge.childNodeId) ?? [];
      childEdgeIds.forEach((childEdgeId) => {
        visitEdge(childEdgeId);
      });
    };

    snapshot.rootEdgeIds.forEach((edgeId) => {
      visitEdge(edgeId);
    });

    includeSet.forEach((edgeId) => {
      if (!visited.has(edgeId) && snapshot.edges.has(edgeId)) {
        ordered.push(edgeId);
      }
    });

    return { matches, ancestors, ordered };
  };

  const applySearchProjectionToSession = (
    paneId: string,
    query: string,
    projection: { matches: Set<EdgeId>; ancestors: Set<EdgeId>; ordered: EdgeId[] },
    resetManual: boolean
  ): SessionPaneSearchState | null => {
    let appliedSearch: SessionPaneSearchState | null = null;
    session.update((state) => {
      const pane = getPaneById(state, paneId);
      if (!pane) {
        return state;
      }
      const currentSearch = pane.search ?? defaultPaneSearchState();
      const isEdgeValid = (edgeId: EdgeId) => snapshot.edges.has(edgeId);

      const appendedEdgeIds = resetManual ? [] : currentSearch.appendedEdgeIds.filter(isEdgeValid);

      const manuallyExpandedEdgeIds = resetManual
        ? []
        : currentSearch.manuallyExpandedEdgeIds.filter(isEdgeValid);
      const manuallyCollapsedEdgeIds = resetManual
        ? []
        : currentSearch.manuallyCollapsedEdgeIds.filter(isEdgeValid);

      const resultEdgeIds = (() => {
        const ordered = projection.ordered.slice();
        appendedEdgeIds.forEach((edgeId) => {
          if (!ordered.includes(edgeId) && isEdgeValid(edgeId)) {
            ordered.push(edgeId);
          }
        });
        return ordered;
      })();

      const nextSearch: SessionPaneSearchState = {
        ...currentSearch,
        submitted: query,
        isInputVisible: true,
        resultEdgeIds,
        manuallyExpandedEdgeIds,
        manuallyCollapsedEdgeIds,
        appendedEdgeIds
      };

      const changed =
        nextSearch.submitted !== currentSearch.submitted
        || nextSearch.isInputVisible !== currentSearch.isInputVisible
        || !arraysEqual(nextSearch.resultEdgeIds, currentSearch.resultEdgeIds)
        || !arraysEqual(nextSearch.manuallyExpandedEdgeIds, currentSearch.manuallyExpandedEdgeIds)
        || !arraysEqual(nextSearch.manuallyCollapsedEdgeIds, currentSearch.manuallyCollapsedEdgeIds)
        || !arraysEqual(nextSearch.appendedEdgeIds, currentSearch.appendedEdgeIds);

      if (!changed) {
        return state;
      }

      appliedSearch = nextSearch;
      const nextPane: SessionPaneState = {
        ...pane,
        search: nextSearch
      };
      return {
        ...state,
        panesById: {
          ...state.panesById,
          [paneId]: nextPane
        }
      };
    });
    return appliedSearch;
  };

  const synchronisePaneRuntime = (
    paneId: string,
    runtime: PaneSearchRuntimeInternal,
    matchesIterable: Iterable<EdgeId>,
    evaluation: SearchEvaluation | null,
    resetManual: boolean
  ): void => {
    const projection = projectSearchResults(matchesIterable);
    runtime.matches = projection.matches;
    runtime.ancestors = projection.ancestors;
    if (evaluation) {
      runtime.evaluation = evaluation;
    }
    const updatedSearch = applySearchProjectionToSession(paneId, runtime.query, projection, resetManual);
    const finalSearch =
      updatedSearch
      ?? (() => {
        const state = session.getState();
        const pane = getPaneById(state, paneId);
        return pane?.search ?? null;
      })();
    if (!finalSearch) {
      paneSearchRuntimes.delete(paneId);
      runtime.resultEdgeIds = projection.ordered.slice();
      return;
    }
    runtime.resultEdgeIds = finalSearch.resultEdgeIds.slice();
  };

  const reconcilePaneSearchAfterStructuralChange = () => {
    paneSearchRuntimes.forEach((runtime, paneId) => {
      synchronisePaneRuntime(paneId, runtime, runtime.matches, null, false);
    });
  };

  const flushPendingNodeRefresh = () => {
    nodeRefreshFlushScheduled = false;
    const queuedIds = pendingNodeRefresh;
    if (!queuedIds || queuedIds.size === 0) {
      pendingNodeRefresh = null;
      return;
    }
    pendingNodeRefresh = null;

    const nextNodes = new Map<NodeId, NodeSnapshot>(snapshot.nodes);
    let nodesChanged = false;
    queuedIds.forEach((nodeId) => {
      if (sync.outline.nodes.has(nodeId)) {
        const nodeSnapshot = getNodeSnapshot(sync.outline, nodeId);
        nextNodes.set(nodeId, nodeSnapshot);
        nodesChanged = true;
        return;
      }
      if (nextNodes.delete(nodeId)) {
        nodesChanged = true;
      }
    });

    if (!nodesChanged) {
      return;
    }

    snapshot = {
      ...snapshot,
      nodes: nextNodes as ReadonlyMap<NodeId, NodeSnapshot>
    } satisfies OutlineSnapshot;
    notify();
  };

  const scheduleNodeRefreshFlush = () => {
    if (nodeRefreshFlushScheduled) {
      return;
    }
    nodeRefreshFlushScheduled = true;
    queueMicrotask(flushPendingNodeRefresh);
  };

  const handleNodesDeepChange = (
    events: ReadonlyArray<YEvent<AbstractType<unknown>>>,
    transaction: YTransaction
  ) => {
    if (transaction.meta.get(STRUCTURAL_REBUILD_META_KEY)) {
      return;
    }

    events.forEach((event) => {
      searchIndex.applyTransactionalUpdates(event);
    });

    const changedNodeIds = new Set<NodeId>();
    events.forEach((event) => {
      if (event.target === sync.outline.nodes) {
        return;
      }
      if (event.path.length === 0) {
        return;
      }
      const candidate = event.path[0];
      if (typeof candidate === "string") {
        changedNodeIds.add(candidate as NodeId);
      }
    });

    if (changedNodeIds.size === 0) {
      return;
    }

    if (!pendingNodeRefresh) {
      pendingNodeRefresh = new Set<NodeId>();
    }
    changedNodeIds.forEach((nodeId) => {
      pendingNodeRefresh?.add(nodeId);
    });
    scheduleNodeRefreshFlush();
  };

  const mapAwarenessState = (
    clientId: number,
    state: Partial<SyncAwarenessState>
  ): OutlinePresenceParticipant => {
    const userId = typeof state.userId === "string" && state.userId.length > 0 ? state.userId : `client:${clientId}`;
    const displayName =
      typeof state.displayName === "string" && state.displayName.length > 0 ? state.displayName : userId;
    const color = typeof state.color === "string" && state.color.length > 0 ? state.color : "#6b7280";
    const focusEdgeId = typeof state.focusEdgeId === "string" ? (state.focusEdgeId as EdgeId) : null;
    const selection = state.selection && typeof state.selection === "object" ? state.selection : undefined;
    const metadata = state.metadata && typeof state.metadata === "object" ? state.metadata : undefined;
    return {
      clientId,
      userId,
      displayName,
      color,
      focusEdgeId,
      selection,
      metadata,
      isLocal: clientId === sync.awareness.clientID
    } satisfies OutlinePresenceParticipant;
  };

  const computePresenceSnapshot = (): OutlinePresenceSnapshot => {
    const states = sync.awareness.getStates();
    const participants: OutlinePresenceParticipant[] = [];
    const byEdgeId = new Map<EdgeId, OutlinePresenceParticipant[]>();
    states.forEach((value, clientId) => {
      if (!value) {
        return;
      }
      const participant = mapAwarenessState(clientId, value as Partial<SyncAwarenessState>);
      participants.push(participant);
      if (participant.focusEdgeId) {
        const list = byEdgeId.get(participant.focusEdgeId) ?? [];
        list.push(participant);
        byEdgeId.set(participant.focusEdgeId, list);
      }
    });
    const frozenByEdgeId = new Map<EdgeId, readonly OutlinePresenceParticipant[]>();
    byEdgeId.forEach((value, key) => {
      frozenByEdgeId.set(key, value.slice());
    });
    return {
      participants,
      byEdgeId: frozenByEdgeId
    } satisfies OutlinePresenceSnapshot;
  };

  let presenceSnapshot = computePresenceSnapshot();

  const syncSessionSelectionToAwareness = (): void => {
    const state = session.getState();
    const activePane = findActivePane(state);
    const focusEdgeId = activePane?.activeEdgeId ?? null;
    const selection = createPresenceSelectionFromPane(activePane);
    sync.updateAwareness({
      focusEdgeId,
      selection
    });
  };

  const ensureSessionStateValid = () => {
    const state = session.getState();
    const orderedPanes = getOrderedPanes(state);
    const snapshotReady = isOutlineBootstrapped;
    if (snapshotReady && orderedPanes.some((pane) => pane.rootEdgeId || pane.focusPathEdgeIds?.length)) {
      const availableEdgeIds = new Set<EdgeId>();
      snapshot.edges.forEach((_edge, edgeId) => {
        availableEdgeIds.add(edgeId);
      });
      reconcilePaneFocus(session, availableEdgeIds);
    }

    const fallbackEdgeId = snapshotReady ? snapshot.rootEdgeIds[0] ?? null : null;
    session.update((existing) => {
      if (existing.paneOrder.length === 0) {
        return existing;
      }

      let panesChanged = false;
      let panesById: Record<string, SessionPaneState> | null = null;

      const ensureMutable = () => {
        if (!panesById) {
          panesById = { ...existing.panesById };
        }
        return panesById;
      };

      existing.paneOrder.forEach((paneId) => {
        const pane = existing.panesById[paneId];
        if (!pane) {
          return;
        }

        let activeEdgeId = pane.activeEdgeId;
        let selectionRange = pane.selectionRange;
        let pendingFocusEdgeId: EdgeId | null | undefined = pane.pendingFocusEdgeId;
        let nextCollapsedEdgeIds = pane.collapsedEdgeIds;
        let collapsedChanged = false;

        if (snapshotReady) {
          if (activeEdgeId && !snapshot.edges.has(activeEdgeId)) {
            activeEdgeId = null;
          }
          if (!activeEdgeId) {
            activeEdgeId = fallbackEdgeId;
          }

          if (
            selectionRange
            && (!snapshot.edges.has(selectionRange.anchorEdgeId) || !snapshot.edges.has(selectionRange.headEdgeId))
          ) {
            selectionRange = undefined;
          }

          if (pendingFocusEdgeId && !snapshot.edges.has(pendingFocusEdgeId)) {
            pendingFocusEdgeId = null;
          }

          const filteredCollapsed = pane.collapsedEdgeIds.filter((edgeId) => snapshot.edges.has(edgeId));
          collapsedChanged =
            filteredCollapsed.length !== pane.collapsedEdgeIds.length
            || filteredCollapsed.some((edgeId, index) => edgeId !== pane.collapsedEdgeIds[index]);
          if (collapsedChanged) {
            nextCollapsedEdgeIds = filteredCollapsed;
          }
        }

        if (
          activeEdgeId === pane.activeEdgeId
          && selectionRange === pane.selectionRange
          && pendingFocusEdgeId === pane.pendingFocusEdgeId
          && !collapsedChanged
        ) {
          return;
        }

        panesChanged = true;
        ensureMutable()[paneId] = {
          ...pane,
          activeEdgeId: activeEdgeId ?? null,
          ...(selectionRange ? { selectionRange } : { selectionRange: undefined }),
          ...(pendingFocusEdgeId !== undefined ? { pendingFocusEdgeId } : {}),
          collapsedEdgeIds: nextCollapsedEdgeIds
        } satisfies SessionPaneState;
      });

      const currentPanesById = panesById ?? existing.panesById;
      let activePaneId = existing.activePaneId;
      const orderedExistingPanes = existing.paneOrder
        .map((paneId) => currentPanesById[paneId])
        .filter((pane): pane is SessionPaneState => Boolean(pane));

      if (!orderedExistingPanes.some((pane) => pane.paneId === activePaneId)) {
        activePaneId = orderedExistingPanes[0]?.paneId ?? activePaneId;
      }

      let selectedEdgeId = existing.selectedEdgeId;
      if (snapshotReady && selectedEdgeId && !snapshot.edges.has(selectedEdgeId)) {
        selectedEdgeId = null;
      }

      const activePane =
        (activePaneId ? currentPanesById[activePaneId] : null) ?? orderedExistingPanes[0] ?? null;
      const activeEdgeId = activePane?.activeEdgeId ?? null;
      if (activeEdgeId !== selectedEdgeId) {
        if (activeEdgeId !== null) {
          selectedEdgeId = activeEdgeId;
        } else if (snapshotReady) {
          selectedEdgeId = selectedEdgeId ?? fallbackEdgeId ?? null;
        }
      }

      if (!panesChanged && activePaneId === existing.activePaneId && selectedEdgeId === existing.selectedEdgeId) {
        return existing;
      }

      return {
        ...existing,
        panesById: panesById ?? existing.panesById,
        activePaneId,
        selectedEdgeId
      } satisfies SessionState;
    });
  };

  const handleStatusChange = (nextStatus: SyncManagerStatus) => {
    if (status === nextStatus) {
      return;
    }
    status = nextStatus;
    notifyStatus();
  };

  ensureSessionStateValid();
  const unsubscribeSession = session.subscribe(syncSessionSelectionToAwareness);
  teardownCallbacks.push(unsubscribeSession);
  const unsubscribeStatus = sync.onStatusChange(handleStatusChange);
  teardownCallbacks.push(unsubscribeStatus);
  syncSessionSelectionToAwareness();
  presenceSnapshot = computePresenceSnapshot();

  const handleAwarenessUpdate = () => {
    presenceSnapshot = computePresenceSnapshot();
    notifyPresence();
  };

  log("[outline-store]", "store created", { clientId: sync.doc.clientID });

  const ready = (async () => {
    await sync.ready;

    const claim = claimBootstrap(sync.outline, sync.localOrigin);
    if (claim.claimed) {
      try {
        if (!storeConfig.skipDefaultSeed) {
          seedDefaultOutline(sync);
        }
        storeConfig.seedOutline?.(sync);
        markBootstrapComplete(sync.outline, sync.localOrigin);
      } catch (error) {
        releaseBootstrapClaim(sync.outline, sync.localOrigin);
        throw error;
      }
    }
    snapshot = createOutlineSnapshot(sync.outline);
    searchIndex.rebuildFromSnapshot();
    reconcilePaneSearchAfterStructuralChange();
    isOutlineBootstrapped = true;
    ensureSessionStateValid();
    if (storeConfig.autoConnect) {
      void sync.connect().catch((error) => {
        if (typeof console !== "undefined" && typeof console.error === "function") {
          console.error("[outline-store] failed to connect provider", error);
        }
      });
    }
  })();

  const analyseStructuralChange = (transaction: YTransaction) => {
    const touchedEdges = new Set<EdgeId>();
    let structuralChangeDetected = false;
    const registerTouchedEdge = (candidate: unknown) => {
      if (typeof candidate === "string") {
        touchedEdges.add(candidate as EdgeId);
      }
    };

    transaction.changed.forEach((keys, type) => {
      if (type === (sync.outline.edges as unknown as typeof type)) {
        structuralChangeDetected = true;
        keys.forEach((key) => {
          registerTouchedEdge(key);
        });
        return;
      }

      if (type === (sync.outline.childEdgeMap as unknown as typeof type)) {
        structuralChangeDetected = true;
      }
    });

    const childArrayOwners = new Map<unknown, NodeId>();
    sync.outline.childEdgeMap.forEach((array, parentNodeId) => {
      childArrayOwners.set(array, parentNodeId as NodeId);
    });

    transaction.changedParentTypes.forEach((events, type) => {
      if (type === sync.outline.rootEdges) {
        structuralChangeDetected = true;
        sync.outline.rootEdges.toArray().forEach((edgeId) => {
          registerTouchedEdge(edgeId);
        });
        events.forEach((event) => {
          event.changes.delta.forEach((delta) => {
            const inserted = delta.insert;
            if (Array.isArray(inserted)) {
              inserted.forEach((value) => {
                registerTouchedEdge(value);
              });
              return;
            }
            registerTouchedEdge(inserted);
          });
        });
        return;
      }

      if (type === (sync.outline.edges as unknown as typeof type)) {
        structuralChangeDetected = true;
        events.forEach((event) => {
          const mapEvent = event as YMapEvent<unknown>;
          mapEvent.keysChanged.forEach((key) => {
            registerTouchedEdge(key);
          });
          if (event.path.length > 0) {
            registerTouchedEdge(event.path[0]);
          }
        });
        return;
      }

      if (!childArrayOwners.has(type)) {
        return;
      }

      structuralChangeDetected = true;
      const array = type as unknown as EdgeArrayLike;
      array.toArray().forEach((edgeId) => {
        registerTouchedEdge(edgeId);
      });
      events.forEach((event) => {
        event.changes.delta.forEach((delta) => {
          const inserted = delta.insert;
          if (Array.isArray(inserted)) {
            inserted.forEach((value) => {
              registerTouchedEdge(value);
            });
            return;
          }
          registerTouchedEdge(inserted);
        });
      });
    });

    return { structuralChangeDetected, touchedEdges } as const;
  };

  const handleDocAfterTransaction = (transaction: YTransaction) => {
    const changedParents = Array.from(transaction.changedParentTypes.keys()).map((type) => type.constructor.name);
    log("[outline-store]", "afterTransaction", {
      origin: transaction.origin,
      local: transaction.local,
      changedParents
    });

    const { structuralChangeDetected, touchedEdges } = analyseStructuralChange(transaction);

    if (!structuralChangeDetected) {
      return;
    }

    transaction.meta.set(STRUCTURAL_REBUILD_META_KEY, true);
    snapshot = createOutlineSnapshot(sync.outline);
    searchIndex.rebuildFromSnapshot();
    reconcilePaneSearchAfterStructuralChange();
    notify();

    if (touchedEdges.size === 0) {
      ensureSessionStateValid();
      return;
    }

    const updatesApplied = reconcileOutlineStructure(sync.outline, {
      edgeFilter: touchedEdges,
      origin: RECONCILE_ORIGIN
    });

    if (updatesApplied > 0) {
      snapshot = createOutlineSnapshot(sync.outline);
      searchIndex.rebuildFromSnapshot();
      reconcilePaneSearchAfterStructuralChange();
      notify();
    }

    ensureSessionStateValid();
  };

  const attachListeners = () => {
    if (listenersAttached) {
      return;
    }
    listenersAttached = true;
    sync.outline.doc.on("afterTransaction", handleDocAfterTransaction);
    sync.awareness.on("change", handleAwarenessUpdate);
    sync.outline.nodes.observeDeep(handleNodesDeepChange);
  };

  const detachListeners = () => {
    if (!listenersAttached) {
      return;
    }
    listenersAttached = false;
    sync.outline.doc.off("afterTransaction", handleDocAfterTransaction);
    sync.awareness.off("change", handleAwarenessUpdate);
    sync.outline.nodes.unobserveDeep(handleNodesDeepChange);
  };

  const runPaneSearch = (paneId: string, options: RunPaneSearchOptions): void => {
    const { query, expression } = options;
    const queryResult = searchIndex.runQuery(expression);
    const existingRuntime = paneSearchRuntimes.get(paneId);
    const runtime: PaneSearchRuntimeInternal = existingRuntime ?? {
      query,
      expression,
      evaluation: queryResult.evaluation,
      matches: new Set<EdgeId>(),
      ancestors: new Set<EdgeId>(),
      resultEdgeIds: []
    };
    const previousQuery = existingRuntime?.query ?? null;
    runtime.query = query;
    runtime.expression = expression;
    runtime.evaluation = queryResult.evaluation;
    paneSearchRuntimes.set(paneId, runtime);
    const resetManual = previousQuery === null || previousQuery !== query;
    synchronisePaneRuntime(paneId, runtime, queryResult.matches, queryResult.evaluation, resetManual);
  };

  const clearPaneSearch = (paneId: string): void => {
    paneSearchRuntimes.delete(paneId);
    session.update((state) => {
      const pane = getPaneById(state, paneId);
      if (!pane) {
        return state;
      }
      const currentSearch = pane.search ?? defaultPaneSearchState();
      const nextSearch: SessionPaneSearchState = {
        ...defaultPaneSearchState(),
        isInputVisible: currentSearch.isInputVisible
      };
      if (
        currentSearch.draft === nextSearch.draft
        && currentSearch.submitted === nextSearch.submitted
        && currentSearch.isInputVisible === nextSearch.isInputVisible
        && arraysEqual(currentSearch.resultEdgeIds, nextSearch.resultEdgeIds)
        && arraysEqual(currentSearch.manuallyExpandedEdgeIds, nextSearch.manuallyExpandedEdgeIds)
        && arraysEqual(currentSearch.manuallyCollapsedEdgeIds, nextSearch.manuallyCollapsedEdgeIds)
        && arraysEqual(currentSearch.appendedEdgeIds, nextSearch.appendedEdgeIds)
      ) {
        return state;
      }
      const nextPane: SessionPaneState = {
        ...pane,
        search: nextSearch
      };
      return {
        ...state,
        panesById: {
          ...state.panesById,
          [paneId]: nextPane
        }
      };
    });
  };

  const toggleSearchExpansion = (paneId: string, edgeId: EdgeId): void => {
    session.update((state) => {
      const pane = getPaneById(state, paneId);
      if (!pane) {
        return state;
      }
      const currentSearch = pane.search ?? defaultPaneSearchState();
      if (!currentSearch.submitted) {
        return state;
      }
      if (
        currentSearch.resultEdgeIds.indexOf(edgeId) === -1
        && currentSearch.appendedEdgeIds.indexOf(edgeId) === -1
      ) {
        return state;
      }
      const expandedSet = new Set<EdgeId>(currentSearch.manuallyExpandedEdgeIds);
      const collapsedSet = new Set<EdgeId>(currentSearch.manuallyCollapsedEdgeIds);

      if (!expandedSet.has(edgeId) && !collapsedSet.has(edgeId)) {
        expandedSet.add(edgeId);
      } else if (expandedSet.has(edgeId)) {
        expandedSet.delete(edgeId);
        collapsedSet.add(edgeId);
      } else {
        collapsedSet.delete(edgeId);
      }

      const nextSearch: SessionPaneSearchState = {
        ...currentSearch,
        manuallyExpandedEdgeIds: toOrderedArray(expandedSet, currentSearch.manuallyExpandedEdgeIds),
        manuallyCollapsedEdgeIds: toOrderedArray(collapsedSet, currentSearch.manuallyCollapsedEdgeIds)
      };

      if (
        arraysEqual(nextSearch.manuallyExpandedEdgeIds, currentSearch.manuallyExpandedEdgeIds)
        && arraysEqual(nextSearch.manuallyCollapsedEdgeIds, currentSearch.manuallyCollapsedEdgeIds)
      ) {
        return state;
      }

      const nextPane: SessionPaneState = {
        ...pane,
        search: nextSearch
      };
      return {
        ...state,
        panesById: {
          ...state.panesById,
          [paneId]: nextPane
        }
      };
    });
  };

  const getPaneSearchRuntime = (paneId: string): OutlinePaneSearchRuntime | null => {
    const runtime = paneSearchRuntimes.get(paneId);
    if (!runtime) {
      return null;
    }
    return {
      query: runtime.query,
      evaluation: runtime.evaluation,
      expression: runtime.expression,
      matches: new Set(runtime.matches),
      ancestorEdgeIds: new Set(runtime.ancestors),
      resultEdgeIds: runtime.resultEdgeIds.slice()
    };
  };

  const getSnapshot = () => snapshot;
  const getPresenceSnapshot = () => presenceSnapshot;
  const getStatus = () => status;

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  const subscribePresence = (listener: () => void): (() => void) => {
    presenceListeners.add(listener);
    return () => presenceListeners.delete(listener);
  };

  const subscribeStatus = (listener: () => void): (() => void) => {
    statusListeners.add(listener);
    return () => statusListeners.delete(listener);
  };

  return {
    sync,
    session,
    ready,
    awarenessIndicatorsEnabled,
    syncDebugLoggingEnabled,
    getSnapshot,
    subscribe,
    getPresenceSnapshot,
    subscribePresence,
    getStatus,
    subscribeStatus,
    runPaneSearch,
    clearPaneSearch,
    toggleSearchExpansion,
    getPaneSearchRuntime,
    getPaneRuntimeState,
    updatePaneRuntimeState,
    attach: attachListeners,
    detach: () => {
      detachListeners();
      teardownCallbacks.splice(0, teardownCallbacks.length).forEach((teardown) => {
        try {
          teardown();
        } catch (error) {
          if (typeof console !== "undefined" && typeof console.error === "function") {
            console.error("[outline-store] teardown failed", error);
          }
        }
      });
    }
  } satisfies OutlineStore;
};

export const seedDefaultOutline = (sync: SyncManager): void => {
  const { outline, localOrigin } = sync;

  const createSeedNode = (text: string) =>
    createNode(outline, {
      text,
      origin: localOrigin
    });

  const welcomeNode = createSeedNode("Welcome to Thortiq");
  addEdge(outline, { parentNodeId: null, childNodeId: welcomeNode, origin: localOrigin });

  const instructionsNode = createSeedNode("Phase 1 focuses on the collaborative outliner core.");
  addEdge(outline, { parentNodeId: welcomeNode, childNodeId: instructionsNode, origin: localOrigin });

  const virtualizationNode = createSeedNode(
    "Scroll to see TanStack Virtual keeping the outline performant."
  );
  addEdge(outline, { parentNodeId: welcomeNode, childNodeId: virtualizationNode, origin: localOrigin });

  const syncNode = createSeedNode(
    "All text and structural changes flow through the unified Yjs document."
  );
  addEdge(outline, { parentNodeId: welcomeNode, childNodeId: syncNode, origin: localOrigin });
};
