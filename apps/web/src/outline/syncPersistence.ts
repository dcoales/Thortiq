import { IndexeddbPersistence } from "y-indexeddb";
import type { SyncManagerOptions, SyncPersistenceAdapter, SyncPersistenceContext } from "@thortiq/client-core";

interface IndexeddbPersistenceFactoryOptions {
  readonly databaseName?: string;
  readonly buildDatabaseName?: (context: SyncPersistenceContext) => string;
  readonly indexedDB?: IDBFactory | null;
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

type PatchedIndexeddbPersistence = IndexeddbPersistence & {
  _storeUpdate: (update: Uint8Array, origin: unknown) => void;
};

const selectIndexedDB = (factory: IDBFactory | null | undefined): IDBFactory => {
  if (factory) {
    return factory;
  }
  const globalIndexedDB = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
  if (!globalIndexedDB) {
    throw new Error(
      "IndexedDB is not available. Provide options.indexedDB when calling createWebIndexeddbPersistenceFactory()."
    );
  }
  return globalIndexedDB;
};

const selectDatabaseName = (
  context: SyncPersistenceContext,
  options: IndexeddbPersistenceFactoryOptions
): string => {
  if (options.buildDatabaseName) {
    return options.buildDatabaseName(context);
  }
  if (options.databaseName) {
    return options.databaseName;
  }
  return `thortiq-outline:${context.docId}`;
};

const isRecoverableIndexeddbError = (error: unknown): boolean => {
  if (error instanceof DOMException) {
    return error.name === "InvalidStateError"
      || error.name === "QuotaExceededError"
      || error.name === "NotAllowedError"
      || error.name === "UnknownError";
  }
  if (error instanceof Error && typeof error.message === "string") {
    return /indexeddb/i.test(error.message) || /connection is closing/i.test(error.message);
  }
  return false;
};

const installIndexeddbFailureGuards = (
  instance: PatchedIndexeddbPersistence,
  onDisable: (reason: unknown) => void
): void => {
  const doc = instance.doc;
  const originalStoreUpdate = instance._storeUpdate;
  let disabled = false;

  const disable = (reason: unknown) => {
    if (disabled) {
      return;
    }
    disabled = true;
    onDisable(reason);
  };

  const wrappedStoreUpdate = (update: Uint8Array, origin: unknown) => {
    if (disabled) {
      return;
    }
    try {
      originalStoreUpdate(update, origin);
    } catch (error) {
      if (isRecoverableIndexeddbError(error)) {
        disable(error);
        return;
      }
      throw error;
    }
  };

  doc.off("update", originalStoreUpdate);
  doc.on("update", wrappedStoreUpdate);
  instance._storeUpdate = wrappedStoreUpdate;
};

/**
 * Creates a persistence factory for the web shell that hydrates the outline from IndexedDB and keeps
 * changes durable offline. The adapter follows the SyncManager contract so it can be swapped for
 * different storage backends in other platforms.
 */
export const createWebIndexeddbPersistenceFactory = (
  options: IndexeddbPersistenceFactoryOptions = {}
): SyncManagerOptions["persistenceFactory"] => {
  return (context) => {
    const deferred = createDeferred<void>();
    let deferredSettled = false;

    const resolveIfPending = () => {
      if (!deferredSettled) {
        deferredSettled = true;
        deferred.resolve();
      }
    };

    const rejectIfPending = (reason: unknown) => {
      if (!deferredSettled) {
        deferredSettled = true;
        deferred.reject(reason);
      }
    };

    let persistence: PatchedIndexeddbPersistence | null = null;
    let started = false;

    const start = async (): Promise<void> => {
      if (started) {
        return deferred.promise;
      }
      started = true;

      const maxAttempts = 2;
      let attempt = 0;
      let lastDisableReason: unknown = null;

      while (attempt <= maxAttempts) {
        const disableDeferred = createDeferred<void>();
        let disableTriggered = false;
        let disableCleanup: Promise<void> | null = null;
        let disableReason: unknown = null;
        let replacedIndexedDB = false;
        let previousIndexedDB: IDBFactory | undefined;
        let instance: PatchedIndexeddbPersistence | null = null;

        const awaitDisableCleanup = async (): Promise<void> => {
          if (!disableCleanup) {
            return;
          }
          try {
            await disableCleanup;
          } catch (cleanupError) {
            if (!isRecoverableIndexeddbError(cleanupError) && typeof console !== "undefined" && typeof console.error === "function") {
              console.error("[outline] IndexedDB destroy failed", cleanupError);
            }
          } finally {
            disableCleanup = null;
          }
        };

        const handleDisable = (reason: unknown) => {
          if (disableTriggered) {
            return;
          }
          disableTriggered = true;
          disableReason = reason;
          persistence = null;
          if (typeof console !== "undefined" && typeof console.warn === "function") {
            console.warn("[outline] IndexedDB persistence unavailable; attempting recovery", reason);
          }
          if (instance) {
            disableCleanup = instance.destroy();
          }
          disableDeferred.resolve();
        };

        try {
          const targetIndexedDB = selectIndexedDB(options.indexedDB);
          if (options.indexedDB) {
            previousIndexedDB = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
            (globalThis as { indexedDB?: IDBFactory }).indexedDB = targetIndexedDB;
            replacedIndexedDB = true;
          }

          const databaseName = selectDatabaseName(context, options);
          instance = new IndexeddbPersistence(databaseName, context.doc) as PatchedIndexeddbPersistence;
          persistence = instance;

          installIndexeddbFailureGuards(instance, handleDisable);

          const outcome = await Promise.race([
            instance.whenSynced.then(() => "synced" as const),
            disableDeferred.promise.then(() => "disabled" as const)
          ]);

          await awaitDisableCleanup();

          if (outcome === "synced") {
            resolveIfPending();
            return;
          }
        } catch (error) {
          await awaitDisableCleanup();
          if (isRecoverableIndexeddbError(error)) {
            disableReason = error;
          } else {
            rejectIfPending(error);
            throw error;
          }
        } finally {
          if (options.indexedDB && replacedIndexedDB) {
            (globalThis as { indexedDB?: IDBFactory | undefined }).indexedDB = previousIndexedDB;
          }
        }

        lastDisableReason = disableReason;
        attempt += 1;
        if (attempt > maxAttempts) {
          break;
        }
      }

      persistence = null;
      resolveIfPending();
      if (lastDisableReason && typeof console !== "undefined" && typeof console.warn === "function") {
        console.warn("[outline] IndexedDB persistence disabled after repeated failures", lastDisableReason);
      }
    };

    const destroy = async (): Promise<void> => {
      const instance = persistence;
      persistence = null;
      if (!instance) {
        return;
      }
      try {
        await instance.destroy();
      } catch (error) {
        if (!isRecoverableIndexeddbError(error)) {
          throw error;
        }
      }
    };

    const adapter: SyncPersistenceAdapter = {
      start,
      whenReady: deferred.promise,
      destroy
    };

    return adapter;
  };
};
