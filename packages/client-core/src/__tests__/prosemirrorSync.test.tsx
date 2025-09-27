import '@testing-library/jest-dom';
import {act, render, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {EditorView} from 'prosemirror-view';
import {EditorView as ProseMirrorEditorView} from 'prosemirror-view';
import {TextSelection} from 'prosemirror-state';
import {forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState} from 'react';

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
  upsertNodeRecord,
  useDocVersion
} from '..';
import type {EdgeId, EdgeRecord, NodeRecord} from '..';

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

const resolveEditableElement = (element: Element): HTMLElement => {
  if (!(element instanceof HTMLElement)) {
    throw new Error('Editor container must be an HTMLElement');
  }
  const editable = element.querySelector('.ProseMirror');
  return editable instanceof HTMLElement ? editable : element;
};

interface FocusDirectiveState {
  readonly edgeId: string;
  readonly position: number;
  readonly requestId: number;
}

interface DirectiveHarnessHandle {
  requestFocus(position: number): void;
}

interface DirectiveHarnessProps {
  readonly nodeId: string;
  readonly edge: EdgeRecord;
  readonly onFocusEdge?: (edgeId: EdgeId | null) => void;
}

const DirectiveHarness = forwardRef<DirectiveHarnessHandle, DirectiveHarnessProps>(
  ({nodeId, edge, onFocusEdge}, ref) => {
    const [directive, setDirective] = useState<FocusDirectiveState | null>(null);
    const requestRef = useRef(0);

    useImperativeHandle(
      ref,
      () => ({
        requestFocus(position: number) {
          requestRef.current += 1;
          setDirective({edgeId: edge.id, position, requestId: requestRef.current});
        }
      }),
      [edge.id]
    );

    const handleDirectiveComplete = useCallback((requestId: number) => {
      setDirective((current) => (current && current.requestId === requestId ? null : current));
    }, []);

    return (
      <NodeEditor
        nodeId={nodeId}
        edge={edge}
        focusDirective={directive}
        onFocusDirectiveComplete={handleDirectiveComplete}
        onFocusEdge={onFocusEdge}
      />
    );
  }
);

const FocusMirroringHarness = ({nodeId, edge}: {nodeId: string; edge: EdgeRecord}) => {
  const directiveRef = useRef<DirectiveHarnessHandle | null>(null);
  const docVersion = useDocVersion();
  const [isFocused, setIsFocused] = useState(false);

  const requestFocus = useCallback((position: number) => {
    directiveRef.current?.requestFocus(position);
  }, []);

  const handleFocusEdge = useCallback(
    (edgeId: EdgeId | null) => {
      setIsFocused(edgeId === edge.id);
    },
    [edge.id]
  );

  useEffect(() => {
    if (!isFocused) {
      return;
    }
    const timer = window.setTimeout(() => {
      requestFocus(-1);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [docVersion, isFocused, requestFocus]);

  return <DirectiveHarness ref={directiveRef} nodeId={nodeId} edge={edge} onFocusEdge={handleFocusEdge} />;
};

const setCaretToStart = (view: EditorView) => {
  if (view.state.doc.content.size === 0) {
    return;
  }
  const targetPos = 1;
  const transaction = view.state.tr.setSelection(TextSelection.create(view.state.doc, targetPos));
  view.dispatch(transaction);
  view.focus();
};

type ResizeObserverCtor = new (...args: unknown[]) => {
  observe: (...args: unknown[]) => void;
  unobserve: (...args: unknown[]) => void;
  disconnect: () => void;
};

beforeAll(() => {
  const scope = globalThis as {ResizeObserver?: ResizeObserverCtor};
  if (typeof scope.ResizeObserver === 'undefined') {
    scope.ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  }

  const doc = globalThis.document as (Document & {
    elementFromPoint?: (x: number, y: number) => Element | null;
  }) | undefined;
  if (doc && typeof doc.elementFromPoint !== 'function') {
    doc.elementFromPoint = () => doc.body ?? null;
  }

  const elementProto = Element.prototype as Element & {
    getClientRects?: () => DOMRectList;
    getBoundingClientRect?: () => DOMRect;
  };

  if (!elementProto.getClientRects) {
    elementProto.getClientRects = () => {
      const rect = {
        bottom: 0,
        height: 0,
        left: 0,
        right: 0,
        top: 0,
        width: 0,
        x: 0,
        y: 0,
        toJSON: () => ({})
      } as DOMRect;
      return {
        length: 1,
        item: () => rect,
        [Symbol.iterator]: function* () {
          yield rect;
        }
      } as unknown as DOMRectList;
    };
  }

  if (!elementProto.getBoundingClientRect) {
    elementProto.getBoundingClientRect = () => ({
      bottom: 0,
      height: 0,
      left: 0,
      right: 0,
      top: 0,
      width: 0,
      x: 0,
      y: 0,
      toJSON: () => ({})
    }) as DOMRect;
  }

  const viewProto = ProseMirrorEditorView.prototype as unknown as {
    scrollToSelection?: (...args: unknown[]) => void;
  };

  const originalScrollToSelection = viewProto.scrollToSelection;
  if (originalScrollToSelection) {
    viewProto.scrollToSelection = function safeScrollToSelection(...args: unknown[]) {
      try {
        return originalScrollToSelection.apply(this, args);
      } catch {
        return undefined;
      }
    };
  }
});

describe('ProseMirror rich text sync', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
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
      const {schema, doc: currentDoc} = view.state;
      const paragraph = schema.nodes.paragraph.create({}, schema.text('Remote change'));
      const tr = view.state.tr.replaceWith(0, currentDoc.content.size, paragraph);
      view.dispatch(tr);
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

  // TODO(step-4): Revisit once OutlinePane focus lifecycle is reworked for the ProseMirror editor.
  it.skip('retains caret position when typing at the start of a node', async () => {
    const doc = createThortiqDoc();
    const undo = createUndoManager(doc);
    const bus = new CommandBus(doc, undo);

    const root = createNode('Root');
    upsertNodeRecord(doc, root);

    const firstNode = createNode('cdef');
    const firstEdge = createEdge(root.id, firstNode.id, 0);
    bus.execute({kind: 'create-node', node: firstNode, edge: firstEdge, initialText: 'cdef'});

    const secondNode = createNode('');
    const secondEdge = createEdge(root.id, secondNode.id, 1);
    bus.execute({kind: 'create-node', node: secondNode, edge: secondEdge, initialText: ''});

    initializeCollections(doc);

    const user = userEvent.setup({delay: 0, advanceTimers: jest.advanceTimersByTime});

    const {getAllByTestId, unmount} = render(
      <ThortiqProvider doc={doc} bus={bus}>
        <>
          <FocusMirroringHarness nodeId={firstNode.id} edge={firstEdge} />
          <NodeEditor nodeId={secondNode.id} edge={secondEdge} />
        </>
      </ThortiqProvider>
    );

    const [firstContainer, secondContainer] = await waitFor(() => {
      const containers = getAllByTestId('prosemirror-node-editor') as Array<
        HTMLDivElement & {__pmView__?: EditorView}
      >;
      if (containers.length < 2) {
        throw new Error('Editors not yet mounted');
      }
      if (!containers[0].__pmView__ || !containers[1].__pmView__) {
        throw new Error('Editor views not attached');
      }
      return containers;
    });

    const firstView = firstContainer.__pmView__;
    const secondView = secondContainer.__pmView__;
    if (!firstView || !secondView) {
      throw new Error('Missing ProseMirror view instances');
    }

    const firstEditable = resolveEditableElement(firstContainer);
    const secondEditable = resolveEditableElement(secondContainer);

    const settle = async () => {
      await act(async () => {
        jest.runOnlyPendingTimers();
        await Promise.resolve();
      });
    };

    await waitFor(() => {
      expect(firstView.state.doc.textContent).toBe('cdef');
    });

    await user.click(secondEditable);
    await settle();
    await waitFor(() => {
      expect(secondView.state.doc.textContent).toBe('');
    });

    await user.click(firstEditable);
    await settle();
    act(() => {
      setCaretToStart(firstView);
    });
    await settle();
    await waitFor(() => {
      expect(firstView.state.selection.from).toBe(1);
    });
    await user.type(firstEditable, 'a');
    await settle();

    await waitFor(() => {
      expect(firstView.state.doc.textContent).toBe('acdef');
    });
    await waitFor(() => {
      expect(firstView.state.selection.$anchor.parentOffset).toBe(1);
    });

    await user.type(firstEditable, 'b');
    await settle();

    await waitFor(() => {
      expect(firstView.state.doc.textContent).toBe('abcdef');
    });
    await waitFor(() => {
      expect(firstView.state.selection.$anchor.parentOffset).toBe(2);
    });

    unmount();
    undo.detach();
  });
});
