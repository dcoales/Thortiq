import {renderHook, act} from '@testing-library/react';

import {useOutlineFocusHistory, createRootFocusContext} from '../components/outline-pane/useOutlineFocusHistory';
import type {VirtualizedNodeRow} from '../virtualization/outlineRows';

const createRow = (id: string, parentId: string, ancestorIds: readonly string[] = []): VirtualizedNodeRow => ({
  node: {
    id,
    html: id,
    tags: [],
    attributes: {},
    createdAt: '',
    updatedAt: ''
  },
  edge: {
    id: `${parentId}->${id}`,
    parentId,
    childId: id,
    role: 'primary',
    collapsed: false,
    ordinal: 0,
    selected: false,
    createdAt: '',
    updatedAt: ''
  },
  depth: ancestorIds.length + 1,
  isRoot: ancestorIds.length === 0,
  ancestorEdges: ancestorIds.map((ancestorId, index) => ({
    id: `${index}:${ancestorId}`,
    parentId: index === 0 ? parentId : ancestorIds[index - 1],
    childId: ancestorId,
    role: 'primary',
    collapsed: false,
    ordinal: 0,
    selected: false,
    createdAt: '',
    updatedAt: ''
  }))
});

describe('useOutlineFocusHistory', () => {
  it('tracks push, back, and forward actions', () => {
    const onFocusChanged = jest.fn();
    const {result} = renderHook(() => useOutlineFocusHistory({rootId: 'root', onFocusChanged}));

    expect(result.current.focusContext).toEqual(createRootFocusContext('root'));

    act(() => {
      const row = createRow('child', 'root');
      const context = result.current.buildContextForRow(row);
      if (!context) {
        throw new Error('Missing context');
      }
      result.current.pushFocusContext(context);
    });
    expect(onFocusChanged).toHaveBeenCalledTimes(1);
    expect(result.current.focusContext.nodeId).toBe('child');
    expect(result.current.canGoBack).toBe(true);

    act(() => {
      result.current.goBack();
    });
    expect(onFocusChanged).toHaveBeenCalledTimes(2);
    expect(result.current.focusContext.nodeId).toBe('root');
    expect(result.current.canGoForward).toBe(true);

    act(() => {
      result.current.goForward();
    });
    expect(result.current.focusContext.nodeId).toBe('child');
  });
});
