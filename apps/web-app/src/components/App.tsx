import {useEffect, useMemo, useState} from 'react';
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
  initializeCollections
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

export const App = () => {
  const doc = useMemo(() => createThortiqDoc(), []);
  const documentRoot = useMemo(() => ensureDocumentRoot(doc), [doc]);
  const rootId = documentRoot.id;
  const [isReady, setIsReady] = useState(false);
  const [initializationError, setInitializationError] = useState<Error | null>(null);

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
        <OutlinePane rootId={rootId} />
      </div>
    </ThortiqProvider>
  );
};

export default App;
