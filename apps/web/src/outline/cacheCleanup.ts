import {
  buildPersistenceDatabaseName,
  buildSessionStorageKey,
  createUserDocId,
  createUserStorageNamespace
} from "@thortiq/client-core";

const LEGACY_DATABASE_NAME = "thortiq-outline";
const LEGACY_SESSION_KEY = "thortiq:session:v1";

const deleteIndexedDbDatabase = async (databaseName: string): Promise<void> => {
  if (!databaseName || typeof indexedDB === "undefined") {
    return;
  }
  await new Promise<void>((resolve) => {
    let resolved = false;
    const request = indexedDB.deleteDatabase(databaseName);
    const resolveOnce = () => {
      if (!resolved) {
        resolved = true;
        resolve();
      }
    };
    request.onsuccess = resolveOnce;
    request.onerror = resolveOnce;
    request.onblocked = resolveOnce;
  });
};

const clearSessionKey = (key: string): void => {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  window.localStorage.removeItem(key);
};

export interface ClearOutlineCachesOptions {
  readonly userId: string;
  readonly docId?: string;
}

export const clearOutlineCaches = async (options: ClearOutlineCachesOptions): Promise<void> => {
  const namespace = createUserStorageNamespace({ userId: options.userId });
  const docId = options.docId ?? createUserDocId({ userId: options.userId, type: "outline" });
  const databaseName = buildPersistenceDatabaseName({
    namespace,
    docType: "outline",
    docId
  });

  await deleteIndexedDbDatabase(databaseName);
  if (databaseName !== LEGACY_DATABASE_NAME) {
    await deleteIndexedDbDatabase(LEGACY_DATABASE_NAME);
  }

  clearSessionKey(buildSessionStorageKey({ namespace }));
  clearSessionKey(LEGACY_SESSION_KEY);
};
