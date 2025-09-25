/**
 * Manages outline focus navigation and history so OutlinePane can stay lean.
 * The hook keeps the breadcrumbs in sync with user navigation and exposes
 * helpers to derive focus contexts from rendered rows.
 */
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';

import type {VirtualizedNodeRow} from '../../virtualization/outlineRows';
import type {EdgeId, NodeId} from '../../types';

export interface FocusPathEntry {
  readonly nodeId: NodeId;
  readonly edgeId: EdgeId | null;
}

export interface FocusContext {
  readonly nodeId: NodeId;
  readonly edgeId: EdgeId | null;
  readonly path: readonly FocusPathEntry[];
}

interface FocusState {
  readonly history: readonly FocusContext[];
  readonly index: number;
}

export const createRootFocusContext = (rootId: NodeId): FocusContext => ({
  nodeId: rootId,
  edgeId: null,
  path: [{nodeId: rootId, edgeId: null}]
});

const focusContextsEqual = (a: FocusContext, b: FocusContext): boolean => {
  if (a.nodeId !== b.nodeId || a.edgeId !== b.edgeId || a.path.length !== b.path.length) {
    return false;
  }
  for (let index = 0; index < a.path.length; index += 1) {
    const left = a.path[index];
    const right = b.path[index];
    if (!left || !right) {
      return false;
    }
    if (left.nodeId !== right.nodeId || left.edgeId !== right.edgeId) {
      return false;
    }
  }
  return true;
};

export interface OutlineFocusHistoryHandle {
  readonly focusContext: FocusContext;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  readonly goBack: () => void;
  readonly goForward: () => void;
  readonly pushFocusContext: (next: FocusContext) => void;
  readonly replaceFocusContext: (next: FocusContext) => void;
  readonly buildContextForRow: (row: VirtualizedNodeRow) => FocusContext | null;
  readonly buildContextForIndex: (index: number) => FocusContext | null;
}

interface UseOutlineFocusHistoryArgs {
  readonly rootId: NodeId;
  readonly onFocusChanged: () => void;
}

export const useOutlineFocusHistory = ({
  rootId,
  onFocusChanged
}: UseOutlineFocusHistoryArgs): OutlineFocusHistoryHandle => {
  const [state, setState] = useState<FocusState>(() => ({
    history: [createRootFocusContext(rootId)],
    index: 0
  }));
  const shouldNotifyRef = useRef(false);

  useEffect(() => {
    setState((current) => {
      const rootContext = createRootFocusContext(rootId);
      const [first] = current.history;
      if (current.history.length === 1 && first && focusContextsEqual(first, rootContext)) {
        return current;
      }
      return {history: [rootContext], index: 0};
    });
  }, [rootId]);

  const focusContext = state.history[state.index] ?? createRootFocusContext(rootId);

  const withStateUpdate = useCallback(
    (updater: (previous: FocusState) => FocusState | null) => {
      setState((previous) => {
        const next = updater(previous);
        if (!next || (next.history === previous.history && next.index === previous.index)) {
          return previous;
        }
        shouldNotifyRef.current = true;
        return next;
      });
    },
    []
  );

  useEffect(() => {
    if (!shouldNotifyRef.current) {
      return;
    }
    shouldNotifyRef.current = false;
    onFocusChanged();
  }, [onFocusChanged, state]);

  const pushFocusContext = useCallback(
    (next: FocusContext) => {
      withStateUpdate((previous) => {
        const current = previous.history[previous.index];
        if (current && focusContextsEqual(current, next)) {
          return null;
        }
        const truncated = previous.history.slice(0, previous.index + 1);
        const history = [...truncated, next];
        return {history, index: history.length - 1};
      });
    },
    [withStateUpdate]
  );

  const replaceFocusContext = useCallback(
    (next: FocusContext) => {
      withStateUpdate((previous) => {
        const current = previous.history[previous.index];
        if (current && focusContextsEqual(current, next)) {
          return null;
        }
        const history = previous.history.slice();
        history[previous.index] = next;
        return {history, index: previous.index};
      });
    },
    [withStateUpdate]
  );

  const goBack = useCallback(() => {
    withStateUpdate((previous) => {
      if (previous.index <= 0) {
        return null;
      }
      return {...previous, index: previous.index - 1};
    });
  }, [withStateUpdate]);

  const goForward = useCallback(() => {
    withStateUpdate((previous) => {
      if (previous.index >= previous.history.length - 1) {
        return null;
      }
      return {...previous, index: previous.index + 1};
    });
  }, [withStateUpdate]);

  const canGoBack = state.index > 0;
  const canGoForward = state.index < state.history.length - 1;

  const buildContextForRow = useCallback(
    (row: VirtualizedNodeRow): FocusContext | null => {
      if (!row.edge) {
        return null;
      }
      const path: FocusPathEntry[] = [...focusContext.path];
      row.ancestorEdges.forEach((edge) => {
        path.push({nodeId: edge.childId, edgeId: edge.id});
      });
      path.push({nodeId: row.edge.childId, edgeId: row.edge.id});
      return {
        nodeId: row.node.id,
        edgeId: row.edge.id,
        path
      };
    },
    [focusContext.path]
  );

  const buildContextForIndex = useCallback(
    (index: number): FocusContext | null => {
      if (index < 0 || index >= focusContext.path.length) {
        return null;
      }
      const entry = focusContext.path[index];
      const path = focusContext.path.slice(0, index + 1);
      return {
        nodeId: entry.nodeId,
        edgeId: entry.edgeId,
        path
      };
    },
    [focusContext.path]
  );

  return useMemo(
    () => ({
      focusContext,
      canGoBack,
      canGoForward,
      goBack,
      goForward,
      pushFocusContext,
      replaceFocusContext,
      buildContextForRow,
      buildContextForIndex
    }),
    [
      buildContextForIndex,
      buildContextForRow,
      canGoBack,
      canGoForward,
      focusContext,
      goBack,
      goForward,
      pushFocusContext,
      replaceFocusContext
    ]
  );
};

export type {FocusContext as OutlineFocusContext};
