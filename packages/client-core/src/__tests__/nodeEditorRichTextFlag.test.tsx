import '@testing-library/jest-dom';
import {render} from '@testing-library/react';

import {
  CommandBus,
  NodeEditor,
  ThortiqProvider,
  createEdgeId,
  createNodeId,
  createThortiqDoc,
  createUndoManager,
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
    selected: false,
    createdAt: now,
    updatedAt: now
  };
};

describe('NodeEditor feature flag', () => {
  beforeEach(() => {
    delete process.env.THORTIQ_ENABLE_PROSEMIRROR;
  });

  it('renders the legacy textarea when the ProseMirror flag is disabled', () => {
    const doc = createThortiqDoc();
    const undo = createUndoManager(doc);
    const bus = new CommandBus(doc, undo);

    const root = createNode('root');
    upsertNodeRecord(doc, root);

    const node = createNode('alpha');
    const edge = createEdge(root.id, node.id, 0);
    bus.execute({kind: 'create-node', node, edge, initialText: 'alpha'});

    const {getByLabelText, unmount} = render(
      <ThortiqProvider doc={doc} bus={bus}>
        <NodeEditor nodeId={node.id} edge={edge} />
      </ThortiqProvider>
    );

    const editor = getByLabelText(`Node ${node.id}`);
    expect(editor.tagName).toBe('TEXTAREA');

    unmount();
    undo.detach();
  });

  it('renders the ProseMirror shell when the feature flag is enabled', () => {
    process.env.THORTIQ_ENABLE_PROSEMIRROR = 'true';

    const doc = createThortiqDoc();
    const undo = createUndoManager(doc);
    const bus = new CommandBus(doc, undo);

    const root = createNode('root');
    upsertNodeRecord(doc, root);

    const node = createNode('beta');
    const edge = createEdge(root.id, node.id, 0);
    bus.execute({kind: 'create-node', node, edge, initialText: 'beta'});

    const {getByLabelText, getByTestId, unmount} = render(
      <ThortiqProvider doc={doc} bus={bus}>
        <NodeEditor nodeId={node.id} edge={edge} />
      </ThortiqProvider>
    );

    const editor = getByLabelText(`Node ${node.id}`);
    expect(editor.tagName).toBe('DIV');
    expect(editor).toHaveAttribute('role', 'textbox');

    const container = getByTestId('prosemirror-node-editor');
    expect(container).toBeInTheDocument();

    unmount();
    undo.detach();
  });
});
