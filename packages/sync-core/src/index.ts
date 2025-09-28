/**
 * Sync-core coordinates collaborative behaviour around the shared outline document. It wires
 * the Yjs awareness protocol, maintains a single undo manager for structural+text changes, and
 * exposes pluggable provider/persistence interfaces so platforms can layer transport details on
 * top without breaching SOLID boundaries.
 */
import { Awareness } from "y-protocols/awareness.js";
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

export const createSyncContext = (
  options: CreateSyncContextOptions = {}
): SyncContext => {
  const outline = options.doc ? outlineFromDoc(options.doc) : createOutlineDoc();
  const doc = outline.doc;
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

export const createNoopPersistence = (): PersistenceAdapter => ({
  async start() {
    // No-op: placeholder for IndexedDB or filesystem persistence in later phases.
  },
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
