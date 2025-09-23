import {StrictMode, useRef} from 'react';
import '@testing-library/jest-dom';
import {act, render, screen} from '@testing-library/react';

import {
  CommandBus,
  ThortiqProvider,
  VirtualizedOutline,
  createEdgeId,
  createNodeId,
  createThortiqDoc,
  createUndoManager,
  ensureDocumentRoot,
  useOutlineRowsSnapshot
} from '..';
import type {EdgeRecord, NodeRecord} from '..';

const timestamp = () => new Date().toISOString();

const createNode = (html: string): NodeRecord => {
  const now = timestamp();
  return {
    id: createNodeId(),
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

const OutlineHarness = ({rootId}: {readonly rootId: string}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const snapshot = useOutlineRowsSnapshot({rootId, initialDepth: -1});

  return (
    <div ref={containerRef} style={{height: 400, overflow: 'auto'}}>
      <VirtualizedOutline
        snapshot={snapshot}
        scrollParentRef={containerRef}
        rootSelected={false}
        selectedEdgeIds={new Set()}
      />
    </div>
  );
};

describe('React hooks integration', () => {
  it('renders a virtualized outline and responds to mutations', () => {
    const doc = createThortiqDoc();
    const undoContext = createUndoManager(doc);
    const bus = new CommandBus(doc, undoContext);
    const documentRoot = ensureDocumentRoot(doc);

    const rootNode = createNode('Root');
    const rootEdge = createEdge(documentRoot.id, rootNode.id, 0);

    const childNode = createNode('Child');
    const childEdge = createEdge(rootNode.id, childNode.id, 0);

    bus.execute({kind: 'create-node', node: rootNode, edge: rootEdge, initialText: 'Root'});

    const TestApp = () => (
      <StrictMode>
        <ThortiqProvider doc={doc} bus={bus}>
          <OutlineHarness rootId={documentRoot.id} />
        </ThortiqProvider>
      </StrictMode>
    );

    render(<TestApp />);

    expect(screen.getByText('Root')).toBeInTheDocument();
    expect(screen.queryByText('Child')).not.toBeInTheDocument();

    act(() => {
      bus.execute({kind: 'create-node', node: childNode, edge: childEdge});
    });

    expect(screen.getByText('Child')).toBeInTheDocument();

    undoContext.detach();
  });
});
