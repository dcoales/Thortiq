import {useMemo} from 'react';
import {
  CommandBus,
  OutlinePane,
  ThortiqProvider,
  createThortiqDoc,
  createUndoManager,
  ensureDocumentRoot,
  useOutlineSync
} from '@thortiq/client-core';

import {createDesktopSyncEnvironment} from '../sync/createDesktopSyncEnvironment';

const TOKEN_STORAGE_KEY = 'thortiq:desktopToken';
const DEFAULT_DOC_ID = 'thortiq-outline';

export const DesktopApp = () => {
  const doc = useMemo(() => createThortiqDoc(), []);
  const environment = useMemo(() => createDesktopSyncEnvironment(), []);
  const sync = useOutlineSync(doc, environment, {
    tokenStorageKey: TOKEN_STORAGE_KEY,
    defaultDocId: DEFAULT_DOC_ID,
    syncDisabledMessage: 'Desktop preview sync disabled',
    envKeys: {}
  });

  const documentRoot = useMemo(() => ensureDocumentRoot(doc), [doc]);
  const rootId = documentRoot.id;
  const undoContext = useMemo(() => createUndoManager(doc), [doc]);
  const commandBus = useMemo(() => new CommandBus(doc, undoContext), [doc, undoContext]);

  if (sync.initializationError) {
    return <div>Failed to load outline: {sync.initializationError.message}</div>;
  }

  if (!sync.isReady) {
    return <div>Loading outline…</div>;
  }

  return (
    <ThortiqProvider doc={doc} bus={commandBus}>
      {/* Full-height app shell without body scrollbars */}
      <div style={{height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: 'sans-serif'}}>
        <div style={{padding: '1rem 1rem 0.5rem'}}>
          <h1 style={{margin: 0}}>Thortiq Desktop Preview</h1>
        </div>
        {/* Content area fills remaining space; OutlinePane manages its own vertical scrolling */}
        <div style={{flex: 1, minHeight: 0, overflow: 'hidden'}}>
          <OutlinePane rootId={rootId} />
        </div>
      </div>
    </ThortiqProvider>
  );
};

export default DesktopApp;
