import {useCallback, useEffect, useMemo, useState} from 'react';
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
import {SidePanel} from './SidePanel';

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

/**
 * App
 * Renders the main web shell with a resizable, collapsible left side panel
 * that never overlaps the outline. The panel shows app options (e.g. Settings)
 * and the connection indicator at its bottom. Panel width is persisted across
 * open/close cycles. No Yjs mutations are performed in this component.
 */
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

  // Left panel state (open + width) persisted in localStorage
  const [isPanelOpen, setIsPanelOpen] = useState<boolean>(() => {
    const raw = localStorage.getItem('thortiq:web:sidepanel:open');
    return raw ? raw === 'true' : true;
  });
  const [panelWidth, setPanelWidth] = useState<number>(() => {
    const raw = localStorage.getItem('thortiq:web:sidepanel:width');
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed >= 200 ? parsed : 280;
  });

  useEffect(() => {
    localStorage.setItem('thortiq:web:sidepanel:open', String(isPanelOpen));
  }, [isPanelOpen]);
  useEffect(() => {
    localStorage.setItem('thortiq:web:sidepanel:width', String(panelWidth));
  }, [panelWidth]);

  const renderFrame = (content: ReactNode) => (
    <div
      style={{
        minHeight: '100vh',
        fontFamily: 'sans-serif',
        padding: '0',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      {content}
    </div>
  );

  if (sync.initializationError) {
    return renderFrame(
      <div style={{maxWidth: '28rem', padding: '2.5rem 1.5rem 1.5rem'}}>
        <p>Failed to load the outline: {sync.initializationError.message}</p>
      </div>
    );
  }

  if (!sync.isReady) {
    return renderFrame(
      <div style={{maxWidth: '20rem', padding: '2.5rem 1.5rem 1.5rem'}}>
        <p>Loading outline…</p>
      </div>
    );
  }

  return (
    <ThortiqProvider doc={doc} bus={commandBus}>
      {renderFrame(
        // Two-column layout: left SidePanel and right OutlinePane. The side panel
        // occupies space (never overlays) so the outline always retains cursor focus.
        <div style={{flex: 1, display: 'flex', minHeight: '100vh'}}>
          <SidePanel
            isOpen={isPanelOpen}
            width={panelWidth}
            onToggle={() => setIsPanelOpen(v => !v)}
            onResize={setPanelWidth}
            status={sync.syncStatus}
            userDisplayName={profile?.displayName ?? null}
            syncError={sync.syncError ?? null}
          />
          <div style={{flex: 1, minWidth: 0, paddingLeft: 8}}>
            <OutlinePane rootId={rootId} />
          </div>
        </div>
      )}
    </ThortiqProvider>
  );
};

export default App;
