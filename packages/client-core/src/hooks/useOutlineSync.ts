/**
 * Coordinates outline persistence and websocket bootstrap using a supplied
 * platform environment.  The hook centralises token handling, snapshot
 * loading, sync status tracking, and profile fetches so shell apps only need
 * to render state while client-core owns the behavioural contract.
 */
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import type {Doc as YDoc} from 'yjs';

import {bootstrapInitialOutline} from '../bootstrap/initialOutline';
import {createWebsocketSyncConnection, type SyncAwarenessState, type WebsocketSyncConnection} from '../sync/websocketConnection';
import {deriveHttpUrl, trimTrailingSlash, type LocalSyncBootstrap, type SyncEnvironment} from '../sync/environment';
import {loadDocSnapshot, saveDocSnapshot} from '../persistence/snapshot';
import type {SnapshotPersistence} from '../persistence/types';
import type {UserProfile} from '../types';

export type SyncStatus = 'connected' | 'connecting' | 'disconnected';

export interface OutlineSyncEnvKeys {
  readonly token?: string;
  readonly serverUrl?: string;
  readonly httpUrl?: string;
  readonly docId?: string;
}

export interface OutlineSyncOptions {
  readonly tokenStorageKey: string;
  readonly defaultDocId: string;
  readonly syncDisabledMessage: string;
  readonly envKeys: OutlineSyncEnvKeys;
  readonly snapshotStoreFactory?: () => SnapshotPersistence | null;
  readonly snapshotDebounceMs?: number;
  readonly profileEndpoint?: string;
}

export interface OutlineSyncState {
  readonly isReady: boolean;
  readonly initializationError: Error | null;
  readonly profile: UserProfile | null;
  readonly syncStatus: SyncStatus;
  readonly syncError: string | null;
  readonly token: string | null;
  readonly syncServerUrl: string | null;
  readonly syncHttpBase: string | null;
  readonly syncDocId: string;
  readonly bootstrapConfig: LocalSyncBootstrap | null;
}

export interface OutlineSyncHandle extends OutlineSyncState {
  readonly setAwarenessState: (state: SyncAwarenessState | null) => void;
}

const defaultTimers = {
  setTimeout: (handler: () => void, delay: number) => globalThis.setTimeout(handler, delay) as unknown as number,
  clearTimeout: (id: number) => globalThis.clearTimeout(id)
};

export const useOutlineSync = (
  doc: YDoc,
  environment: SyncEnvironment,
  options: OutlineSyncOptions
): OutlineSyncHandle => {
  const timers = environment.timers ?? defaultTimers;
  const [bootstrapConfig, setBootstrapConfig] = useState<LocalSyncBootstrap | null>(() =>
    environment.getCachedBootstrapConfig ? environment.getCachedBootstrapConfig() : null
  );

  const [isReady, setIsReady] = useState(false);
  const [initializationError, setInitializationError] = useState<Error | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('disconnected');
  const [syncError, setSyncError] = useState<string | null>(null);

  const initialToken = useMemo(() => {
    let stored: string | null = null;
    if (environment.storage) {
      try {
        stored = environment.storage.getItem(options.tokenStorageKey);
      } catch (_error) {
        stored = null;
      }
    }
    if (stored) {
      return stored;
    }
    const envKey = options.envKeys.token;
    if (!envKey) {
      return null;
    }
    const envToken = environment.readEnv(envKey);
    if (envToken) {
      try {
        environment.storage?.setItem(options.tokenStorageKey, envToken);
      } catch (_error) {
        // storage writes may fail (private browsing, etc.); ignore
      }
      return envToken;
    }
    return null;
  }, [environment, options.envKeys.token, options.tokenStorageKey]);

  const [token, setToken] = useState<string | null>(initialToken);

  const syncDocId = useMemo(() => {
    const envKey = options.envKeys.docId;
    const envValue = envKey ? environment.readEnv(envKey) : null;
    if (envValue) {
      return envValue;
    }
    if (bootstrapConfig?.docId) {
      return bootstrapConfig.docId;
    }
    return options.defaultDocId;
  }, [bootstrapConfig?.docId, environment, options.defaultDocId, options.envKeys.docId]);

  const syncServerUrl = useMemo(() => {
    const envKey = options.envKeys.serverUrl;
    const envValue = envKey ? environment.readEnv(envKey) : null;
    const normalizedEnv = trimTrailingSlash(envValue);
    if (normalizedEnv) {
      return normalizedEnv;
    }
    return trimTrailingSlash(bootstrapConfig?.serverUrl);
  }, [bootstrapConfig?.serverUrl, environment, options.envKeys.serverUrl]);

  const syncHttpBase = useMemo(() => {
    const envKey = options.envKeys.httpUrl;
    const envValue = envKey ? environment.readEnv(envKey) : null;
    const normalizedEnv = trimTrailingSlash(envValue);
    if (normalizedEnv) {
      return normalizedEnv;
    }
    const normalizedBootstrap = trimTrailingSlash(bootstrapConfig?.httpUrl);
    if (normalizedBootstrap) {
      return normalizedBootstrap;
    }
    const serverEnvKey = options.envKeys.serverUrl;
    const explicitServer = serverEnvKey ? environment.readEnv(serverEnvKey) : null;
    const serverCandidate = explicitServer ?? bootstrapConfig?.serverUrl ?? null;
    return deriveHttpUrl(serverCandidate);
  }, [bootstrapConfig?.httpUrl, bootstrapConfig?.serverUrl, environment, options.envKeys.httpUrl, options.envKeys.serverUrl]);

  const connectionRef = useRef<WebsocketSyncConnection | null>(null);
  const pendingSaveRef = useRef<number | null>(null);
  const snapshotStoreRef = useRef<SnapshotPersistence | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (bootstrapConfig) {
      return undefined;
    }
    const loadConfig = async () => {
      try {
        const config = await environment.getBootstrapConfig();
        if (cancelled || !config) {
          return;
        }
        environment.cacheBootstrapConfig?.(config);
        setBootstrapConfig(config);
      } catch (_error) {
        // Ignore bootstrap fetch errors; env may rely on explicit env vars
      }
    };
    void loadConfig();
    return () => {
      cancelled = true;
    };
  }, [bootstrapConfig, environment]);

  useEffect(() => {
    const bootstrapToken = bootstrapConfig?.token;
    if (!bootstrapToken || bootstrapToken === token) {
      return;
    }
    try {
      environment.storage?.setItem(options.tokenStorageKey, bootstrapToken);
    } catch (_error) {
      // ignore storage failures
    }
    setToken(bootstrapToken);
  }, [bootstrapConfig?.token, environment.storage, options.tokenStorageKey, token]);

  useEffect(() => {
    let disposed = false;
    const storeFactory = options.snapshotStoreFactory;
    const store = storeFactory ? storeFactory() : null;
    snapshotStoreRef.current = store;

    const initialize = async () => {
      try {
        const loaded = store ? await loadDocSnapshot(doc, store) : false;
        if (!loaded) {
          bootstrapInitialOutline(doc);
          if (store) {
            await saveDocSnapshot(doc, store);
          }
        }
        if (disposed) {
          return;
        }
        setIsReady(true);
      } catch (error) {
        if (disposed) {
          return;
        }
        setInitializationError(error as Error);
        setIsReady(true);
      }
    };

    void initialize();

    const scheduleSave = () => {
      if (!store) {
        return;
      }
      if (pendingSaveRef.current !== null) {
        timers.clearTimeout(pendingSaveRef.current);
      }
      pendingSaveRef.current = timers.setTimeout(() => {
        void (async () => {
          try {
            await saveDocSnapshot(doc, store);
          } catch (error) {
            // eslint-disable-next-line no-console
            console.error('Failed to save document snapshot', error);
          } finally {
            pendingSaveRef.current = null;
          }
        })();
      }, options.snapshotDebounceMs ?? 250);
    };

    if (store) {
      doc.on('update', scheduleSave);
    }

    return () => {
      disposed = true;
      if (store) {
        doc.off('update', scheduleSave);
      }
      if (pendingSaveRef.current !== null) {
        timers.clearTimeout(pendingSaveRef.current);
        pendingSaveRef.current = null;
      }
    };
  }, [doc, options.snapshotDebounceMs, options.snapshotStoreFactory, timers]);

  useEffect(() => {
    if (!token || !syncServerUrl) {
      setSyncStatus('disconnected');
      setSyncError(options.syncDisabledMessage);
      connectionRef.current = null;
      return;
    }

    if (bootstrapConfig?.token && token !== bootstrapConfig.token) {
      return;
    }

    try {
      environment.storage?.setItem(options.tokenStorageKey, token);
    } catch (_error) {
      // ignore storage failures
    }

    const connection = createWebsocketSyncConnection({
      serverUrl: syncServerUrl,
      docId: syncDocId,
      token,
      doc
    });
    connectionRef.current = connection;
    setSyncStatus('connecting');
    setSyncError((previous) => (previous === options.syncDisabledMessage ? null : previous));
    const unsubscribe = connection.subscribeStatus((status) => {
      setSyncStatus(status);
      if (status === 'connected') {
        setSyncError((previous) => (previous === options.syncDisabledMessage ? null : previous));
      }
    });

    return () => {
      unsubscribe();
      connection.disconnect();
      connectionRef.current = null;
      setSyncStatus('disconnected');
    };
  }, [bootstrapConfig?.token, doc, environment.storage, options.syncDisabledMessage, options.tokenStorageKey, syncDocId, syncServerUrl, token]);

  useEffect(() => {
    const fetchFn = environment.fetch;
    if (!token || !syncHttpBase || !fetchFn || (bootstrapConfig?.token && token !== bootstrapConfig.token)) {
      return;
    }

    const controller = new AbortController();
    setSyncError(null);

    const loadProfile = async () => {
      try {
        const response = await fetchFn(`${syncHttpBase}${options.profileEndpoint ?? '/api/profile'}`, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json'
          },
          signal: controller.signal
        });
        if (!response.ok) {
          throw new Error(`Profile request failed (${response.status})`);
        }
        const payload = (await response.json()) as {profile: UserProfile};
        setProfile(payload.profile);
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        setSyncError((error as Error).message);
      }
    };

    void loadProfile();

    return () => {
      controller.abort();
    };
  }, [bootstrapConfig?.token, environment, options.profileEndpoint, syncHttpBase, token]);

  const setAwarenessState = useCallback(
    (state: SyncAwarenessState | null) => {
      connectionRef.current?.setAwarenessState(state);
    },
    []
  );

  return {
    isReady,
    initializationError,
    profile,
    syncStatus,
    syncError,
    token,
    syncServerUrl,
    syncHttpBase,
    syncDocId,
    bootstrapConfig,
    setAwarenessState
  };
};
