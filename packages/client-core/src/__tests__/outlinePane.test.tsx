import '@testing-library/jest-dom';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {StrictMode} from 'react';

import {
  CommandBus,
  OutlinePane,
  ThortiqProvider,
  createEdgeId,
  createNodeId,
  createThortiqDoc,
  createUndoManager,
  upsertNodeRecord
} from '..';
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

describe('OutlinePane', () => {
  const setup = () => {
    const doc = createThortiqDoc();
    const undoContext = createUndoManager(doc);
    const bus = new CommandBus(doc, undoContext);

    const root = createNode('Root');
    upsertNodeRecord(doc, root);

    return {doc, bus, rootId: root.id};
  };

  it('selects nodes on click and highlights tree items', async () => {
    const {doc, bus, rootId} = setup();

    const first = createNode('Alpha');
    const second = createNode('Beta');

    const firstEdge = createEdge(rootId, first.id, 0);
    const secondEdge = createEdge(rootId, second.id, 1);

    bus.execute({kind: 'create-node', node: first, edge: firstEdge, initialText: 'Alpha'});
    bus.execute({kind: 'create-node', node: second, edge: secondEdge, initialText: 'Beta'});

    render(
      <StrictMode>
        <ThortiqProvider doc={doc} bus={bus}>
          <OutlinePane rootId={rootId} />
        </ThortiqProvider>
      </StrictMode>
    );

    const items = await screen.findAllByRole('treeitem');
    // root node is the first item; select the first child instead
    const firstChild = items[1];

    act(() => {
      fireEvent.mouseDown(firstChild);
      fireEvent.mouseUp(firstChild);
    });

    await waitFor(() => expect(firstChild).toHaveAttribute('aria-selected', 'true'));

    const secondChild = items[2];
    act(() => {
      fireEvent.mouseDown(secondChild);
      fireEvent.mouseUp(secondChild);
    });

    await waitFor(() => expect(secondChild).toHaveAttribute('aria-selected', 'true'));
    await waitFor(() => expect(firstChild).toHaveAttribute('aria-selected', 'false'));
  });

  it('supports range selection with shift+click', async () => {
    const {doc, bus, rootId} = setup();

    const parent = createNode('Parent');
    const sibling = createNode('Sibling');

    const parentEdge = createEdge(rootId, parent.id, 0);
    const siblingEdge = createEdge(rootId, sibling.id, 1);

    bus.execute({kind: 'create-node', node: parent, edge: parentEdge, initialText: 'Parent'});
    bus.execute({kind: 'create-node', node: sibling, edge: siblingEdge, initialText: 'Sibling'});

    const childA = createNode('Child A');
    const childB = createNode('Child B');

    const childEdgeA = createEdge(parent.id, childA.id, 0);
    const childEdgeB = createEdge(parent.id, childB.id, 1);

    bus.execute({kind: 'create-node', node: childA, edge: childEdgeA, initialText: 'Child A'});
    bus.execute({kind: 'create-node', node: childB, edge: childEdgeB, initialText: 'Child B'});

    render(
      <StrictMode>
        <ThortiqProvider doc={doc} bus={bus}>
          <OutlinePane rootId={rootId} />
        </ThortiqProvider>
      </StrictMode>
    );

    const items = await screen.findAllByRole('treeitem');
    const firstChild = items[2]; // first child of parent
    const siblingItem = items[4];

    act(() => {
      fireEvent.mouseDown(firstChild);
      fireEvent.mouseUp(firstChild);
    });

    act(() => {
      fireEvent.mouseDown(siblingItem, {shiftKey: true});
      fireEvent.mouseUp(siblingItem, {shiftKey: true});
    });

    await waitFor(() => {
      expect(siblingItem).toHaveAttribute('aria-selected', 'true');
      expect(items[1]).toHaveAttribute('aria-selected', 'true'); // parent promoted
      expect(firstChild).toHaveAttribute('aria-selected', 'false');
    });
  });

  it('focuses the newly created node with caret at start after pressing Enter', async () => {
    const {doc, bus, rootId} = setup();

    const first = createNode('Alpha');
    const edge = createEdge(rootId, first.id, 0);
    bus.execute({kind: 'create-node', node: first, edge, initialText: 'Alpha'});

    const view = render(
      <StrictMode>
        <ThortiqProvider doc={doc} bus={bus}>
          <OutlinePane rootId={rootId} />
        </ThortiqProvider>
      </StrictMode>
    );

    const container = view.container.querySelector<HTMLDivElement>('[role="presentation"]');
    if (!container) {
      throw new Error('Missing outline container');
    }
    const textareas = container.querySelectorAll('textarea');
    const firstTextArea = textareas[0];
    if (!(firstTextArea instanceof HTMLTextAreaElement)) {
      throw new Error('Missing initial textarea');
    }

    act(() => {
      firstTextArea.focus();
      firstTextArea.setSelectionRange(firstTextArea.value.length, firstTextArea.value.length);
      fireEvent.keyDown(firstTextArea, {key: 'Enter', code: 'Enter'});
    });

    await waitFor(() => {
      const updatedTextareas = container.querySelectorAll('textarea');
      expect(updatedTextareas.length).toBeGreaterThan(1);
      const newTextArea = updatedTextareas[1];
      if (!(newTextArea instanceof HTMLTextAreaElement)) {
        throw new Error('Missing new textarea');
      }
      expect(document.activeElement).toBe(newTextArea);
      expect(newTextArea.selectionStart).toBe(0);
      expect(newTextArea.selectionEnd).toBe(0);
    });
  });
});
