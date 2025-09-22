import {useMemo} from 'react';
import {
  CommandBus,
  OutlinePane,
  ThortiqProvider,
  createEdgeId,
  createNodeId,
  createThortiqDoc,
  createUndoManager,
  upsertNodeRecord,
  insertEdgeRecord
} from '@thortiq/client-core';

const timestamp = () => new Date().toISOString();

const initializeDoc = () => {
  const doc = createThortiqDoc();
  const rootId = createNodeId();
  const now = timestamp();

  upsertNodeRecord(doc, {
    id: rootId,
    html: 'Root node',
    tags: [],
    attributes: {},
    createdAt: now,
    updatedAt: now
  });

  const seeds = ['Planning session', 'Daily notes', 'Ideas'];
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

  return {doc, rootId};
};

export const App = () => {
  const {doc, rootId} = useMemo(() => initializeDoc(), []);
  const undoContext = useMemo(() => createUndoManager(doc), [doc]);
  const commandBus = useMemo(() => new CommandBus(doc, undoContext), [doc, undoContext]);

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
