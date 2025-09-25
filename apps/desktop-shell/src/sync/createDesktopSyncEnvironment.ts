/**
 * Minimal SyncEnvironment for the desktop preview shell.  It keeps a simple
 * in-memory token store and disables networking so shared bootstrap helpers
 * seed the outline without attempting remote sync or persistence APIs.
 */
import type {LocalSyncBootstrap, SyncEnvironment, SyncStorage} from '@thortiq/client-core';

const memoryStorage = (): SyncStorage => {
  const store = new Map<string, string>();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key)! : null;
    },
    setItem(key, value) {
      store.set(key, value);
    }
  };
};

export const createDesktopSyncEnvironment = (): SyncEnvironment => {
  const storage = memoryStorage();
  const getBootstrapConfig = (): Promise<LocalSyncBootstrap | null> => Promise.resolve(null);

  return {
    now: () => new Date().toISOString(),
    storage,
    timers: undefined,
    fetch: undefined,
    readEnv: () => null,
    getCachedBootstrapConfig: () => null,
    getBootstrapConfig
  };
};
