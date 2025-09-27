import '@testing-library/jest-dom';
import {act, render, waitFor} from '@testing-library/react';
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

const createNode = (text: string): NodeRecord => {
  const id = createNodeId();
  const now = timestamp();
  return {
    id,
    html: `<p>${text}</p>`,
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

describe('ProseMirror rich text sync', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    process.env.THORTIQ_ENABLE_PROSEMIRROR = 'true';
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    delete process.env.THORTIQ_ENABLE_PROSEMIRROR;
  });

  it('reflects remote Yjs updates into node HTML and legacy text', async () => {
    const doc = createThortiqDoc();
    const undo = createUndoManager(doc);
    const bus = new CommandBus(doc, undo);

    const root = createNode('Root');
    upsertNodeRecord(doc, root);

    const node = createNode('Initial content');
    const edge = createEdge(root.id, node.id, 0);
    bus.execute({kind: 'create-node', node, edge, initialText: 'Initial content'});

    const {getByTestId, unmount} = render(
      <ThortiqProvider doc={doc} bus={bus}>
        <NodeEditor nodeId={node.id} edge={edge} />
      </ThortiqProvider>
    );

    const rawContainer = await waitFor(() => getByTestId('prosemirror-node-editor'));
    const editorContainer = rawContainer as HTMLDivElement & {__pmView__?: EditorView};
    const view = editorContainer.__pmView__;
    expect(view).toBeDefined();
    if (!view) {
      throw new Error('Expected ProseMirror view to be attached to editor container');
    }

    act(() => {
      const transaction = view.state.tr.insertText('Remote change');
      view.dispatch(transaction);
    });

    await act(async () => {
      jest.runAllTimers();
      await Promise.resolve();
    });

    await waitFor(() => {
      const {nodes} = initializeCollections(doc);
      const updated = nodes.get(node.id);
      expect(updated?.html).toBe('<p>Remote change</p>');
    });

    const legacyText = getOrCreateNodeText(doc, node.id);
    const serialized = legacyText.toJSON();
    expect(typeof serialized === 'string' ? serialized : '').toBe('Remote change');

    unmount();
    undo.detach();
  });
});
