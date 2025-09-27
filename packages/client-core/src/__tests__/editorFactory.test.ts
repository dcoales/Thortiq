import '@testing-library/jest-dom';
import {act} from '@testing-library/react';
import {Plugin} from 'prosemirror-state';
import {EditorView} from 'prosemirror-view';
import * as Y from 'yjs';

import {createEdgeId} from '../ids';
import type {EdgeRecord} from '../types';
import {createRichTextEditor} from '../richtext/editorFactory';
import {plainTextToRichTextDoc} from '../richtext/serializers';

const edge: EdgeRecord = {
  id: createEdgeId(),
  parentId: 'parent',
  childId: 'child',
  role: 'primary',
  collapsed: false,
  ordinal: 0,
  selected: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

const ensureDomStubs = () => {
  const scope = globalThis as {ResizeObserver?: typeof ResizeObserver};
  if (typeof scope.ResizeObserver === 'undefined') {
    scope.ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    } as unknown as typeof ResizeObserver;
  }
};

describe('createRichTextEditor', () => {
  beforeAll(() => {
    ensureDomStubs();
  });

  it('mounts an EditorView with custom plugins and cleans up on destroy', () => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment('content');
    const onFocusEdge = jest.fn();
    const onTransaction = jest.fn();
    const customPlugin = new Plugin({});
    const handle = createRichTextEditor({
      fragment,
      nodeId: 'node-1',
      edge,
      initialDoc: plainTextToRichTextDoc('hello world'),
      onFocusEdge,
      onTransaction,
      commandHooks: [customPlugin]
    });

    const mount = document.createElement('div');
    document.body.appendChild(mount);

    act(() => {
      handle.mount(mount);
    });

    const view = handle.getView();
    expect(view).toBeInstanceOf(EditorView);
    expect(view?.state.plugins).toEqual(expect.arrayContaining([customPlugin]));

    act(() => {
      handle.focusAt(2);
    });
    expect(view?.state.selection.from).toBe(3);

    act(() => {
      view?.dispatch(view.state.tr.insertText('!'));
    });
    expect(onTransaction).toHaveBeenCalled();

    act(() => {
      view?.dom.dispatchEvent(new FocusEvent('focus'));
      view?.dom.dispatchEvent(new FocusEvent('blur'));
    });
    expect(onFocusEdge).toHaveBeenCalledWith(edge.id);
    expect(onFocusEdge).toHaveBeenCalledWith(null);

    act(() => {
      handle.destroy();
    });

    expect(handle.getView()).toBeNull();

    mount.remove();
  });
});
