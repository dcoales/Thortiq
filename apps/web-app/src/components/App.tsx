import {useEffect, useMemo, useRef, useState} from 'react';
import {
  CommandBus,
  OutlinePane,
  ThortiqProvider,
  createEdgeId,
  createNodeId,
  createThortiqDoc,
  createUndoManager,
  upsertNodeRecord,
  insertEdgeRecord,
  createIndexedDbSnapshotStore,
  loadDocSnapshot,
  saveDocSnapshot,
  ensureDocumentRoot,
  initializeCollections,
  createWebsocketSyncConnection,
  type WebsocketSyncConnection,
  type UserProfile
} from '@thortiq/client-core';

const timestamp = () => new Date().toISOString();

const seedInitialOutline = (doc: ReturnType<typeof createThortiqDoc>, rootId: string) => {
  const {edges} = initializeCollections(doc);
  if (edges.get(rootId)?.length) {
    return;
  }

  const now = timestamp();
  const seeds = ['Root node', 'Planning session', 'Daily notes', 'Ideas'];

  seeds.forEach((title, index) => {
    const nodeId = createNodeId();
    upsertNodeRecord(doc, {
      id: nodeId,
      html: title,
      tags: [],
      attributes: {},
      createdAt: now,
      updatedAt: now
    });

    insertEdgeRecord(doc, {
      id: createEdgeId(),
      parentId: rootId,
      childId: nodeId,
      role: 'primary',
      collapsed: false,
      ordinal: index,
      selected: false,
      createdAt: now,
      updatedAt: now
    });
  });
};

const DATABASE_NAME = 'thortiq-web-outline';
const TOKEN_STORAGE_KEY = 'thortiq:syncToken';
const DEFAULT_DOC_ID = 'thortiq-outline';
const SYNC_DISABLED_MESSAGE = 'Sync disabled: missing token or server URL';

const readEnv = (key: string): string | null => {
  if (typeof import.meta !== 'undefined') {
    const meta = import.meta as unknown as {env?: Record<string, string | undefined>};
    const value = meta.env?.[key];
    if (typeof value === 'string') {
      return value;
    }
  }
  return null;
};

const deriveHttpUrl = (wsUrl: string): string | null => {
  if (!wsUrl) {
    return null;
  }
  try {
    const url = new URL(wsUrl);
    url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
    url.pathname = '/';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch (_error) {
    return null;
  }
};

interface LocalSyncBootstrap {
  readonly serverUrl?: string;
  readonly httpUrl?: string;
  readonly docId?: string;
  readonly token?: string;
}

declare global {
  interface Window {
    __THORTIQ_LOCAL_SYNC__?: LocalSyncBootstrap;
  }
}

export const App = () => {
  const doc = useMemo(() => createThortiqDoc(), []);
  const documentRoot = useMemo(() => ensureDocumentRoot(doc), [doc]);
  const rootId = documentRoot.id;
  const [isReady, setIsReady] = useState(false);
  const [initializationError, setInitializationError] = useState<Error | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [syncStatus, setSyncStatus] = useState<'connected' | 'connecting' | 'disconnected'>('disconnected');
  const [syncError, setSyncError] = useState<string | null>(null);
  const [bootstrapConfig, setBootstrapConfig] = useState<LocalSyncBootstrap | null>(() => {
    if (typeof window === 'undefined') {
      return null;
    }
    return window.__THORTIQ_LOCAL_SYNC__ ?? null;
  });
  const [token, setToken] = useState<string | null>(() => {
    if (typeof window === 'undefined') {
      return null;
    }
    const stored = window.localStorage.getItem(TOKEN_STORAGE_KEY);
    if (stored) {
      return stored;
    }
    const envToken = readEnv('VITE_SYNC_TOKEN');
    if (envToken) {
      try {
        window.localStorage.setItem(TOKEN_STORAGE_KEY, envToken);
      } catch (_error) {
        // ignore storage errors (private browsing, etc.)
      }
      return envToken;
    }
    return null;
  });

  const syncServerUrl = useMemo(() => {
    const base = readEnv('VITE_SYNC_SERVER_URL');
    if (base) {
      return base.replace(/\/$/, '');
    }
    const fallback = bootstrapConfig?.serverUrl;
    return fallback ? fallback.replace(/\/$/, '') : null;
  }, [bootstrapConfig]);

  const syncHttpBase = useMemo(() => {
    const explicit = readEnv('VITE_SYNC_HTTP_URL');
    if (explicit) {
      return explicit.replace(/\/$/, '');
    }
    const fallback = bootstrapConfig?.httpUrl;
    if (fallback) {
      return fallback.replace(/\/$/, '');
    }
    const wsBase = readEnv('VITE_SYNC_SERVER_URL') ?? bootstrapConfig?.serverUrl ?? null;
    return wsBase ? deriveHttpUrl(wsBase) : null;
  }, [bootstrapConfig]);

  const syncDocId = useMemo(
    () => readEnv('VITE_SYNC_DOC_ID') ?? bootstrapConfig?.docId ?? DEFAULT_DOC_ID,
    [bootstrapConfig]
  );

  const syncConnectionRef = useRef<WebsocketSyncConnection | null>(null);

  useEffect(() => {
    if (bootstrapConfig || typeof window === 'undefined') {
      return;
    }

    let cancelled = false;
    const loadBootstrapConfig = async () => {
      try {
        const response = await fetch('/local-sync.json', {cache: 'no-store'});
        if (!response.ok) {
          return;
        }
        const payload = (await response.json()) as LocalSyncBootstrap;
        if (cancelled) {
          return;
        }
        window.__THORTIQ_LOCAL_SYNC__ = payload;
        setBootstrapConfig(payload);
      } catch (_error) {
        // ignore network errors; env vars may still be available
      }
    };

    void loadBootstrapConfig();

    return () => {
      cancelled = true;
    };
  }, [bootstrapConfig]);

  useEffect(() => {
    if (!token && bootstrapConfig?.token) {
      try {
        window.localStorage.setItem(TOKEN_STORAGE_KEY, bootstrapConfig.token);
      } catch (_error) {
        // ignore storage errors
      }
      setToken(bootstrapConfig.token);
    }
  }, [bootstrapConfig, token]);

  useEffect(() => {
    if (!token || !syncServerUrl) {
      setSyncStatus('disconnected');
      setSyncError(SYNC_DISABLED_MESSAGE);
    } else {
      setSyncError((previous) => (previous === SYNC_DISABLED_MESSAGE ? null : previous));
    }
  }, [syncServerUrl, token]);

  useEffect(() => {
    if (token) {
      return;
    }
    const envToken = readEnv('VITE_SYNC_TOKEN');
    if (envToken) {
      try {
        window.localStorage.setItem(TOKEN_STORAGE_KEY, envToken);
      } catch (_error) {
        // ignore storage errors (private browsing, etc.)
      }
      setToken(envToken);
    }
  }, [token]);

  useEffect(() => {
    let disposed = false;
    const store = createIndexedDbSnapshotStore({databaseName: DATABASE_NAME});
    let pendingSave: number | null = null;

    const scheduleSave = () => {
      if (pendingSave !== null) {
        window.clearTimeout(pendingSave);
      }
      pendingSave = window.setTimeout(() => {
        saveDocSnapshot(doc, store).catch((error) => {
          // eslint-disable-next-line no-console
          console.error('Failed to save document snapshot', error);
        });
        pendingSave = null;
      }, 250);
    };

    const initialize = async () => {
      try {
        const loaded = await loadDocSnapshot(doc, store);
        if (!loaded) {
          seedInitialOutline(doc, rootId);
          await saveDocSnapshot(doc, store);
        }

        if (disposed) {
          return;
        }

        setIsReady(true);
        doc.on('update', scheduleSave);
      } catch (error) {
        if (disposed) {
          return;
        }
        setInitializationError(error as Error);
        setIsReady(true);
      }
    };

    void initialize();

    return () => {
      disposed = true;
      doc.off('update', scheduleSave);
      if (pendingSave !== null) {
        window.clearTimeout(pendingSave);
      }
    };
  }, [doc, rootId]);

  const undoContext = useMemo(() => createUndoManager(doc), [doc]);
  const commandBus = useMemo(() => new CommandBus(doc, undoContext), [doc, undoContext]);

  useEffect(() => {
    if (!token || !syncServerUrl) {
      return;
    }

    try {
      window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } catch (_error) {
      // ignore storage errors (private browsing, etc.)
    }

    const connection = createWebsocketSyncConnection({
      serverUrl: syncServerUrl,
      docId: syncDocId,
      token,
      doc
    });
    syncConnectionRef.current = connection;
    setSyncStatus('connecting');
    const unsubscribe = connection.subscribeStatus((status) => {
      setSyncStatus(status);
    });

    return () => {
      unsubscribe();
      connection.disconnect();
      syncConnectionRef.current = null;
      setSyncStatus('disconnected');
    };
  }, [doc, syncServerUrl, token]);

  useEffect(() => {
    if (!token || !syncHttpBase) {
      return;
    }
    const controller = new AbortController();
    setSyncError(null);

    const loadProfile = async () => {
      try {
        const response = await fetch(`${syncHttpBase}/api/profile`, {
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
        setSyncError(null);
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
  }, [syncHttpBase, token]);

  useEffect(() => {
    const connection = syncConnectionRef.current;
    if (!connection) {
      return;
    }
    if (profile) {
      connection.setAwarenessState({
        userId: profile.id,
        displayName: profile.displayName
      });
    } else {
      connection.setAwarenessState(null);
    }
  }, [profile]);

  if (initializationError) {
    return (
      <div style={{minHeight: '100vh', fontFamily: 'sans-serif', padding: '1rem'}}>
        <h1>Thortiq Outline</h1>
        <p>Failed to load the outline: {initializationError.message}</p>
      </div>
    );
  }

  if (!isReady) {
    return (
      <div style={{minHeight: '100vh', fontFamily: 'sans-serif', padding: '1rem'}}>
        <h1>Thortiq Outline</h1>
        <p>Loading outline…</p>
      </div>
    );
  }

  return (
    <ThortiqProvider doc={doc} bus={commandBus}>
      <div style={{minHeight: '100vh', fontFamily: 'sans-serif', padding: '1rem'}}>
        <h1>Thortiq Outline</h1>
        <p>
          Sync status: {syncStatus}
          {profile ? ` · Signed in as ${profile.displayName}` : ''}
          {syncError ? ` · ${syncError}` : ''}
        </p>
        <OutlinePane rootId={rootId} />
      </div>
    </ThortiqProvider>
  );
};

export default App;
