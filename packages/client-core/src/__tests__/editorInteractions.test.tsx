import '@testing-library/jest-dom';
import {act, render, waitFor} from '@testing-library/react';
import {TextSelection} from 'prosemirror-state';
import type {EditorView} from 'prosemirror-view';

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

type EditorElement = HTMLDivElement & {__pmView__?: EditorView};

const getEditorElement = (container: HTMLElement, nodeId: string): EditorElement => {
  const editor = container.querySelector<EditorElement>(`div[aria-label="Node ${nodeId}"]`);
  if (!editor) {
    throw new Error(`Missing editor for node ${nodeId}`);
  }
  const view = editor.__pmView__;
  if (!view) {
    throw new Error('Expected ProseMirror view to be attached');
  }
  return editor;
};

const getView = (element: EditorElement): EditorView => {
  const view = element.__pmView__;
  if (!view) {
    throw new Error('Expected ProseMirror view to be attached');
  }
  return view;
};

const waitForDocText = async (element: EditorElement, expected: string) => {
  const view = getView(element);
  await waitFor(() => {
    expect(view.state.doc.textContent).toBe(expected);
  });
};

const focusAtOffset = (element: EditorElement, offset: number) => {
  const view = getView(element);
  const docSize = view.state.doc.content.size;
  const selectionPos = Math.min(offset + 1, Math.max(1, docSize - 1));
  act(() => {
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, selectionPos)));
    view.focus();
  });
};

const dispatchKey = (element: EditorElement, event: {key: string; shiftKey?: boolean}) => {
  const view = getView(element);

  const keyboardEvent = new KeyboardEvent('keydown', {
    key: event.key,
    shiftKey: event.shiftKey ?? false,
    bubbles: true,
    cancelable: true
  });

  Object.defineProperty(keyboardEvent, 'target', {
    configurable: true,
    enumerable: true,
    value: element
  });

  act(() => {
    const handled = view.someProp('handleKeyDown', (handler) => handler(view, keyboardEvent));
    if (!handled) {
      view.dom.dispatchEvent(keyboardEvent);
    }
  });
};

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
    selected: false,
    createdAt: now,
    updatedAt: now
  };
};

const renderEditor = (
  doc: ReturnType<typeof createThortiqDoc>,
  bus: CommandBus,
  nodeId: string,
  edge: EdgeRecord | null
) =>
  render(
    <ThortiqProvider doc={doc} bus={bus}>
      <NodeEditor nodeId={nodeId} edge={edge} />
    </ThortiqProvider>
  );

describe('NodeEditor interactions', () => {
  it('creates a sibling above when Enter is pressed at the start', async () => {
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

    const {container, unmount} = renderEditor(doc, bus, node.id, currentEdge);
    const editor = getEditorElement(container, node.id);

    await waitForDocText(editor, 'alpha');

    const initialEdges = new Set(
      initializeCollections(doc).edges.get(root.id)?.toArray().map((edgeRecord) => edgeRecord.childId) ?? []
    );

    focusAtOffset(editor, 0);
    dispatchKey(editor, {key: 'Enter'});

    await waitFor(() => {
      const updatedEdges = initializeCollections(doc).edges.get(root.id);
      expect(updatedEdges?.length).toBe(2);
      const rows = updatedEdges?.toArray() ?? [];
      const created = rows.find((edgeRecord) => !initialEdges.has(edgeRecord.childId));
      expect(created?.childId).toBeDefined();
    });
    unmount();
    undoContext.detach();
  });

  it('splits the node when Enter is pressed in the middle', async () => {
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

    const {container, unmount} = renderEditor(doc, bus, node.id, currentEdge);
    const editor = getEditorElement(container, node.id);

    await waitForDocText(editor, 'hello world');

    focusAtOffset(editor, 5);
    dispatchKey(editor, {key: 'Enter'});

    await waitFor(() => {
      const edges = initializeCollections(doc).edges.get(root.id)?.toArray() ?? [];
      expect(edges.length).toBe(2);
    });

    const edges = initializeCollections(doc).edges.get(root.id)?.toArray() ?? [];
    const newEdge = edges[1];
    const newTextNode = getOrCreateNodeText(doc, newEdge.childId);
    await waitFor(() => {
      const newText = String(newTextNode.toJSON() ?? '');
      expect(newText).toBe(' world');
    });

    await waitFor(() => {
      const currentTextNode = getOrCreateNodeText(doc, node.id);
      const currentText = String(currentTextNode.toJSON() ?? '');
      expect(currentText).toBe('hello');
    });
    unmount();
    undoContext.detach();
  });

  it('creates a child when Enter is pressed at end and node is expanded', async () => {
    const doc = createThortiqDoc();
    const undoContext = createUndoManager(doc);
    const bus = new CommandBus(doc, undoContext);

    const root = createNode('Root');
    upsertNodeRecord(doc, root);

    const parent = createNode('parent');
    const parentEdge = createEdge(root.id, parent.id, 0);
    bus.execute({kind: 'create-node', node: parent, edge: parentEdge, initialText: 'parent'});

    const existingChild = createNode('child');
    const existingEdge = createEdge(parent.id, existingChild.id, 0);
    bus.execute({kind: 'create-node', node: existingChild, edge: existingEdge, initialText: 'child'});

    const parentEdgeArray = initializeCollections(doc).edges.get(root.id);
    const parentEdgeRecord = parentEdgeArray ? parentEdgeArray.toArray()[0] ?? null : null;
    expect(parentEdgeRecord).not.toBeNull();

    const {container, unmount} = renderEditor(doc, bus, parent.id, parentEdgeRecord);
    const editor = getEditorElement(container, parent.id);

    await waitForDocText(editor, 'parent');

    const view = getView(editor);
    const textLength = view.state.doc.textContent.length;

    focusAtOffset(editor, textLength);
    dispatchKey(editor, {key: 'Enter'});

    await waitFor(() => {
      const childEdges = initializeCollections(doc).edges.get(parent.id)?.toArray() ?? [];
      expect(childEdges.length).toBe(2);
    });
    unmount();
    undoContext.detach();
  });

  it('indents and outdents nodes with Tab and Shift+Tab', async () => {
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
    const editor = getEditorElement(initialRender.container, second.id);

    await waitForDocText(editor, 'second');

    focusAtOffset(editor, 0);
    dispatchKey(editor, {key: 'Tab'});

    await waitFor(() => {
      const rootEdgesAfterIndent = initializeCollections(doc).edges.get(root.id)?.toArray() ?? [];
      expect(rootEdgesAfterIndent.length).toBe(1);
      const firstChildren = initializeCollections(doc).edges.get(first.id)?.toArray() ?? [];
      expect(firstChildren.length).toBe(1);
    });

    const nestedEdge = initializeCollections(doc).edges.get(first.id)?.toArray()?.[0] ?? null;
    expect(nestedEdge).not.toBeNull();
    initialRender.unmount();

    const editorAfterIndent = renderEditor(doc, bus, second.id, nestedEdge);
    const editorElement = getEditorElement(editorAfterIndent.container, second.id);

    focusAtOffset(editorElement, 0);
    dispatchKey(editorElement, {key: 'Tab', shiftKey: true});

    await waitFor(() => {
      const rootEdgesAfterOutdent = initializeCollections(doc).edges.get(root.id)?.toArray() ?? [];
      expect(rootEdgesAfterOutdent.length).toBe(2);
    });
    editorAfterIndent.unmount();
    undoContext.detach();
  });
});
