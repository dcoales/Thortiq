/**
 * Platform-agnostic outline store orchestration. This module composes the sync manager with the
 * session store, keeps awareness state in sync, and exposes a subscription interface that UI
 * adapters (React, mobile, desktop) can consume without duplicating lifecycle code.
 */
import type { Transaction as YTransaction, YEvent } from "yjs";
import type { AbstractType } from "yjs/dist/src/internals";

import {
  claimBootstrap,
  createSessionStore,
  defaultSessionState,
  markBootstrapComplete,
  reconcilePaneFocus,
  releaseBootstrapClaim,
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
import {
  createSyncManager,
  type SyncAwarenessState,
  type SyncManager,
  type SyncManagerOptions,
  type SyncManagerStatus,
  type SyncPresenceSelection
} from "../sync/SyncManager";
import { OutlineSearchIndex } from "../search/index";
import { executeOutlineSearch } from "../search/execute";
import type { OutlineSearchExecution, OutlineSearchIndexSnapshot } from "../search/types";

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
  getSearchIndexSnapshot(): OutlineSearchIndexSnapshot;
  subscribeSearchIndex(listener: () => void): () => void;
  runSearch(query: string): OutlineSearchExecution;
  attach(): void;
  detach(): void;
}

interface EdgeArrayLike {
  toArray(): EdgeId[];
}

const SYNC_DOC_ID = "primary";
const RECONCILE_ORIGIN = Symbol("outline-reconcile");
const STRUCTURAL_REBUILD_META_KEY = Symbol("outline-structural-rebuild");

const findActivePane = (state: SessionState): SessionPaneState | null => {
  if (state.panes.length === 0) {
    return null;
  }
  const activePane = state.panes.find((pane) => pane.paneId === state.activePaneId);
  return activePane ?? state.panes[0] ?? null;
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
    skipDefaultSeed: options.skipDefaultSeed ?? false,
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

  let snapshot = createOutlineSnapshot(sync.outline);
  let searchIndex = OutlineSearchIndex.fromSnapshot(snapshot);
  let pendingNodeRefresh: Set<NodeId> | null = null;
  let nodeRefreshFlushScheduled = false;
  let isOutlineBootstrapped = false;
  const listeners = new Set<() => void>();
  const presenceListeners = new Set<() => void>();
  const statusListeners = new Set<() => void>();
  const searchListeners = new Set<() => void>();
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

  const notifySearchIndex = () => {
    searchListeners.forEach((listener) => listener());
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
    let indexChanged = false;
    queuedIds.forEach((nodeId) => {
      if (sync.outline.nodes.has(nodeId)) {
        const nodeSnapshot = getNodeSnapshot(sync.outline, nodeId);
        nextNodes.set(nodeId, nodeSnapshot);
        nodesChanged = true;
        const beforeVersion = searchIndex.getVersion();
        searchIndex.updateNode(nodeId, nodeSnapshot);
        if (searchIndex.getVersion() !== beforeVersion) {
          indexChanged = true;
        }
        return;
      }
      if (nextNodes.delete(nodeId)) {
        nodesChanged = true;
      }
      const nodeEdges = searchIndex.getNodeEdgeIds(nodeId);
      if (nodeEdges.length > 0) {
        nodeEdges.forEach((edgeId) => {
          const beforeVersion = searchIndex.getVersion();
          searchIndex.removeEdge(edgeId);
          if (searchIndex.getVersion() !== beforeVersion) {
            indexChanged = true;
          }
        });
      }
    });

    if (!nodesChanged && !indexChanged) {
      return;
    }

    if (nodesChanged) {
      snapshot = {
        ...snapshot,
        nodes: nextNodes as ReadonlyMap<NodeId, NodeSnapshot>
      } satisfies OutlineSnapshot;
      notify();
    }
    if (indexChanged) {
      notifySearchIndex();
    }
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
    if (state.panes.some((pane) => pane.rootEdgeId || pane.focusPathEdgeIds?.length)) {
      const availableEdgeIds = new Set<EdgeId>();
      snapshot.edges.forEach((_edge, edgeId) => {
        availableEdgeIds.add(edgeId);
      });
      reconcilePaneFocus(session, availableEdgeIds);
    }

    const fallbackEdgeId = snapshot.rootEdgeIds[0] ?? null;
    session.update((existing) => {
      if (existing.panes.length === 0) {
        return existing;
      }

      let panesChanged = false;
      const nextPanes: SessionPaneState[] = existing.panes.map((pane) => {
        let activeEdgeId = pane.activeEdgeId;
        if (activeEdgeId && !snapshot.edges.has(activeEdgeId)) {
          activeEdgeId = null;
        }
        if (!activeEdgeId) {
          activeEdgeId = fallbackEdgeId;
        }

        let selectionRange = pane.selectionRange;
        if (
          selectionRange
          && (!snapshot.edges.has(selectionRange.anchorEdgeId) || !snapshot.edges.has(selectionRange.headEdgeId))
        ) {
          selectionRange = undefined;
        }

        let pendingFocusEdgeId: EdgeId | null | undefined = pane.pendingFocusEdgeId;
        if (pendingFocusEdgeId && !snapshot.edges.has(pendingFocusEdgeId)) {
          pendingFocusEdgeId = null;
        }

        const snapshotReady = isOutlineBootstrapped;
        const collapsedEdgeIds = snapshotReady
          ? pane.collapsedEdgeIds.filter((edgeId) => snapshot.edges.has(edgeId))
          : pane.collapsedEdgeIds;
        const collapsedChanged = snapshotReady
          && (collapsedEdgeIds.length !== pane.collapsedEdgeIds.length
            || collapsedEdgeIds.some((edgeId, index) => edgeId !== pane.collapsedEdgeIds[index]));

        if (
          activeEdgeId === pane.activeEdgeId
          && selectionRange === pane.selectionRange
          && pendingFocusEdgeId === pane.pendingFocusEdgeId
          && !collapsedChanged
        ) {
          return pane;
        }

        panesChanged = true;
        return {
          ...pane,
          activeEdgeId: activeEdgeId ?? null,
          selectionRange,
          pendingFocusEdgeId,
          collapsedEdgeIds: collapsedChanged ? collapsedEdgeIds : pane.collapsedEdgeIds
        } satisfies SessionPaneState;
      });

      let activePaneId = existing.activePaneId;
      if (!nextPanes.some((pane) => pane.paneId === activePaneId)) {
        activePaneId = nextPanes[0]?.paneId ?? activePaneId;
      }

      let selectedEdgeId = existing.selectedEdgeId;
      if (selectedEdgeId && !snapshot.edges.has(selectedEdgeId)) {
        selectedEdgeId = null;
      }

      const activePane = nextPanes.find((pane) => pane.paneId === activePaneId) ?? nextPanes[0] ?? null;
      const activeEdgeId = activePane?.activeEdgeId ?? null;
      if (activeEdgeId !== selectedEdgeId) {
        selectedEdgeId = activeEdgeId ?? selectedEdgeId ?? fallbackEdgeId ?? null;
      }

      if (!panesChanged && activePaneId === existing.activePaneId && selectedEdgeId === existing.selectedEdgeId) {
        return existing;
      }

      return {
        ...existing,
        panes: panesChanged ? nextPanes : existing.panes,
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
    searchIndex = OutlineSearchIndex.fromSnapshot(snapshot);
    notifySearchIndex();
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

    transaction.changed.forEach((keys, type) => {
      if (type === (sync.outline.edges as unknown as typeof type)) {
        structuralChangeDetected = true;
        keys.forEach((key) => {
          if (typeof key === "string") {
            touchedEdges.add(key as EdgeId);
          }
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
          touchedEdges.add(edgeId);
        });
        events.forEach((event) => {
          event.changes.delta.forEach((delta) => {
            const inserted = delta.insert;
            if (Array.isArray(inserted)) {
              inserted.forEach((value) => {
                if (typeof value === "string") {
                  touchedEdges.add(value as EdgeId);
                }
              });
              return;
            }
            if (typeof inserted === "string") {
              touchedEdges.add(inserted as EdgeId);
            }
          });
        });
        return;
      }

      if (!childArrayOwners.has(type)) {
        return;
      }

      structuralChangeDetected = true;
      const array = type as unknown as EdgeArrayLike;
      array.toArray().forEach((edgeId) => {
        touchedEdges.add(edgeId);
      });
      events.forEach((event) => {
        event.changes.delta.forEach((delta) => {
          const inserted = delta.insert;
          if (Array.isArray(inserted)) {
            inserted.forEach((value) => {
              if (typeof value === "string") {
                touchedEdges.add(value as EdgeId);
              }
            });
            return;
          }
          if (typeof inserted === "string") {
            touchedEdges.add(inserted as EdgeId);
          }
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
    searchIndex.rebuild(snapshot);
    notify();
    notifySearchIndex();

    if (touchedEdges.size === 0) {
      return;
    }

    const updatesApplied = reconcileOutlineStructure(sync.outline, {
      edgeFilter: touchedEdges,
      origin: RECONCILE_ORIGIN
    });

    if (updatesApplied > 0) {
      snapshot = createOutlineSnapshot(sync.outline);
      searchIndex.rebuild(snapshot);
      notify();
      notifySearchIndex();
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
    teardownCallbacks.push(() => {
      sync.outline.doc.off("afterTransaction", handleDocAfterTransaction);
      sync.awareness.off("change", handleAwarenessUpdate);
    });
    sync.outline.nodes.observeDeep(handleNodesDeepChange);
    teardownCallbacks.push(() => {
      sync.outline.nodes.unobserveDeep(handleNodesDeepChange);
    });
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

  const getSnapshot = () => snapshot;
  const getPresenceSnapshot = () => presenceSnapshot;
  const getStatus = () => status;
  const getSearchIndexSnapshot = () => searchIndex.getSnapshot();

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

  const subscribeSearchIndex = (listener: () => void): (() => void) => {
    searchListeners.add(listener);
    return () => searchListeners.delete(listener);
  };

  const runSearch = (query: string): OutlineSearchExecution => executeOutlineSearch(query, searchIndex, snapshot);

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
    getSearchIndexSnapshot,
    subscribeSearchIndex,
    runSearch,
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
