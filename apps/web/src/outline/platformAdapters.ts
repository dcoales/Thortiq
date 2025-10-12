import type { Doc } from "yjs";

import {
  createIndexeddbPersistence,
  createNoopPersistence,
  createMemorySessionStorageAdapter,
  type PersistenceAdapter,
  type SessionStorageAdapter
} from "@thortiq/sync-core";
import {
  buildPersistenceDatabaseName,
  buildSessionStorageKey,
  createUserStorageNamespace,
  parseDocId,
  resolveNamespaceFromDocId,
  type DocType,
  type SyncManagerOptions
} from "@thortiq/client-core";

import { createWebIndexeddbPersistenceFactory } from "./syncPersistence";

const DEFAULT_NAMESPACE = createUserStorageNamespace({ userId: "local" });
const FALLBACK_DOC_ID = "thq.v1:user:outline:local";

const deriveNamespace = (namespace: string | undefined, docId: string): string => {
  if (namespace) {
    return namespace;
  }
  const derived = resolveNamespaceFromDocId({ docId });
  return derived ?? DEFAULT_NAMESPACE;
};

const deriveDocType = (docId: string): DocType => {
  const parsed = parseDocId(docId);
  return (parsed?.type ?? "outline") as DocType;
};

const computeDatabaseName = (namespace: string, docId: string): string => {
  return buildPersistenceDatabaseName({
    namespace,
    docType: deriveDocType(docId),
    docId
  });
};

export const createBrowserPersistence = (
  doc: Doc,
  options: { readonly namespace?: string; readonly docId?: string } = {}
): PersistenceAdapter => {
  const docId = options.docId ?? FALLBACK_DOC_ID;
  const namespace = deriveNamespace(options.namespace, docId);
  const databaseName = computeDatabaseName(namespace, docId);

  try {
    return createIndexeddbPersistence(doc, { databaseName });
  } catch (error) {
    if (typeof console !== "undefined" && typeof console.warn === "function") {
      console.warn("[outline] falling back to in-memory persistence", error);
    }
    return createNoopPersistence();
  }
};

export const createBrowserSyncPersistenceFactory = (
  options: { readonly namespace?: string; readonly indexedDB?: IDBFactory | null } = {}
): SyncManagerOptions["persistenceFactory"] => {
  return createWebIndexeddbPersistenceFactory({
    indexedDB: options.indexedDB ?? null,
    buildDatabaseName: (context) => {
      const namespace = deriveNamespace(options.namespace, context.docId);
      return computeDatabaseName(namespace, context.docId);
    }
  });
};

export interface BrowserSessionAdapterOptions {
  readonly namespace?: string;
  readonly userId?: string;
  readonly storage?: Storage;
}

export const createBrowserSessionAdapter = (
  options: BrowserSessionAdapterOptions = {}
): SessionStorageAdapter => {
  if (typeof window === "undefined" || !window.localStorage) {
    return createMemorySessionStorageAdapter();
  }

  const namespace =
    options.namespace
    ?? (options.userId ? createUserStorageNamespace({ userId: options.userId }) : DEFAULT_NAMESPACE);

  const storage = options.storage ?? window.localStorage;
  const storageKey = buildSessionStorageKey({ namespace });
  const listeners = new Set<() => void>();

  const notify = () => {
    listeners.forEach((listener) => listener());
  };

  const handleStorage = (event: StorageEvent) => {
    if (event.storageArea === storage && event.key === storageKey) {
      notify();
    }
  };

  return {
    read() {
      return storage.getItem(storageKey);
    },
    write(value) {
      storage.setItem(storageKey, value);
      notify();
    },
    clear() {
      storage.removeItem(storageKey);
      notify();
    },
    subscribe(listener) {
      if (listeners.size === 0) {
        window.addEventListener("storage", handleStorage);
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          window.removeEventListener("storage", handleStorage);
        }
      };
    }
  };
};
