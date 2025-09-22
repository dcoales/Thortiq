import '@testing-library/jest-dom';
import {act, fireEvent, render} from '@testing-library/react';

import {
  CommandBus,
  NodeEditor,
  ThortiqProvider,
  createEdgeId,
  createNodeId,
  createThortiqDoc,
  createUndoManager,
  getOrCreateNodeText,
  initializeCollections,
  upsertNodeRecord
} from '..';
import type {EdgeRecord, NodeRecord} from '..';

const timestamp = () => new Date().toISOString();

const createNode = (text: string): NodeRecord => {
  const id = createNodeId();
  const now = timestamp();
  return {
    id,
    html: text,
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
    createdAt: now,
    updatedAt: now
  };
};

const renderEditor = (doc: ReturnType<typeof createThortiqDoc>, bus: CommandBus, nodeId: string, edge: EdgeRecord | null) => {
  return render(
    <ThortiqProvider doc={doc} bus={bus}>
      <NodeEditor nodeId={nodeId} edge={edge} />
    </ThortiqProvider>
  );
};

describe('NodeEditor interactions', () => {
  it('creates a sibling above when Enter is pressed at the start', () => {
    const doc = createThortiqDoc();
    const undoContext = createUndoManager(doc);
    const bus = new CommandBus(doc, undoContext);

    const root = createNode('Root');
    upsertNodeRecord(doc, root);

    const node = createNode('alpha');
    const edge = createEdge(root.id, node.id, 0);
    bus.execute({kind: 'create-node', node, edge, initialText: 'alpha'});

    const edgeArray = initializeCollections(doc).edges.get(root.id);
    const currentEdge = edgeArray ? edgeArray.toArray()[0] ?? null : null;
    expect(currentEdge).not.toBeNull();

    const renderResult = renderEditor(doc, bus, node.id, currentEdge);
    const {getByLabelText, unmount} = renderResult;
    const textarea = getByLabelText(`Node ${node.id}`) as HTMLTextAreaElement;

    act(() => {
      textarea.setSelectionRange(0, 0);
      fireEvent.keyDown(textarea, {key: 'Enter', code: 'Enter'});
    });

    const edgesArray = initializeCollections(doc).edges.get(root.id);
    expect(edgesArray?.length).toBe(2);
    const rows = edgesArray?.toArray() ?? [];
    expect(rows[0]?.childId).not.toBe(node.id);
    unmount();
    undoContext.detach();
  });

  it('splits the node when Enter is pressed in the middle', () => {
    const doc = createThortiqDoc();
    const undoContext = createUndoManager(doc);
    const bus = new CommandBus(doc, undoContext);

    const root = createNode('Root');
    upsertNodeRecord(doc, root);

    const node = createNode('hello world');
    const edge = createEdge(root.id, node.id, 0);
    bus.execute({kind: 'create-node', node, edge, initialText: 'hello world'});

    const edgeArray = initializeCollections(doc).edges.get(root.id);
    const currentEdge = edgeArray ? edgeArray.toArray()[0] ?? null : null;
    expect(currentEdge).not.toBeNull();

    const {getByLabelText, unmount} = renderEditor(doc, bus, node.id, currentEdge);
    const textarea = getByLabelText(`Node ${node.id}`) as HTMLTextAreaElement;

    act(() => {
      textarea.setSelectionRange(5, 5);
      fireEvent.keyDown(textarea, {key: 'Enter', code: 'Enter'});
    });

    const edges = initializeCollections(doc).edges.get(root.id)?.toArray() ?? [];
    expect(edges.length).toBe(2);
    const newEdge = edges[1];
    const newTextNode = getOrCreateNodeText(doc, newEdge.childId);
    const newText = String(newTextNode.toJSON() ?? '');
    expect(newText).toBe(' world');

    const currentTextNode = getOrCreateNodeText(doc, node.id);
    const currentText = String(currentTextNode.toJSON() ?? '');
    expect(currentText).toBe('hello');
    unmount();
    undoContext.detach();
  });

  it('creates a child when Enter is pressed at end and node is expanded', () => {
    const doc = createThortiqDoc();
    const undoContext = createUndoManager(doc);
    const bus = new CommandBus(doc, undoContext);

    const root = createNode('Root');
    upsertNodeRecord(doc, root);

    const parent = createNode('parent');
    const parentEdge = createEdge(root.id, parent.id, 0);
    bus.execute({kind: 'create-node', node: parent, edge: parentEdge, initialText: 'parent'});

    // existing child to mark as expanded
    const existingChild = createNode('child');
    const existingEdge = createEdge(parent.id, existingChild.id, 0);
    bus.execute({kind: 'create-node', node: existingChild, edge: existingEdge, initialText: 'child'});

    const parentEdgeArray = initializeCollections(doc).edges.get(root.id);
    const parentEdgeRecord = parentEdgeArray ? parentEdgeArray.toArray()[0] ?? null : null;
    expect(parentEdgeRecord).not.toBeNull();

    const {getByLabelText, unmount} = renderEditor(doc, bus, parent.id, parentEdgeRecord);
    const textarea = getByLabelText(`Node ${parent.id}`) as HTMLTextAreaElement;

    act(() => {
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      fireEvent.keyDown(textarea, {key: 'Enter', code: 'Enter'});
    });

    const childEdges = initializeCollections(doc).edges.get(parent.id)?.toArray() ?? [];
    expect(childEdges.length).toBe(2);
    unmount();
    undoContext.detach();
  });

  it('indents and outdents nodes with Tab and Shift+Tab', () => {
    const doc = createThortiqDoc();
    const undoContext = createUndoManager(doc);
    const bus = new CommandBus(doc, undoContext);

    const root = createNode('Root');
    upsertNodeRecord(doc, root);

    const first = createNode('first');
    const second = createNode('second');

    const firstEdge = createEdge(root.id, first.id, 0);
    const secondEdge = createEdge(root.id, second.id, 1);

    bus.execute({kind: 'create-node', node: first, edge: firstEdge, initialText: 'first'});
    bus.execute({kind: 'create-node', node: second, edge: secondEdge, initialText: 'second'});

    const rootEdgeArray = initializeCollections(doc).edges.get(root.id)?.toArray() ?? [];
    const secondEdgeRecord = rootEdgeArray[1] ?? null;
    expect(secondEdgeRecord).not.toBeNull();

    const initialRender = renderEditor(doc, bus, second.id, secondEdgeRecord);
    const {getByLabelText, unmount: unmountInitial} = initialRender;
    const textarea = getByLabelText(`Node ${second.id}`) as HTMLTextAreaElement;

    act(() => {
      fireEvent.keyDown(textarea, {key: 'Tab', code: 'Tab'});
    });

    const rootEdgesAfterIndent = initializeCollections(doc).edges.get(root.id)?.toArray() ?? [];
    expect(rootEdgesAfterIndent.length).toBe(1);

    const firstChildren = initializeCollections(doc).edges.get(first.id)?.toArray() ?? [];
    expect(firstChildren.length).toBe(1);

    const nestedEdge = firstChildren[0] ?? null;
    expect(nestedEdge).not.toBeNull();
    unmountInitial();

    const editorAfterIndent = renderEditor(doc, bus, second.id, nestedEdge);
    const textareaAfterIndent = editorAfterIndent.getByLabelText(`Node ${second.id}`) as HTMLTextAreaElement;

    act(() => {
      fireEvent.keyDown(textareaAfterIndent, {key: 'Tab', code: 'Tab', shiftKey: true});
    });

    const rootEdgesAfterOutdent = initializeCollections(doc).edges.get(root.id)?.toArray() ?? [];
    expect(rootEdgesAfterOutdent.length).toBe(2);
    editorAfterIndent.unmount();
    undoContext.detach();
  });
});
