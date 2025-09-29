import { IndexeddbPersistence } from "y-indexeddb";
import type { SyncManagerOptions, SyncPersistenceAdapter, SyncPersistenceContext } from "@thortiq/client-core";

interface IndexeddbPersistenceFactoryOptions {
  readonly databaseName?: string;
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

const buildDatabaseName = (context: SyncPersistenceContext, override?: string): string => {
  if (override) {
    return override;
  }
  return `thortiq-outline:${context.docId}`;
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
    let persistence: IndexeddbPersistence | null = null;
    let started = false;

    const start = async (): Promise<void> => {
      if (started) {
        return deferred.promise;
      }
      started = true;
      const targetIndexedDB = selectIndexedDB(options.indexedDB);
      const previousIndexedDB = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
      if (options.indexedDB) {
        (globalThis as { indexedDB?: IDBFactory }).indexedDB = targetIndexedDB;
      }
      try {
        const databaseName = buildDatabaseName(context, options.databaseName);
        persistence = new IndexeddbPersistence(databaseName, context.doc);
        await persistence.whenSynced;
        deferred.resolve();
      } catch (error) {
        deferred.reject(error);
        throw error;
      } finally {
        if (options.indexedDB) {
          (globalThis as { indexedDB?: IDBFactory | undefined }).indexedDB = previousIndexedDB;
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

    const adapter: SyncPersistenceAdapter = {
      start,
      whenReady: deferred.promise,
      destroy
    };

    return adapter;
  };
};
