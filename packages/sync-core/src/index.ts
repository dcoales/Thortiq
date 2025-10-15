/**
 * Sync-core coordinates collaborative behaviour around the shared outline document. It wires
 * the Yjs awareness protocol, maintains a single undo manager for structural+text changes, and
 * exposes pluggable provider/persistence interfaces so platforms can layer transport details on
 * top without breaching SOLID boundaries.
 */
import { Awareness } from "y-protocols/awareness.js";
import { IndexeddbPersistence } from "y-indexeddb";
import { UndoManager } from "yjs";
import type { Doc } from "yjs";

import { createOutlineDoc, outlineFromDoc, type OutlineDoc } from "@thortiq/client-core";

export type { OutlineDoc, OutlineSnapshot, OutlineTreeNode, EdgeId, NodeId } from "@thortiq/client-core";

export type SyncProviderStatus = "disconnected" | "connecting" | "connected";

export interface SyncProvider {
  readonly status: SyncProviderStatus;
  connect(): Promise<void> | void;
  disconnect(): Promise<void> | void;
  onStatusChange(listener: (status: SyncProviderStatus) => void): () => void;
}

export interface PersistenceAdapter {
  start(): Promise<void> | void;
  readonly whenReady: Promise<void>;
  destroy(): Promise<void> | void;
}

export interface CreateSyncContextOptions {
  readonly doc?: Doc;
  readonly localOrigin?: symbol;
  readonly awareness?: Awareness;
  readonly trackedOrigins?: Set<unknown>;
}

export interface SyncContext {
  readonly outline: OutlineDoc;
  readonly doc: Doc;
  readonly awareness: Awareness;
  readonly undoManager: UndoManager;
  readonly localOrigin: symbol;
  /**
   * Utility so callers can ensure the provided origin will be tracked by the undo manager.
   */
  readonly isTrackedOrigin: (origin: unknown) => boolean;
}

const DEFAULT_LOCAL_SYMBOL_DESCRIPTION = "thortiq-local";

const DEFAULT_PERSISTENCE_DATABASE = "thortiq-outline";

type Deferred<T> = {
  readonly promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
  reject(reason?: unknown): void;
};

const createDeferred = <T>(): Deferred<T> => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

export interface IndexeddbPersistenceOptions {
  readonly databaseName?: string;
  readonly indexedDB?: IDBFactory | null;
}

export const createSyncContext = (
  options: CreateSyncContextOptions = {}
): SyncContext => {
  const outline = options.doc ? outlineFromDoc(options.doc) : createOutlineDoc();
  const doc = outline.doc;
  doc.gc = false;
  const localOrigin = options.localOrigin ?? Symbol(DEFAULT_LOCAL_SYMBOL_DESCRIPTION);
  const trackedOrigins = options.trackedOrigins ?? new Set<unknown>([localOrigin]);

  const awareness = options.awareness ?? new Awareness(doc);

  const undoTargets = [outline.nodes, outline.edges, outline.rootEdges, outline.childEdgeMap];
  const undoManager = new UndoManager(undoTargets, {
    trackedOrigins
  });

  const isTrackedOrigin = (origin: unknown): boolean => trackedOrigins.has(origin);

  return {
    outline,
    doc,
    awareness,
    undoManager,
    localOrigin,
    isTrackedOrigin
  };
};

export interface EphemeralProviderOptions {
  readonly initialStatus?: SyncProviderStatus;
}

export const createEphemeralProvider = (
  options: EphemeralProviderOptions = {}
): SyncProvider => {
  let status: SyncProviderStatus = options.initialStatus ?? "disconnected";
  const listeners = new Set<(next: SyncProviderStatus) => void>();

  const emit = (next: SyncProviderStatus): void => {
    status = next;
    listeners.forEach((listener) => listener(status));
  };

  return {
    get status() {
      return status;
    },
    async connect() {
      if (status === "connected") {
        return;
      }
      emit("connecting");
      emit("connected");
    },
    async disconnect() {
      if (status === "disconnected") {
        return;
      }
      emit("disconnected");
    },
    onStatusChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }
  };
};

// Wraps y-indexeddb so shared clients can reuse the same offline cache and broadcast updates
// between browser tabs while keeping the adapter swappable for non-browser environments.
export const createIndexeddbPersistence = (
  doc: Doc,
  options: IndexeddbPersistenceOptions = {}
): PersistenceAdapter => {
  const databaseName = options.databaseName ?? DEFAULT_PERSISTENCE_DATABASE;
  const indexedDBFactory = options.indexedDB ?? (globalThis as { indexedDB?: IDBFactory }).indexedDB ?? null;

  if (!indexedDBFactory) {
    throw new Error(
      "IndexedDB is not available. Provide options.indexedDB when calling createIndexeddbPersistence()."
    );
  }

  const ready = createDeferred<void>();
  let started = false;
  let persistence: IndexeddbPersistence | null = null;

  const start = async (): Promise<void> => {
    if (started) {
      return ready.promise;
    }
    started = true;

    const originalIndexedDB = (globalThis as { indexedDB?: IDBFactory | undefined }).indexedDB;
    if (options.indexedDB) {
      (globalThis as { indexedDB?: IDBFactory }).indexedDB = indexedDBFactory;
    }
    try {
      persistence = new IndexeddbPersistence(databaseName, doc);
      await persistence.whenSynced;
      ready.resolve();
    } catch (error) {
      ready.reject(error);
      throw error;
    } finally {
      if (options.indexedDB) {
        (globalThis as { indexedDB?: IDBFactory | undefined }).indexedDB = originalIndexedDB;
      }
    }
  };

  const destroy = async (): Promise<void> => {
    if (!persistence) {
      return;
    }
    await persistence.destroy();
    persistence = null;
  };

  return {
    start,
    whenReady: ready.promise,
    destroy
  };
};

export const createNoopPersistence = (): PersistenceAdapter => ({
  async start() {
    // No-op fallback used in environments without persistence.
  },
  whenReady: Promise.resolve(),
  async destroy() {
    // No-op placeholder for resource cleanup.
  }
});

export {
  addEdge,
  createNode,
  setNodeText,
  updateNodeMetadata,
  withTransaction,
  createOutlineSnapshot,
  getRootEdgeIds
} from "@thortiq/client-core";

export {
  createSessionStore,
  createMemorySessionStorageAdapter,
  defaultSessionState,
  defaultPaneSearchState,
  appendFocusHistoryEntry,
  createHomeFocusEntry,
  normaliseFocusPath,
  focusPaneEdge,
  clearPaneFocus,
  reconcilePaneFocus,
  stepPaneFocusHistory,
  SESSION_VERSION
} from "./sessionStore";
export type {
  SessionPaneSelectionRange,
  SessionPaneState,
  SessionState,
  SessionStorageAdapter,
  SessionStore,
  SessionPaneSearchState,
  FocusPanePayload,
  SessionPaneFocusHistoryEntry,
  FocusHistoryDirection
} from "./sessionStore";

export { claimBootstrap, markBootstrapComplete, releaseBootstrapClaim } from "./bootstrap";
export type { BootstrapState } from "./bootstrap";
