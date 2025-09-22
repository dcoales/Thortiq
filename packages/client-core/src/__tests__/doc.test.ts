import * as Y from 'yjs';

import {
  MemorySnapshotStore,
  createEdgeId,
  createSessionId,
  createThortiqDoc,
  createNodeId,
  getNodeRecord,
  insertEdgeRecord,
  loadDocSnapshot,
  removeEdgeRecord,
  removeNodeRecord,
  replaceEdgeRecords,
  saveDocSnapshot,
  transactDoc,
  upsertNodeRecord,
  upsertSessionState
} from '..';
import type {EdgeRecord, SessionState} from '..';

const now = new Date().toISOString();

const createEdge = (params: Partial<EdgeRecord> & Pick<EdgeRecord, 'parentId' | 'childId'>): EdgeRecord => {
  return {
    id: params.id ?? createEdgeId(),
    parentId: params.parentId,
    childId: params.childId,
    role: params.role ?? 'primary',
    collapsed: params.collapsed ?? false,
    ordinal: params.ordinal ?? 0,
    createdAt: params.createdAt ?? now,
    updatedAt: params.updatedAt ?? now
  };
};

describe('Thortiq Yjs document helpers', () => {
  it('initializes maps when creating a doc', () => {
    const doc = createThortiqDoc();
    const state = doc.toJSON();

    expect(state).toHaveProperty('nodes');
    expect(state).toHaveProperty('edges');
    expect(state).toHaveProperty('sessions');
  });

  it('inserts nodes and edges via transactions', () => {
    const doc = createThortiqDoc();
    const parentId = createNodeId();
    const childId = createNodeId();

    transactDoc(doc, () => {
      upsertNodeRecord(doc, {
        id: parentId,
        html: '<p>Parent</p>',
        tags: [],
        attributes: {},
        createdAt: now,
        updatedAt: now
      });

      upsertNodeRecord(doc, {
        id: childId,
        html: '<p>Child</p>',
        tags: [],
        attributes: {},
        createdAt: now,
        updatedAt: now
      });
    });

    insertEdgeRecord(doc, createEdge({parentId, childId, ordinal: 0}));

    const node = getNodeRecord(doc, childId);
    expect(node?.html).toBe('<p>Child</p>');
  });

  it('prevents cycles when inserting edges', () => {
    const doc = createThortiqDoc();
    const root = createNodeId();
    const child = createNodeId();

    transactDoc(doc, () => {
      upsertNodeRecord(doc, {
        id: root,
        html: '<p>Root</p>',
        tags: [],
        attributes: {},
        createdAt: now,
        updatedAt: now
      });
      upsertNodeRecord(doc, {
        id: child,
        html: '<p>Child</p>',
        tags: [],
        attributes: {},
        createdAt: now,
        updatedAt: now
      });
    });

    insertEdgeRecord(doc, createEdge({parentId: root, childId: child}));

    expect(() => insertEdgeRecord(doc, createEdge({parentId: child, childId: root}))).toThrow(
      'Cycle detected'
    );
  });

  it('replaces and removes edges', () => {
    const doc = createThortiqDoc();
    const parentId = createNodeId();
    const childA = createNodeId();
    const childB = createNodeId();

    transactDoc(doc, () => {
      upsertNodeRecord(doc, {
        id: parentId,
        html: '<p>Parent</p>',
        tags: [],
        attributes: {},
        createdAt: now,
        updatedAt: now
      });
      upsertNodeRecord(doc, {
        id: childA,
        html: '<p>A</p>',
        tags: [],
        attributes: {},
        createdAt: now,
        updatedAt: now
      });
      upsertNodeRecord(doc, {
        id: childB,
        html: '<p>B</p>',
        tags: [],
        attributes: {},
        createdAt: now,
        updatedAt: now
      });
    });

    insertEdgeRecord(doc, createEdge({parentId, childId: childA, ordinal: 0}));
    replaceEdgeRecords(doc, parentId, [createEdge({parentId, childId: childB, ordinal: 0})]);

    removeEdgeRecord(doc, parentId, (edge) => edge.childId === childB);

    const docEdges = doc.getMap<Y.Array<EdgeRecord>>('edges');
    expect(docEdges.get(parentId)).toBeUndefined();
  });

  it('persists and restores snapshots through memory store', async () => {
    const doc = createThortiqDoc();
    const store = new MemorySnapshotStore();
    const nodeId = createNodeId();

    transactDoc(doc, () => {
      upsertNodeRecord(doc, {
        id: nodeId,
        html: '<p>Persisted</p>',
        tags: [],
        attributes: {},
        createdAt: now,
        updatedAt: now
      });
    });

    const session: SessionState = {
      id: createSessionId(),
      name: 'Default',
      paneOrder: [],
      panes: {},
      activePaneId: null,
      createdAt: now,
      updatedAt: now
    };

    upsertSessionState(doc, session);

    await saveDocSnapshot(doc, store);

    const restoredDoc = createThortiqDoc();
    const loaded = await loadDocSnapshot(restoredDoc, store);

    expect(loaded).toBe(true);
    const restoredNode = getNodeRecord(restoredDoc, nodeId);
    expect(restoredNode?.html).toBe('<p>Persisted</p>');
    const restoredSessions = restoredDoc.getMap<SessionState>('sessions');
    expect(restoredSessions.get(session.id)?.name).toBe('Default');
  });

  it('removes node records along with edge collections', () => {
    const doc = createThortiqDoc();
    const parentId = createNodeId();
    const childId = createNodeId();

    transactDoc(doc, () => {
      upsertNodeRecord(doc, {
        id: parentId,
        html: '<p>Parent</p>',
        tags: [],
        attributes: {},
        createdAt: now,
        updatedAt: now
      });
      upsertNodeRecord(doc, {
        id: childId,
        html: '<p>Child</p>',
        tags: [],
        attributes: {},
        createdAt: now,
        updatedAt: now
      });
    });

    insertEdgeRecord(doc, createEdge({parentId, childId}));

    removeNodeRecord(doc, parentId);

    const nodes = doc.getMap('nodes');
    expect(nodes.get(parentId)).toBeUndefined();
    const edges = doc.getMap('edges');
    expect(edges.get(parentId)).toBeUndefined();
  });

  it('upserts session state while maintaining timestamps', () => {
    const doc = createThortiqDoc();
    const sessionId = createSessionId();

    const firstState: SessionState = {
      id: sessionId,
      name: 'Morning',
      paneOrder: [],
      panes: {},
      activePaneId: null,
      createdAt: now,
      updatedAt: now
    };

    upsertSessionState(doc, firstState);

    const updated: SessionState = {
      ...firstState,
      name: 'Evening',
      updatedAt: new Date().toISOString()
    };

    upsertSessionState(doc, updated);

    const sessions = doc.getMap<SessionState>('sessions');
    const stored = sessions.get(sessionId);
    expect(stored?.name).toBe('Evening');
    expect(stored?.createdAt).toBe(firstState.createdAt);
  });

  it('supports clearing persistence store', async () => {
    const doc = createThortiqDoc();
    const store = new MemorySnapshotStore();

    await saveDocSnapshot(doc, store);
    await store.clear?.();

    const newDoc = createThortiqDoc();
    const loaded = await loadDocSnapshot(newDoc, store);

    expect(loaded).toBe(false);
  });

  it('round-trips document updates through Yjs state vectors', () => {
    const doc = createThortiqDoc();
    const sessionId = createSessionId();

    upsertSessionState(doc, {
      id: sessionId,
      name: 'Round trip',
      paneOrder: [],
      panes: {},
      activePaneId: null,
      createdAt: now,
      updatedAt: now
    });

    const update = Y.encodeStateAsUpdate(doc);
    const freshDoc = createThortiqDoc();
    Y.applyUpdate(freshDoc, update);

    const restoredSessions = freshDoc.getMap<SessionState>('sessions');
    expect(restoredSessions.size).toBe(1);
  });
});
