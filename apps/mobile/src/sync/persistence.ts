import { applyUpdate, encodeStateAsUpdate } from "yjs";

import type {
  SyncManagerOptions,
  SyncPersistenceAdapter,
  SyncPersistenceContext
} from "@thortiq/client-core";

export interface AsyncStorageLike {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem?(key: string): Promise<void>;
}

export interface ReactNativePersistenceFactoryOptions {
  readonly namespace?: string;
}

type Deferred<T> = {
  resolve(value: T | PromiseLike<T>): void;
  reject(reason?: unknown): void;
  readonly promise: Promise<T>;
};

const createDeferred = <T>(): Deferred<T> => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { resolve, reject, promise };
};

const encodeBase64 = (value: Uint8Array): string => {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(value).toString("base64");
  }
  /* istanbul ignore next -- non-Node environments provide btoa */
  if (typeof globalThis.btoa === "function") {
    let binary = "";
    value.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return globalThis.btoa(binary);
  }
  throw new Error("Base64 encoding is not supported in this environment");
};

const decodeBase64 = (value: string): Uint8Array => {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(value, "base64"));
  }
  /* istanbul ignore next -- non-Node environments provide atob */
  if (typeof globalThis.atob === "function") {
    const binary = globalThis.atob(value);
    const result = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      result[index] = binary.charCodeAt(index);
    }
    return result;
  }
  throw new Error("Base64 decoding is not supported in this environment");
};

const buildStorageKey = (
  context: SyncPersistenceContext,
  options: ReactNativePersistenceFactoryOptions
): string => {
  const namespace = options.namespace ?? "thortiq:outline";
  return `${namespace}:${context.docId}`;
};

/**
 * Creates a persistence factory for the React Native shell using AsyncStorage (or compatible APIs).
 * Stored snapshots keep offline edits durable without exposing storage concerns to shared modules.
 */
export const createReactNativePersistenceFactory = (
  storage: AsyncStorageLike,
  options: ReactNativePersistenceFactoryOptions = {}
): SyncManagerOptions["persistenceFactory"] => {
  if (!storage) {
    throw new Error("AsyncStorage implementation is required for mobile persistence");
  }

  return (context: SyncPersistenceContext): SyncPersistenceAdapter => {
    const deferred = createDeferred<void>();
    let started = false;
    const storageKey = buildStorageKey(context, options);

    const hydrate = async (): Promise<void> => {
      const serialized = await storage.getItem(storageKey);
      if (!serialized) {
        return;
      }
      const update = decodeBase64(serialized);
      if (update.byteLength === 0) {
        return;
      }
      applyUpdate(context.doc, update, "mobile-persistence");
    };

    const persistSnapshot = async (): Promise<void> => {
      const update = encodeStateAsUpdate(context.doc);
      await storage.setItem(storageKey, encodeBase64(update));
    };

    const start = async (): Promise<void> => {
      if (started) {
        return deferred.promise;
      }
      started = true;
      try {
        await hydrate();
        deferred.resolve();
      } catch (error) {
        deferred.reject(error);
        throw error;
      }
    };

    const destroy = async (): Promise<void> => {
      await persistSnapshot();
    };

    const adapter: SyncPersistenceAdapter = {
      start,
      whenReady: deferred.promise,
      flush: persistSnapshot,
      destroy
    };

    return adapter;
  };
};
