import {SelectionManager} from '../selection/selectionManager';
import {CommandBus, createEdgeId, createNodeId, createThortiqDoc, createUndoManager, upsertNodeRecord} from '..';
import type {EdgeRecord, NodeRecord} from '..';

const timestamp = () => new Date().toISOString();

const createNode = (html: string): NodeRecord => {
  const id = createNodeId();
  const now = timestamp();
  return {
    id,
    html,
    tags: [],
    attributes: {},
    createdAt: now,
    updatedAt: now
  };
};

const createEdge = (parentId: string, childId: string, ordinal: number): EdgeRecord => {
  const now = timestamp();
  return {
    id: createEdgeId(),
    parentId,
    childId,
    role: 'primary',
    collapsed: false,
    ordinal,
    selected: false,
    createdAt: now,
    updatedAt: now
  };
};

describe('SelectionManager', () => {
  const setup = () => {
    const doc = createThortiqDoc();
    const undoContext = createUndoManager(doc);
    const bus = new CommandBus(doc, undoContext);
    const manager = new SelectionManager(doc);

    const root = createNode('Root');
    upsertNodeRecord(doc, root);

    return {doc, undoContext, bus, manager, rootId: root.id};
  };

  it('selects a single edge', () => {
    const {bus, manager, rootId} = setup();

    const first = createNode('First');
    const second = createNode('Second');

    const firstEdge = createEdge(rootId, first.id, 0);
    const secondEdge = createEdge(rootId, second.id, 1);

    bus.execute({kind: 'create-node', node: first, edge: firstEdge, initialText: 'First'});
    bus.execute({kind: 'create-node', node: second, edge: secondEdge, initialText: 'Second'});

    const snapshot = manager.selectSingle(rootId, firstEdge.id);
    expect(snapshot.selectedEdgeIds).toContain(firstEdge.id);
    expect(snapshot.selectedEdgeIds).toHaveLength(1);
  });

  it('keeps descendants selected when range crosses to parent sibling', () => {
    const {bus, manager, rootId} = setup();

    const parent = createNode('Parent');
    const sibling = createNode('Sibling');

    const parentEdge = createEdge(rootId, parent.id, 0);
    const siblingEdge = createEdge(rootId, sibling.id, 1);

    bus.execute({kind: 'create-node', node: parent, edge: parentEdge, initialText: 'Parent'});
    bus.execute({kind: 'create-node', node: sibling, edge: siblingEdge, initialText: 'Sibling'});

    const childA = createNode('A');
    const childB = createNode('B');

    const childEdgeA = createEdge(parent.id, childA.id, 0);
    const childEdgeB = createEdge(parent.id, childB.id, 1);

    bus.execute({kind: 'create-node', node: childA, edge: childEdgeA, initialText: 'A'});
    bus.execute({kind: 'create-node', node: childB, edge: childEdgeB, initialText: 'B'});

    const snapshot = manager.selectRange(rootId, childEdgeA.id, siblingEdge.id);

    expect(snapshot.selectedEdgeIds).toEqual(
      expect.arrayContaining([
        childEdgeA.id,
        childEdgeB.id,
        siblingEdge.id
      ])
    );
    expect(snapshot.selectedEdgeIds).not.toContain(parentEdge.id);
    expect(snapshot.selectedEdgeIds).toHaveLength(3);
  });

  it('keeps child-only selection when range stays within siblings', () => {
    const {bus, manager, rootId} = setup();

    const parent = createNode('Parent');

    const parentEdge = createEdge(rootId, parent.id, 0);

    bus.execute({kind: 'create-node', node: parent, edge: parentEdge, initialText: 'Parent'});

    const childA = createNode('A');
    const childB = createNode('B');

    const childEdgeA = createEdge(parent.id, childA.id, 0);
    const childEdgeB = createEdge(parent.id, childB.id, 1);

    bus.execute({kind: 'create-node', node: childA, edge: childEdgeA, initialText: 'A'});
    bus.execute({kind: 'create-node', node: childB, edge: childEdgeB, initialText: 'B'});

    const snapshot = manager.selectRange(rootId, childEdgeA.id, childEdgeB.id);

    expect(snapshot.selectedEdgeIds).toContain(childEdgeA.id);
    expect(snapshot.selectedEdgeIds).toContain(childEdgeB.id);
    expect(snapshot.selectedEdgeIds).toHaveLength(2);
    expect(snapshot.selectedEdgeIds).not.toContain(parentEdge.id);
  });

  it('does not push selection changes into undo history', () => {
    const {bus, manager, undoContext, rootId} = setup();

    const first = createNode('First');
    const second = createNode('Second');

    const firstEdge = createEdge(rootId, first.id, 0);
    const secondEdge = createEdge(rootId, second.id, 1);

    bus.execute({kind: 'create-node', node: first, edge: firstEdge, initialText: 'First'});
    bus.execute({kind: 'create-node', node: second, edge: secondEdge, initialText: 'Second'});

    const initialUndoDepth = undoContext.undoManager.undoStack.length;
    manager.selectRange(rootId, firstEdge.id, secondEdge.id);

    expect(undoContext.undoManager.undoStack.length).toBe(initialUndoDepth);
  });

  it('moves focus between edges with keyboard navigation helpers', () => {
    const {bus, manager, rootId} = setup();

    const first = createNode('First');
    const second = createNode('Second');

    const firstEdge = createEdge(rootId, first.id, 0);
    const secondEdge = createEdge(rootId, second.id, 1);

    bus.execute({kind: 'create-node', node: first, edge: firstEdge, initialText: 'First'});
    bus.execute({kind: 'create-node', node: second, edge: secondEdge, initialText: 'Second'});

    manager.selectSingle(rootId, firstEdge.id);
    const moved = manager.moveFocus(rootId, firstEdge.id, 'next');

    expect(moved.anchorEdgeId).toBe(secondEdge.id);
    expect(moved.selectedEdgeIds).toEqual([secondEdge.id]);
  });
});
