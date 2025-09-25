import '@testing-library/jest-dom';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {StrictMode} from 'react';

import {
  bootstrapInitialOutline,
  CommandBus,
  OutlinePane,
  ThortiqProvider,
  createEdgeId,
  createNodeId,
  createThortiqDoc,
  createUndoManager,
  ensureDocumentRoot,
  getDefaultSeedTitles,
  insertEdgeRecord,
  upsertNodeRecord,
  htmlToPlainText
} from '..';
import type {EdgeRecord} from '..';
import {initializeCollections} from '../yjs/doc';

jest.setTimeout(20000);

const timestamp = () => new Date().toISOString();

interface SeedOptions {
  readonly rootLabel?: string;
}

const seedDoc = (options: SeedOptions = {}) => {
  const doc = createThortiqDoc();
  const documentRoot = ensureDocumentRoot(doc);

  if (options.rootLabel) {
    const rootNodeId = createNodeId();
    const now = timestamp();

    upsertNodeRecord(doc, {
      id: rootNodeId,
      html: options.rootLabel,
      tags: [],
      attributes: {},
      createdAt: now,
      updatedAt: now
    });

    const rootEdge: EdgeRecord = {
      id: createEdgeId(),
      parentId: documentRoot.id,
      childId: rootNodeId,
      role: 'primary',
      collapsed: false,
      ordinal: 0,
      selected: false,
      createdAt: now,
      updatedAt: now
    };

    insertEdgeRecord(doc, rootEdge);
  }

  return {doc, rootId: documentRoot.id};
};

const addChild = (doc: ReturnType<typeof createThortiqDoc>, parentId: string, html: string, ordinal: number): EdgeRecord => {
  const nodeId = createNodeId();
  const now = timestamp();
  upsertNodeRecord(doc, {
    id: nodeId,
    html,
    tags: [],
    attributes: {},
    createdAt: now,
    updatedAt: now
  });

  const edge: EdgeRecord = {
    id: createEdgeId(),
    parentId,
    childId: nodeId,
    role: 'primary',
    collapsed: false,
    ordinal,
    selected: false,
    createdAt: now,
    updatedAt: now
  };

  insertEdgeRecord(doc, edge);
  return edge;
};

const renderOutline = (doc: ReturnType<typeof createThortiqDoc>, rootId: string) => {
  const undoContext = createUndoManager(doc);
  const bus = new CommandBus(doc, undoContext);
  return render(
    <StrictMode>
      <ThortiqProvider doc={doc} bus={bus}>
        <OutlinePane rootId={rootId} />
      </ThortiqProvider>
    </StrictMode>
  );
};

const queryTextareaByNodeId = (container: HTMLElement, nodeId: string) =>
  container.querySelector<HTMLTextAreaElement>(`textarea[aria-label="Node ${nodeId}"]`);

const focusTextarea = (textarea: HTMLTextAreaElement) => {
  act(() => {
    textarea.focus();
  });
};

describe('Outline interactions', () => {
  test('renders shared bootstrap content', async () => {
    const doc = createThortiqDoc();
    const {root} = bootstrapInitialOutline(doc);
    const view = renderOutline(doc, root.id);

    await Promise.all(getDefaultSeedTitles().map((title) => screen.findByDisplayValue(title)));

    view.unmount();
  });

  test('root node becomes selected when clicked', async () => {
    const {doc, rootId} = seedDoc();
    addChild(doc, rootId, 'Root', 0);
    addChild(doc, rootId, 'Child', 1);
    const result = renderOutline(doc, rootId);

    const rootTextarea = await screen.findByDisplayValue('Root');
    const childTextarea = await screen.findByDisplayValue('Child');
    if (!(rootTextarea instanceof HTMLTextAreaElement) || !(childTextarea instanceof HTMLTextAreaElement)) {
      throw new Error('Missing textarea');
    }

    const rootItem = rootTextarea.closest('[role="treeitem"]');
    const childItem = childTextarea.closest('[role="treeitem"]');
    if (!(rootItem instanceof HTMLDivElement) || !(childItem instanceof HTMLDivElement)) {
      throw new Error('Missing tree items');
    }

    act(() => {
      fireEvent.mouseDown(childItem);
      fireEvent.mouseUp(childItem);
    });

    await waitFor(() => expect(childItem).toHaveAttribute('aria-selected', 'true'));

    act(() => {
      fireEvent.mouseDown(rootItem);
      fireEvent.mouseUp(rootItem);
    });

    await waitFor(() => {
      expect(rootItem).toHaveAttribute('aria-selected', 'true');
      expect(childItem).toHaveAttribute('aria-selected', 'false');
    });

    result.unmount();
  });

  test('Shift+Tab outdents a child to become a sibling of its parent', async () => {
    const {doc, rootId} = seedDoc();
    const parentEdge = addChild(doc, rootId, 'Parent', 0);
    const childEdge = addChild(doc, parentEdge.childId, 'Child', 0);

    const view = renderOutline(doc, rootId);
    const container = view.container.querySelector('[role="presentation"]') as HTMLDivElement;
    const childTextarea = queryTextareaByNodeId(container, childEdge.childId);
    if (!childTextarea) {
      throw new Error('Missing child textarea');
    }

    focusTextarea(childTextarea);
    act(() => {
      childTextarea.setSelectionRange(childTextarea.value.length, childTextarea.value.length);
      fireEvent.keyDown(childTextarea, {key: 'Tab', shiftKey: true});
    });

    await waitFor(() => {
      const {edges} = initializeCollections(doc);
      const rootEdges = edges.get(rootId);
      expect(rootEdges?.toArray().map((edge) => edge.childId)).toEqual([parentEdge.childId, childEdge.childId]);
    });

    view.unmount();
  });

  test('Tab indents all selected siblings beneath the previous sibling', async () => {
    const {doc, rootId} = seedDoc();
    const alpha = addChild(doc, rootId, 'Alpha', 0);
    const beta = addChild(doc, rootId, 'Beta', 1);
    const gamma = addChild(doc, rootId, 'Gamma', 2);

    const view = renderOutline(doc, rootId);
    const betaSelectionTextarea = await screen.findByDisplayValue('Beta');
    const gammaSelectionTextarea = await screen.findByDisplayValue('Gamma');
    if (!(betaSelectionTextarea instanceof HTMLTextAreaElement) || !(gammaSelectionTextarea instanceof HTMLTextAreaElement)) {
      throw new Error('Missing selection textarea');
    }
    const betaItem = betaSelectionTextarea.closest('[role="treeitem"]');
    const gammaItem = gammaSelectionTextarea.closest('[role="treeitem"]');
    if (!(betaItem instanceof HTMLDivElement) || !(gammaItem instanceof HTMLDivElement)) {
      throw new Error('Missing tree items');
    }

    act(() => {
      fireEvent.mouseDown(betaItem);
      fireEvent.mouseUp(betaItem);
      fireEvent.mouseDown(gammaItem, {ctrlKey: true});
      fireEvent.mouseUp(gammaItem, {ctrlKey: true});
    });

    const container = view.container.querySelector('[role="presentation"]') as HTMLDivElement;
    const betaTextarea = queryTextareaByNodeId(container, beta.childId);
    if (!betaTextarea) {
      throw new Error('Missing beta textarea');
    }

    focusTextarea(betaTextarea);
    act(() => {
      betaTextarea.setSelectionRange(betaTextarea.value.length, betaTextarea.value.length);
      fireEvent.keyDown(betaTextarea, {key: 'Tab'});
    });

    await waitFor(() => {
      const {edges} = initializeCollections(doc);
      const rootEdges = edges.get(rootId);
      expect(rootEdges?.toArray().map((edge) => edge.childId)).toEqual([alpha.childId]);
      const alphaChildren = edges.get(alpha.childId)?.toArray().map((edge) => edge.childId);
      expect(alphaChildren).toEqual([beta.childId, gamma.childId]);
    });

    view.unmount();
  });

  test('expand and collapse toggle hides child nodes and updates edge state', async () => {
    const {doc, rootId} = seedDoc();
    const parentEdge = addChild(doc, rootId, 'Parent', 0);
    addChild(doc, parentEdge.childId, 'Nested child', 0);

    const view = renderOutline(doc, rootId);

    const collapseToggle = await screen.findByLabelText('Collapse node');
    act(() => {
      fireEvent.click(collapseToggle);
    });

    await waitFor(() => expect(screen.queryByDisplayValue('Nested child')).toBeNull());
    await waitFor(() => expect(collapseToggle).toHaveAttribute('aria-label', 'Expand node'));

    const {edges} = initializeCollections(doc);
    const rootEdges = edges.get(rootId)?.toArray() ?? [];
    const updatedParentEdge = rootEdges.find((edge) => edge.id === parentEdge.id);
    expect(updatedParentEdge?.collapsed).toBe(true);

    act(() => {
      fireEvent.click(collapseToggle);
    });

    await screen.findByDisplayValue('Nested child');
    const refreshedEdges = (edges.get(rootId)?.toArray() ?? []).find((edge) => edge.id === parentEdge.id);
    expect(refreshedEdges?.collapsed).toBe(false);

    view.unmount();
  });

  test('Tab preserves caret offset when indenting a single node', async () => {
    const {doc, rootId} = seedDoc();
    const alpha = addChild(doc, rootId, 'Alpha', 0);
    const beta = addChild(doc, rootId, 'Indent target', 1);

    const view = renderOutline(doc, rootId);
    const container = view.container.querySelector('[role="presentation"]') as HTMLDivElement;
    const betaTextarea = queryTextareaByNodeId(container, beta.childId);
    if (!betaTextarea) {
      throw new Error('Missing beta textarea');
    }

    focusTextarea(betaTextarea);
    act(() => {
      betaTextarea.setSelectionRange(6, 6);
      fireEvent.keyDown(betaTextarea, {key: 'Tab'});
    });

    await waitFor(() => {
      const {edges} = initializeCollections(doc);
      const rootEdges = edges.get(rootId);
      expect(rootEdges?.toArray().map((edge) => edge.childId)).toEqual([alpha.childId]);
      const alphaChildren = edges.get(alpha.childId)?.toArray().map((edge) => edge.childId);
      expect(alphaChildren).toEqual([beta.childId]);
    });

    await waitFor(() => {
      const updatedTextarea = queryTextareaByNodeId(container, beta.childId);
      if (!updatedTextarea) {
        throw new Error('Missing beta textarea after indent');
      }
      expect(updatedTextarea.selectionStart).toBe(6);
      expect(updatedTextarea.selectionEnd).toBe(6);
    });

    view.unmount();
  });

  test('Shift+Tab preserves caret offset when outdenting a node', async () => {
    const {doc, rootId} = seedDoc();
    const parentEdge = addChild(doc, rootId, 'Parent', 0);
    const childEdge = addChild(doc, parentEdge.childId, 'Child content', 0);

    const view = renderOutline(doc, rootId);
    const container = view.container.querySelector('[role="presentation"]') as HTMLDivElement;
    const childTextarea = queryTextareaByNodeId(container, childEdge.childId);
    if (!childTextarea) {
      throw new Error('Missing child textarea');
    }

    focusTextarea(childTextarea);
    act(() => {
      childTextarea.setSelectionRange(2, 2);
      fireEvent.keyDown(childTextarea, {key: 'Tab', shiftKey: true});
    });

    await waitFor(() => {
      const {edges} = initializeCollections(doc);
      const rootEdges = edges.get(rootId);
      expect(rootEdges?.toArray().map((edge) => edge.childId)).toEqual([parentEdge.childId, childEdge.childId]);
    });

    await waitFor(() => {
      const updatedTextarea = queryTextareaByNodeId(container, childEdge.childId);
      if (!updatedTextarea) {
        throw new Error('Missing child textarea after outdent');
      }
      expect(updatedTextarea.selectionStart).toBe(2);
      expect(updatedTextarea.selectionEnd).toBe(2);
    });

    view.unmount();
  });

  test('Backspace at start merges with previous sibling unless guarded', async () => {
    const {doc, rootId} = seedDoc();
    const firstEdge = addChild(doc, rootId, 'First', 0);
    const secondEdge = addChild(doc, rootId, 'Second', 1);

    const view = renderOutline(doc, rootId);
    const container = view.container.querySelector('[role="presentation"]') as HTMLDivElement;
    const secondTextarea = queryTextareaByNodeId(container, secondEdge.childId);
    if (!secondTextarea) {
      throw new Error('Missing second textarea');
    }

    focusTextarea(secondTextarea);
    act(() => {
      secondTextarea.setSelectionRange(0, 0);
      fireEvent.keyDown(secondTextarea, {key: 'Backspace'});
    });

    await waitFor(() => {
      const {edges, nodes} = initializeCollections(doc);
      const rootEdges = edges.get(rootId);
      expect(rootEdges?.length).toBe(1);
      const firstNode = nodes.get(firstEdge.childId);
      expect(firstNode?.html).toContain('Second');
      expect(htmlToPlainText(firstNode?.html ?? '')).toBe('First Second');
      const mergedTextarea = queryTextareaByNodeId(container, firstEdge.childId);
      if (!mergedTextarea) {
        throw new Error('Missing merged textarea');
      }
      expect(mergedTextarea.selectionStart).toBe(6);
      expect(mergedTextarea.selectionEnd).toBe(6);
    });

    view.unmount();
  });

  test('Backspace does nothing when previous sibling and current both have children', async () => {
    const {doc, rootId} = seedDoc();
    const prevEdge = addChild(doc, rootId, 'Prev', 0);
    addChild(doc, prevEdge.childId, 'Prev child', 0);
    const currentEdge = addChild(doc, rootId, 'Current', 1);
    addChild(doc, currentEdge.childId, 'Current child', 0);

    const view = renderOutline(doc, rootId);
    const container = view.container.querySelector('[role="presentation"]') as HTMLDivElement;
    const currentTextarea = queryTextareaByNodeId(container, currentEdge.childId);
    if (!currentTextarea) {
      throw new Error('Missing current textarea');
    }

    focusTextarea(currentTextarea);
    act(() => {
      currentTextarea.setSelectionRange(0, 0);
      fireEvent.keyDown(currentTextarea, {key: 'Backspace'});
    });

    await waitFor(() => {
      const {edges} = initializeCollections(doc);
      const rootEdges = edges.get(rootId);
      expect(rootEdges?.length).toBe(2);
    });

    view.unmount();
  });

  test('Ctrl+Shift+Backspace deletes selected nodes', async () => {
    const {doc, rootId} = seedDoc();
    addChild(doc, rootId, 'Alpha', 0);
    addChild(doc, rootId, 'Beta', 1);

    const view = renderOutline(doc, rootId);
    const container = view.container.querySelector('[role="presentation"]') as HTMLDivElement;
    const alphaTextarea = await screen.findByDisplayValue('Alpha');
    const betaTextarea = await screen.findByDisplayValue('Beta');
    if (!(alphaTextarea instanceof HTMLTextAreaElement) || !(betaTextarea instanceof HTMLTextAreaElement)) {
      throw new Error('Missing selection textarea');
    }
    const firstItem = alphaTextarea.closest('[role="treeitem"]');
    const secondItem = betaTextarea.closest('[role="treeitem"]');
    if (!(firstItem instanceof HTMLDivElement) || !(secondItem instanceof HTMLDivElement)) {
      throw new Error('Missing tree items');
    }

    act(() => {
      fireEvent.mouseDown(firstItem);
      fireEvent.mouseUp(firstItem);
      fireEvent.mouseDown(secondItem, {ctrlKey: true});
      fireEvent.mouseUp(secondItem, {ctrlKey: true});
    });

    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);

    act(() => {
      fireEvent.keyDown(container, {key: 'Backspace', ctrlKey: true, shiftKey: true});
    });

    await waitFor(() => {
      const {edges} = initializeCollections(doc);
      expect(edges.get(rootId)).toBeUndefined();
    });

    confirmSpy.mockRestore();
    view.unmount();
  });

  test('Enter on empty node focuses the newly created sibling', async () => {
    const {doc, rootId} = seedDoc();
    const firstEdge = addChild(doc, rootId, 'Item', 0);

    const view = renderOutline(doc, rootId);
    const container = view.container.querySelector('[role="presentation"]') as HTMLDivElement;
    const firstTextarea = queryTextareaByNodeId(container, firstEdge.childId);
    if (!firstTextarea) {
      throw new Error('Missing first textarea');
    }

    focusTextarea(firstTextarea);
    act(() => {
      firstTextarea.setSelectionRange(firstTextarea.value.length, firstTextarea.value.length);
      fireEvent.keyDown(firstTextarea, {key: 'Enter'});
    });

    await waitFor(() => {
      const {edges} = initializeCollections(doc);
      const rootEdges = edges.get(rootId);
      expect(rootEdges?.length).toBe(2);
    });

    const rootEdgesAfterFirst = initializeCollections(doc).edges.get(rootId)?.toArray() ?? [];
    const secondEdge = rootEdgesAfterFirst.find((edge) => edge.childId !== firstEdge.childId);
    if (!secondEdge) {
      throw new Error('Missing second edge');
    }
    expect(document.activeElement?.getAttribute('aria-label')).toBe(`Node ${secondEdge.childId}`);

    const secondTextarea = queryTextareaByNodeId(container, secondEdge.childId);
    if (!secondTextarea) {
      throw new Error('Missing second textarea');
    }

    focusTextarea(secondTextarea);
    const knownEdgeIds = new Set(rootEdgesAfterFirst.map((edge) => edge.id));

    act(() => {
      secondTextarea.setSelectionRange(secondTextarea.value.length, secondTextarea.value.length);
      fireEvent.keyDown(secondTextarea, {key: 'Enter'});
    });

    await waitFor(() => {
      const {edges} = initializeCollections(doc);
      const rootEdges = edges.get(rootId);
      expect(rootEdges?.length).toBe(3);
    });

    const rootEdgesAfterSecond = initializeCollections(doc).edges.get(rootId)?.toArray() ?? [];
    const newEdge = rootEdgesAfterSecond.find((edge) => !knownEdgeIds.has(edge.id));
    if (!newEdge) {
      throw new Error('Missing newly created edge');
    }

    await waitFor(() => {
      const newTextarea = queryTextareaByNodeId(container, newEdge.childId);
      if (!newTextarea) {
        throw new Error('Missing newly created textarea');
      }
      expect(document.activeElement).toBe(newTextarea);
      expect(newTextarea.selectionStart).toBe(0);
      expect(newTextarea.selectionEnd).toBe(0);
    });

    view.unmount();
  });

  test('Undo repeatedly focuses the previous node', async () => {
    const {doc, rootId} = seedDoc({rootLabel: 'Item 0'});

    const view = renderOutline(doc, rootId);
    const container = view.container.querySelector('[role="presentation"]') as HTMLDivElement;
    const baseTextarea = await screen.findByDisplayValue('Item 0');
    if (!(baseTextarea instanceof HTMLTextAreaElement)) {
      throw new Error('Missing base textarea');
    }

    let currentTextarea: HTMLTextAreaElement = baseTextarea;

    for (let index = 0; index < 3; index += 1) {
      act(() => {
        currentTextarea.focus();
        currentTextarea.setSelectionRange(currentTextarea.value.length, currentTextarea.value.length);
        fireEvent.keyDown(currentTextarea, {key: 'Enter'});
      });

      await waitFor(() => {
        const {edges} = initializeCollections(doc);
        const rootEdges = edges.get(rootId);
        return rootEdges ? rootEdges.length === index + 2 : false;
      });

      const {edges} = initializeCollections(doc);
      const rootEdges = edges.get(rootId);
      if (!rootEdges) {
        throw new Error('Missing root edges after creation');
      }
      const serialized = rootEdges.toArray();
      const lastEdge = serialized[serialized.length - 1];
      const nextTextarea = queryTextareaByNodeId(container, lastEdge.childId);
      if (!nextTextarea) {
        throw new Error('Missing textarea for newly created node');
      }
      currentTextarea = nextTextarea;
      await waitFor(() => document.activeElement === currentTextarea);
    }

    for (let undoIndex = 0; undoIndex < 3; undoIndex += 1) {
      const {edges} = initializeCollections(doc);
      const rootEdges = edges.get(rootId);
      if (!rootEdges) {
        throw new Error('Missing root edges before undo');
      }
      const serialized = rootEdges.toArray();
      const previousEdge = serialized[serialized.length - 2];

      act(() => {
        fireEvent.keyDown(container, {key: 'z', ctrlKey: true});
      });

      await waitFor(() => {
        const {edges: latestEdges} = initializeCollections(doc);
        const rootArray = latestEdges.get(rootId);
        return rootArray ? rootArray.length === serialized.length - 1 : false;
      });

      const expectedEdgeId = previousEdge?.childId ?? serialized[0].childId;
      const expectedTextarea = queryTextareaByNodeId(container, expectedEdgeId);
      if (!expectedTextarea) {
        throw new Error('Missing textarea after undo');
      }

      await waitFor(() => document.activeElement === expectedTextarea);
      currentTextarea = expectedTextarea;
    }

    view.unmount();
  });

  test('Ctrl+Z undoes structural edits', async () => {
    const {doc, rootId} = seedDoc();
    const existingEdge = addChild(doc, rootId, 'Item', 0);

    const view = renderOutline(doc, rootId);
    const container = view.container.querySelector('[role="presentation"]') as HTMLDivElement;
    const itemTextarea = queryTextareaByNodeId(container, existingEdge.childId);
    if (!itemTextarea) {
      throw new Error('Missing item textarea');
    }

    focusTextarea(itemTextarea);
    act(() => {
      itemTextarea.setSelectionRange(itemTextarea.value.length, itemTextarea.value.length);
      fireEvent.keyDown(itemTextarea, {key: 'Enter'});
    });

    await waitFor(() => {
      const {edges} = initializeCollections(doc);
      expect(edges.get(rootId)?.length).toBeGreaterThan(1);
    });

    act(() => {
      fireEvent.keyDown(container, {key: 'z', ctrlKey: true});
    });

    await waitFor(() => {
      const {edges} = initializeCollections(doc);
      expect(edges.get(rootId)?.length).toBe(1);
    });

    view.unmount();
  });
});
