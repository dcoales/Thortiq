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
  ensureDocumentRoot
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

    const documentRoot = ensureDocumentRoot(doc);
    const root = createNode('Root');
    const edge = createEdge(documentRoot.id, root.id, 0);
    bus.execute({kind: 'create-node', node: root, edge, initialText: 'Root'});

    return {doc, bus, documentRootId: documentRoot.id, rootEdge: edge};
  };

  const focusNodeByLabel = async (label: string) => {
    const textarea = await screen.findByDisplayValue(label);
    if (!(textarea instanceof HTMLTextAreaElement)) {
      throw new Error('Missing textarea for focus');
    }
    const treeItem = textarea.closest('[role="treeitem"]');
    if (!(treeItem instanceof HTMLDivElement)) {
      throw new Error('Missing treeitem for focus');
    }
    const bullet = treeItem.querySelector<HTMLButtonElement>('button[data-role="drag-handle"]');
    if (!bullet) {
      throw new Error('Missing focus handle');
    }
    act(() => {
      fireEvent.click(bullet);
    });
  };

  it('selects nodes on click and highlights tree items', async () => {
    const {doc, bus, documentRootId} = setup();

    const first = createNode('Alpha');
    const second = createNode('Beta');

    const firstEdge = createEdge(documentRootId, first.id, 1);
    const secondEdge = createEdge(documentRootId, second.id, 2);

    bus.execute({kind: 'create-node', node: first, edge: firstEdge, initialText: 'Alpha'});
    bus.execute({kind: 'create-node', node: second, edge: secondEdge, initialText: 'Beta'});

    render(
      <StrictMode>
        <ThortiqProvider doc={doc} bus={bus}>
          <OutlinePane rootId={documentRootId} />
        </ThortiqProvider>
      </StrictMode>
    );

    const alphaTextarea = await screen.findByDisplayValue('Alpha');
    const betaTextarea = await screen.findByDisplayValue('Beta');
    if (!(alphaTextarea instanceof HTMLTextAreaElement) || !(betaTextarea instanceof HTMLTextAreaElement)) {
      throw new Error('Missing textarea');
    }
    const firstChild = alphaTextarea.closest('[role="treeitem"]');
    const secondChild = betaTextarea.closest('[role="treeitem"]');
    if (!(firstChild instanceof HTMLDivElement) || !(secondChild instanceof HTMLDivElement)) {
      throw new Error('Missing tree items');
    }

    act(() => {
      fireEvent.mouseDown(firstChild);
      fireEvent.mouseUp(firstChild);
    });

    await waitFor(() => expect(firstChild).toHaveAttribute('aria-selected', 'true'));
    act(() => {
      fireEvent.mouseDown(secondChild);
      fireEvent.mouseUp(secondChild);
    });

    await waitFor(() => expect(secondChild).toHaveAttribute('aria-selected', 'true'));
    await waitFor(() => expect(firstChild).toHaveAttribute('aria-selected', 'false'));
  });

  it('supports range selection with shift+click', async () => {
    const {doc, bus, documentRootId} = setup();

    const parent = createNode('Parent');
    const sibling = createNode('Sibling');

    const parentEdge = createEdge(documentRootId, parent.id, 1);
    const siblingEdge = createEdge(documentRootId, sibling.id, 2);

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
          <OutlinePane rootId={documentRootId} />
        </ThortiqProvider>
      </StrictMode>
    );

    const parentTextarea = await screen.findByDisplayValue('Parent');
    const childATextarea = await screen.findByDisplayValue('Child A');
    const childBTextarea = await screen.findByDisplayValue('Child B');
    const siblingTextarea = await screen.findByDisplayValue('Sibling');
    if (
      !(parentTextarea instanceof HTMLTextAreaElement) ||
      !(childATextarea instanceof HTMLTextAreaElement) ||
      !(childBTextarea instanceof HTMLTextAreaElement) ||
      !(siblingTextarea instanceof HTMLTextAreaElement)
    ) {
      throw new Error('Missing textarea');
    }

    const parentItem = parentTextarea.closest('[role="treeitem"]');
    const firstChild = childATextarea.closest('[role="treeitem"]');
    const secondChild = childBTextarea.closest('[role="treeitem"]');
    const siblingItem = siblingTextarea.closest('[role="treeitem"]');
    if (
      !(parentItem instanceof HTMLDivElement) ||
      !(firstChild instanceof HTMLDivElement) ||
      !(secondChild instanceof HTMLDivElement) ||
      !(siblingItem instanceof HTMLDivElement)
    ) {
      throw new Error('Missing tree items');
    }

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
      expect(parentItem).toHaveAttribute('aria-selected', 'false');
      expect(firstChild).toHaveAttribute('aria-selected', 'true');
      expect(secondChild).toHaveAttribute('aria-selected', 'true');
    });
  });

  it('focuses the newly created node with caret at start after pressing Enter', async () => {
    const {doc, bus, documentRootId} = setup();

    const first = createNode('Alpha');
    const edge = createEdge(documentRootId, first.id, 1);
    bus.execute({kind: 'create-node', node: first, edge, initialText: 'Alpha'});

    const view = render(
      <StrictMode>
        <ThortiqProvider doc={doc} bus={bus}>
          <OutlinePane rootId={documentRootId} />
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

  it('navigates focus history using the header controls', async () => {
    const {doc, bus, documentRootId} = setup();

    const alpha = createNode('Alpha');
    const alphaEdge = createEdge(documentRootId, alpha.id, 1);
    bus.execute({kind: 'create-node', node: alpha, edge: alphaEdge, initialText: 'Alpha'});

    const beta = createNode('Beta');
    const betaEdge = createEdge(alpha.id, beta.id, 0);
    bus.execute({kind: 'create-node', node: beta, edge: betaEdge, initialText: 'Beta'});

    render(
      <StrictMode>
        <ThortiqProvider doc={doc} bus={bus}>
          <OutlinePane rootId={documentRootId} />
        </ThortiqProvider>
      </StrictMode>
    );

    await screen.findByDisplayValue('Root');

    await focusNodeByLabel('Alpha');
    await waitFor(() => expect(screen.queryByDisplayValue('Root')).toBeNull());

    await focusNodeByLabel('Beta');
    const backButton = screen.getByRole('button', {name: 'Go to previous focus'});
    const forwardButton = screen.getByRole('button', {name: 'Go to next focus'});
    expect(backButton).toBeEnabled();

    act(() => {
      fireEvent.click(backButton);
    });
    await waitFor(() => expect(screen.queryByDisplayValue('Root')).toBeNull());
    await waitFor(() => expect(screen.getAllByDisplayValue('Alpha').length).toBeGreaterThan(0));

    act(() => {
      fireEvent.click(backButton);
    });
    await waitFor(() => expect(screen.getByDisplayValue('Root')).toBeInTheDocument());
    expect(forwardButton).toBeEnabled();

    act(() => {
      fireEvent.click(forwardButton);
    });
    await waitFor(() => expect(screen.queryByDisplayValue('Root')).toBeNull());
    await waitFor(() => expect(screen.getAllByDisplayValue('Alpha').length).toBeGreaterThan(0));
  });
});
