/**
 * Wraps browser APIs behind the SyncEnvironment contract so shared bootstrap
 * logic can run without touching globals.  The adapter guards against
 * unavailable features (e.g. storage in private windows) and memoises the
 * optional local bootstrap payload placed on window.
 */
import type {
  LocalSyncBootstrap,
  SyncEnvironment,
  SyncFetch,
  SyncStorage,
  SyncTimers
} from '@thortiq/client-core';

interface ImportMetaEnv {
  readonly env?: Record<string, string | undefined>;
}

declare global {
  interface Window {
    __THORTIQ_LOCAL_SYNC__?: LocalSyncBootstrap;
  }
}

const safeStorage: SyncStorage = {
  getItem(key: string) {
    if (typeof window === 'undefined' || !window.localStorage) {
      return null;
    }
    try {
      return window.localStorage.getItem(key);
    } catch (_error) {
      return null;
    }
  },
  setItem(key: string, value: string) {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }
    try {
      window.localStorage.setItem(key, value);
    } catch (_error) {
      // ignore storage failures (private browsing, quota, etc.)
    }
  }
};

const browserTimers: SyncTimers = {
  setTimeout(handler, delay) {
    return window.setTimeout(handler, delay);
  },
  clearTimeout(id) {
    window.clearTimeout(id);
  }
};

const readEnv = (key: string): string | null => {
  if (!key) {
    return null;
  }
  if (typeof import.meta !== 'undefined') {
    const meta = import.meta as ImportMetaEnv;
    const value = meta.env?.[key];
    if (typeof value === 'string') {
      return value;
    }
  }
  return null;
};

const getCachedBootstrapConfig = (): LocalSyncBootstrap | null => {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.__THORTIQ_LOCAL_SYNC__ ?? null;
};

const cacheBootstrapConfig = (config: LocalSyncBootstrap) => {
  if (typeof window === 'undefined') {
    return;
  }
  window.__THORTIQ_LOCAL_SYNC__ = config;
};

const getBootstrapConfig = async (): Promise<LocalSyncBootstrap | null> => {
  if (typeof window === 'undefined' || typeof window.fetch === 'undefined') {
    return null;
  }
  const cached = getCachedBootstrapConfig();
  if (cached) {
    return cached;
  }
  try {
    const response = await window.fetch('/local-sync.json', {cache: 'no-store'});
    if (!response.ok) {
      return null;
    }
    const payload = (await response.json()) as LocalSyncBootstrap;
    cacheBootstrapConfig(payload);
    return payload;
  } catch (_error) {
    return null;
  }
};

export const createWebSyncEnvironment = (): SyncEnvironment => {
  const fetchFn: SyncFetch | undefined =
    typeof window !== 'undefined' && typeof window.fetch === 'function'
      ? (input, init) => window.fetch(input, init)
      : undefined;

  return {
    now: () => new Date().toISOString(),
    storage: safeStorage,
    timers: typeof window !== 'undefined' ? browserTimers : undefined,
    fetch: fetchFn,
    readEnv,
    getCachedBootstrapConfig,
    getBootstrapConfig,
    cacheBootstrapConfig
  };
};
