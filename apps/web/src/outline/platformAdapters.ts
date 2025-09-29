import type { Doc } from "yjs";

import {
  createIndexeddbPersistence,
  createNoopPersistence,
  createMemorySessionStorageAdapter,
  type PersistenceAdapter,
  type SessionStorageAdapter
} from "@thortiq/sync-core";
import type { SyncManagerOptions } from "@thortiq/client-core";

import { createWebIndexeddbPersistenceFactory } from "./syncPersistence";

const PERSISTENCE_DATABASE = "thortiq-outline";
const SESSION_STORAGE_KEY = "thortiq:session:v1";

export const createBrowserPersistence = (doc: Doc): PersistenceAdapter => {
  try {
    return createIndexeddbPersistence(doc, { databaseName: PERSISTENCE_DATABASE });
  } catch (error) {
    if (typeof console !== "undefined" && typeof console.warn === "function") {
      console.warn("[outline] falling back to in-memory persistence", error);
    }
    return createNoopPersistence();
  }
};

export const createBrowserSyncPersistenceFactory = (
  options: { readonly databaseName?: string } = {}
): SyncManagerOptions["persistenceFactory"] => {
  return createWebIndexeddbPersistenceFactory({ databaseName: options.databaseName ?? PERSISTENCE_DATABASE });
};

export const createBrowserSessionAdapter = (): SessionStorageAdapter => {
  if (typeof window === "undefined" || !window.localStorage) {
    return createMemorySessionStorageAdapter();
  }

  const storage = window.localStorage;
  const listeners = new Set<() => void>();

  const notify = () => {
    listeners.forEach((listener) => listener());
  };

  const handleStorage = (event: StorageEvent) => {
    if (event.storageArea === storage && event.key === SESSION_STORAGE_KEY) {
      notify();
    }
  };

  return {
    read() {
      return storage.getItem(SESSION_STORAGE_KEY);
    },
    write(value) {
      storage.setItem(SESSION_STORAGE_KEY, value);
      notify();
    },
    clear() {
      storage.removeItem(SESSION_STORAGE_KEY);
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
