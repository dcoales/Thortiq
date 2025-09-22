import {
  CommandBus,
  LOCAL_ORIGIN,
  REMOTE_ORIGIN,
  createEdgeId,
  createNodeId,
  createThortiqDoc,
  createUndoManager,
  createResolverFromDoc,
  getNodeRecord,
  initializeCollections,
  insertEdgeRecord,
  upsertNodeRecord,
  createSessionId
} from '..';
import type {Command, EdgeRecord, NodeRecord, OutlineChildResolver, SessionState} from '..';

const now = () => new Date().toISOString();

const createNode = (html: string): NodeRecord => {
  const id = createNodeId();
  const timestamp = now();
  return {
    id,
    html,
    tags: [],
    attributes: {},
    createdAt: timestamp,
    updatedAt: timestamp
  };
};

const createEdge = (parentId: string, childId: string, ordinal = 0): EdgeRecord => {
  const timestamp = now();
  return {
    id: createEdgeId(),
    parentId,
    childId,
    role: 'primary',
    collapsed: false,
    ordinal,
    createdAt: timestamp,
    updatedAt: timestamp
  };
};

describe('CommandBus', () => {
  const setup = () => {
    const doc = createThortiqDoc();
    const undoContext = createUndoManager(doc);
    const bus = new CommandBus(doc, undoContext, {origin: LOCAL_ORIGIN});

    const root = createNode('Root');
    upsertNodeRecord(doc, root);

    return {doc, bus, undoContext, root};
  };

  it('creates nodes and records undo history', () => {
    const {doc, bus, undoContext, root} = setup();
    const child = createNode('Child');
    const edge = createEdge(root.id, child.id, 0);
    const command: Command = {kind: 'create-node', node: child, edge};

    bus.execute(command);

    expect(getNodeRecord(doc, child.id)?.html).toBe('Child');

    bus.undo();
    expect(getNodeRecord(doc, child.id)).toBeUndefined();

    bus.redo();
    expect(getNodeRecord(doc, child.id)?.html).toBe('Child');

    undoContext.detach();
  });

  it('updates node content with undo support', () => {
    const {doc, bus, undoContext, root} = setup();
    const node = createNode('Initial');
    const edge = createEdge(root.id, node.id, 0);
    bus.execute({kind: 'create-node', node, edge});

    const updatedAt = now();
    bus.execute({
      kind: 'update-node',
      nodeId: node.id,
      patch: {
        html: '<p>Edited</p>',
        updatedAt
      }
    });

    expect(getNodeRecord(doc, node.id)?.html).toBe('<p>Edited</p>');

    bus.undo();
    expect(getNodeRecord(doc, node.id)?.html).toBe('Initial');

    bus.redo();
    expect(getNodeRecord(doc, node.id)?.html).toBe('<p>Edited</p>');

    undoContext.detach();
  });

  it('deletes a subtree and restores via undo', () => {
    const {doc, bus, undoContext, root} = setup();

    const parent = createNode('Parent');
    bus.execute({kind: 'create-node', node: parent, edge: createEdge(root.id, parent.id, 0)});

    const child = createNode('Child');
    bus.execute({kind: 'create-node', node: child, edge: createEdge(parent.id, child.id, 0)});

    const timestamp = now();
    bus.execute({kind: 'delete-node', nodeId: parent.id, timestamp});

    expect(getNodeRecord(doc, parent.id)).toBeUndefined();
    expect(getNodeRecord(doc, child.id)).toBeUndefined();

    bus.undo();
    expect(getNodeRecord(doc, parent.id)).toBeDefined();
    expect(getNodeRecord(doc, child.id)).toBeDefined();

    undoContext.detach();
  });

  it('moves nodes while preventing cycles', () => {
    const {doc, bus, undoContext, root} = setup();

    const first = createNode('First');
    const second = createNode('Second');

    const firstEdge = createEdge(root.id, first.id, 0);
    const secondEdge = createEdge(root.id, second.id, 1);

    bus.execute({kind: 'create-node', node: first, edge: firstEdge});
    bus.execute({kind: 'create-node', node: second, edge: secondEdge});

    const moveTimestamp = now();
    bus.execute({
      kind: 'move-node',
      edgeId: secondEdge.id,
      targetParentId: first.id,
      timestamp: moveTimestamp
    });

    const afterMove: OutlineChildResolver = createResolverFromDoc(doc);
    expect(afterMove(root.id)).toHaveLength(1);

    expect(() =>
      bus.execute({
        kind: 'move-node',
        edgeId: firstEdge.id,
        targetParentId: second.id,
        timestamp: now()
      })
    ).toThrow('Cycle detected');

    bus.undo();
    const afterUndo: OutlineChildResolver = createResolverFromDoc(doc);
    expect(afterUndo(root.id)).toHaveLength(2);

    undoContext.detach();
  });

  it('indents and outdents nodes', () => {
    const {doc, bus, undoContext, root} = setup();

    const first = createNode('First');
    const second = createNode('Second');
    const third = createNode('Third');

    const firstEdge = createEdge(root.id, first.id, 0);
    const secondEdge = createEdge(root.id, second.id, 1);
    const thirdEdge = createEdge(root.id, third.id, 2);

    bus.execute({kind: 'create-node', node: first, edge: firstEdge});
    bus.execute({kind: 'create-node', node: second, edge: secondEdge});
    bus.execute({kind: 'create-node', node: third, edge: thirdEdge});

    bus.execute({kind: 'indent-node', edgeId: secondEdge.id, timestamp: now()});

    let resolver: OutlineChildResolver = createResolverFromDoc(doc);
    let rootChildren = resolver(root.id);
    expect(rootChildren).toHaveLength(2);

    const firstChildren = resolver(first.id);
    expect(firstChildren).toHaveLength(1);
    expect(firstChildren[0].childId).toBe(second.id);

    bus.execute({kind: 'outdent-node', edgeId: secondEdge.id, timestamp: now()});

    resolver = createResolverFromDoc(doc);
    rootChildren = resolver(root.id);
    expect(rootChildren).toHaveLength(3);
    expect(rootChildren[1].childId).toBe(second.id);

    bus.undo();
    resolver = createResolverFromDoc(doc);
    rootChildren = resolver(root.id);
    expect(rootChildren).toHaveLength(2);

    bus.redo();
    resolver = createResolverFromDoc(doc);
    rootChildren = resolver(root.id);
    expect(rootChildren).toHaveLength(3);

    undoContext.detach();
  });

  it('tracks sessions through the command bus', () => {
    const {doc, bus, undoContext} = setup();

    const session: SessionState = {
      id: createSessionId(),
      name: 'Test Session',
      paneOrder: [],
      panes: {},
      activePaneId: null,
      createdAt: now(),
      updatedAt: now()
    };

    bus.execute({kind: 'upsert-session', session});

    const stored = initializeCollections(doc).sessions.get(session.id);
    expect(stored?.name).toBe('Test Session');

    bus.undo();
    expect(initializeCollections(doc).sessions.get(session.id)).toBeUndefined();

    bus.redo();
    expect(initializeCollections(doc).sessions.get(session.id)).toBeDefined();

    undoContext.detach();
  });

  it('ignores remote-origin mutations in undo history', () => {
    const {doc, bus, undoContext, root} = setup();
    const node = createNode('Remote');

    upsertNodeRecord(doc, node);
    insertEdgeRecord(doc, createEdge(root.id, node.id, 0));

    const initialUndoSize = undoContext.undoManager.undoStack.length;

    upsertNodeRecord(doc, {
      ...node,
      html: 'Remote update',
      updatedAt: now()
    }, REMOTE_ORIGIN);

    expect(undoContext.undoManager.undoStack.length).toBe(initialUndoSize);

    bus.execute({
      kind: 'update-node',
      nodeId: node.id,
      patch: {
        html: 'Local change',
        updatedAt: now()
      }
    });

    expect(undoContext.undoManager.undoStack.length).toBeGreaterThan(initialUndoSize);

    undoContext.detach();
  });
});
