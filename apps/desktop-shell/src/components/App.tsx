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
    html: 'Desktop Root',
    tags: [],
    attributes: {},
    createdAt: now,
    updatedAt: now
  });

  const seeds = ['Projects', 'Research', 'Inbox'];
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

export const DesktopApp = () => {
  const {doc, rootId} = useMemo(() => initializeDoc(), []);
  const undoContext = useMemo(() => createUndoManager(doc), [doc]);
  const commandBus = useMemo(() => new CommandBus(doc, undoContext), [doc, undoContext]);

  return (
    <ThortiqProvider doc={doc} bus={commandBus}>
      <div style={{minHeight: '100vh', padding: '1rem', fontFamily: 'sans-serif'}}>
        <h1>Thortiq Desktop Preview</h1>
        <OutlinePane rootId={rootId} />
      </div>
    </ThortiqProvider>
  );
};

export default DesktopApp;

