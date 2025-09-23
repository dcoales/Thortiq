import type {SnapshotPersistence} from './types';

export interface IndexedDbSnapshotStoreOptions {
  readonly databaseName: string;
  readonly storeName?: string;
  readonly key?: string;
  readonly version?: number;
}

interface SnapshotRecord {
  readonly id: string;
  readonly update: Uint8Array | ArrayBuffer;
}

const DEFAULT_STORE_NAME = 'thortiq_snapshots';
const DEFAULT_KEY = 'current';

const toPromise = <T>(request: IDBRequest<T>): Promise<T> => {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
};

const openDatabase = async (
  options: Required<Pick<IndexedDbSnapshotStoreOptions, 'databaseName' | 'storeName'>> &
    Pick<IndexedDbSnapshotStoreOptions, 'version'>
): Promise<IDBDatabase> => {
  if (typeof indexedDB === 'undefined') {
    throw new Error('IndexedDB is not available in the current environment');
  }

  const request = indexedDB.open(options.databaseName, options.version);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains(options.storeName)) {
      db.createObjectStore(options.storeName, {keyPath: 'id'});
    }
  };

  return toPromise(request);
};

const normalizeBinary = (value: Uint8Array | ArrayBuffer | undefined | null): Uint8Array | null => {
  if (!value) {
    return null;
  }
  if (value instanceof Uint8Array) {
    return new Uint8Array(value);
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value.slice(0));
  }
  return null;
};

export const createIndexedDbSnapshotStore = (
  options: IndexedDbSnapshotStoreOptions
): SnapshotPersistence => {
  const storeName = options.storeName ?? DEFAULT_STORE_NAME;
  const key = options.key ?? DEFAULT_KEY;
  const databasePromise = openDatabase({
    databaseName: options.databaseName,
    storeName,
    version: options.version
  });

  const runTransaction = async (
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => Promise<unknown>
  ) => {
    const db = await databasePromise;
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    const result = await fn(store);
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
    });
    return result;
  };

  return {
    async load() {
      const record = (await runTransaction('readonly', async (store) => {
        const request = store.get(key);
        return toPromise(request);
      })) as SnapshotRecord | undefined;

      const binary = normalizeBinary(record?.update);
      return binary ? {update: binary} : null;
    },

    async save(snapshot) {
      const record: SnapshotRecord = {
        id: key,
        update: new Uint8Array(snapshot.update)
      };
      await runTransaction('readwrite', async (store) => {
        const request = store.put(record);
        await toPromise(request);
      });
    },

    async clear() {
      await runTransaction('readwrite', async (store) => {
        const request = store.delete(key);
        await toPromise(request);
      });
    }
  };
};

export type IndexedDbSnapshotStore = ReturnType<typeof createIndexedDbSnapshotStore>;
