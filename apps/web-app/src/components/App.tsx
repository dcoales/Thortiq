import {useCallback, useEffect, useMemo} from 'react';
import type {ReactNode} from 'react';
import {
  CommandBus,
  OutlinePane,
  ThortiqProvider,
  createIndexedDbSnapshotStore,
  createThortiqDoc,
  createUndoManager,
  ensureDocumentRoot,
  useOutlineSync
} from '@thortiq/client-core';

import {createWebSyncEnvironment} from '../sync/createWebSyncEnvironment';

const DATABASE_NAME = 'thortiq-web-outline';
const TOKEN_STORAGE_KEY = 'thortiq:syncToken';
const DEFAULT_DOC_ID = 'thortiq-outline';
const SYNC_DISABLED_MESSAGE = 'Sync disabled: missing token or server URL';

const SYNC_ENV_KEYS = {
  token: 'VITE_SYNC_TOKEN',
  serverUrl: 'VITE_SYNC_SERVER_URL',
  httpUrl: 'VITE_SYNC_HTTP_URL',
  docId: 'VITE_SYNC_DOC_ID'
} as const;

export const App = () => {
  const doc = useMemo(() => createThortiqDoc(), []);
  const environment = useMemo(() => createWebSyncEnvironment(), []);
  const snapshotFactory = useCallback(
    () => createIndexedDbSnapshotStore({databaseName: DATABASE_NAME}),
    []
  );

  const sync = useOutlineSync(doc, environment, {
    tokenStorageKey: TOKEN_STORAGE_KEY,
    defaultDocId: DEFAULT_DOC_ID,
    syncDisabledMessage: SYNC_DISABLED_MESSAGE,
    envKeys: SYNC_ENV_KEYS,
    snapshotStoreFactory: snapshotFactory,
    profileEndpoint: '/api/profile'
  });

  const {profile, setAwarenessState} = sync;

  const documentRoot = useMemo(() => ensureDocumentRoot(doc), [doc]);
  const rootId = documentRoot.id;
  const undoContext = useMemo(() => createUndoManager(doc), [doc]);
  const commandBus = useMemo(() => new CommandBus(doc, undoContext), [doc, undoContext]);

  useEffect(() => {
    if (!profile) {
      setAwarenessState(null);
      return;
    }
    setAwarenessState({
      userId: profile.id,
      displayName: profile.displayName
    });
  }, [profile, setAwarenessState]);

  const indicatorColor = sync.syncStatus === 'connected' ? '#16a34a' : '#9ca3af';
  const indicatorDetails: string[] = [`Status: ${sync.syncStatus}`];
  if (profile) {
    indicatorDetails.push(`Signed in as ${profile.displayName}`);
  }
  if (sync.syncError) {
    indicatorDetails.push(`Error: ${sync.syncError}`);
  }
  const indicatorTitle = indicatorDetails.join(' · ');
  const indicatorAria = indicatorDetails.join('. ');

  const renderFrame = (content: ReactNode) => (
    <div
      style={{
        minHeight: '100vh',
        fontFamily: 'sans-serif',
        padding: '2.5rem 1.5rem 1.5rem',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      <div style={{position: 'absolute', top: '1.5rem', right: '1.5rem'}}>
        <div
          role="status"
          aria-label={indicatorAria}
          title={indicatorTitle}
          style={{
            width: '12px',
            height: '12px',
            borderRadius: '50%',
            backgroundColor: indicatorColor,
            border: '1px solid #d1d5db'
          }}
        />
      </div>
      {content}
    </div>
  );

  if (sync.initializationError) {
    return renderFrame(
      <div style={{maxWidth: '28rem'}}>
        <p>Failed to load the outline: {sync.initializationError.message}</p>
      </div>
    );
  }

  if (!sync.isReady) {
    return renderFrame(
      <div style={{maxWidth: '20rem'}}>
        <p>Loading outline…</p>
      </div>
    );
  }

  return (
    <ThortiqProvider doc={doc} bus={commandBus}>
      {renderFrame(
        <div style={{flex: 1, display: 'flex'}}>
          <OutlinePane rootId={rootId} />
        </div>
      )}
    </ThortiqProvider>
  );
};

export default App;
